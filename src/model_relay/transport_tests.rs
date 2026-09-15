use super::*;
use axum::{Router, routing::any};
use tokio::sync::mpsc;

async fn setup(
    responses: Vec<Response>,
) -> (
    ModelRelay,
    crate::accounts::Accounts,
    String,
    mpsc::Receiver<(axum::http::HeaderMap, Value)>,
    tokio::task::JoinHandle<()>,
) {
    let root = std::env::temp_dir().join(format!("yingya-relay-test-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).await.unwrap();
    fs::write(
        root.join("auth.json"),
        br#"{"tokens":{"access_token":"host-secret","account_id":"host-account"}}"#,
    )
    .await
    .unwrap();
    let (tx, rx) = mpsc::channel(8);
    let response = Arc::new(Mutex::new(std::collections::VecDeque::from(responses)));
    let app = Router::new().fallback(any(move |request: Request| {
        let tx = tx.clone();
        let response = response.clone();
        async move {
            let (parts, body) = request.into_parts();
            let value =
                serde_json::from_slice(&to_bytes(body, 1024 * 1024).await.unwrap()).unwrap();
            tx.send((parts.headers, value)).await.unwrap();
            response.lock().await.pop_front().unwrap()
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut relay = ModelRelay::new(&root).unwrap();
    relay.upstream_url = Some(format!(
        "http://{}/responses",
        listener.local_addr().unwrap()
    ));
    relay.client = reqwest::Client::builder()
        .no_proxy()
        .read_timeout(Duration::from_millis(200))
        .build()
        .unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let db = crate::accounts::Accounts::open(Path::new(":memory:"), vec![]).unwrap();
    let (user, _) = db.login("transport@example.test").unwrap();
    (relay, db, user.id, rx, server)
}

fn request() -> Request {
    Request::builder()
        .method("POST")
        .uri("/api/internal/model/backend-api/codex/responses")
        .header("session-id", "session-new")
        .header("thread-id", "thread-new")
        .header("x-client-request-id", "request-new")
        .header("authorization", "Bearer sandbox-secret")
        .header("chatgpt-account-id", "sandbox-account")
        .header("cookie", "private-cookie")
        .body(Body::from(
            r#"{"model":"gpt-6-astra","service_tier":"priority","input":"private-prompt"}"#,
        ))
        .unwrap()
}

async fn records(relay: &ModelRelay) -> Vec<Value> {
    for _ in 0..100 {
        if let Ok(text) = fs::read_to_string(relay.diagnostics.join("requests.jsonl")).await {
            return text
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect();
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("diagnostics missing")
}

#[tokio::test]
async fn forwards_current_protocol_headers_and_records_only_metadata() {
    let payload = "data: {\"type\":\"response.completed\",\"response\":{\"service_tier\":\"priority\",\"usage\":{\"input_tokens\":7,\"output_tokens\":3}}}\n\n";
    let upstream = Response::builder()
        .header("content-type", "text/event-stream")
        .header("x-request-id", "upstream-id")
        .body(Body::from(payload))
        .unwrap();
    let (relay, db, user, mut rx, server) = setup(vec![upstream]).await;
    let response = relay.forward(request(), db.clone(), &user).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["x-request-id"], "upstream-id");
    assert_eq!(to_bytes(response.into_body(), 4096).await.unwrap(), payload);
    let (headers, body) = rx.recv().await.unwrap();
    for (key, value) in [
        ("session-id", "session-new"),
        ("thread-id", "thread-new"),
        ("x-client-request-id", "request-new"),
        ("authorization", "Bearer host-secret"),
        ("chatgpt-account-id", "host-account"),
    ] {
        assert_eq!(headers[key], value);
    }
    assert!(!headers.contains_key("cookie"));
    assert_eq!(body["service_tier"], "priority");
    let rows = records(&relay).await;
    assert_eq!(rows[0]["outcome"], "completed");
    assert_eq!(rows[0]["tokens"], 10);
    assert_eq!(rows[0]["actual_tier"], "priority");
    assert_eq!(db.quota(&user).unwrap().used_tokens, 10);
    let text = serde_json::to_string(&rows).unwrap();
    for secret in [
        "private-prompt",
        "host-secret",
        "sandbox-secret",
        "host-account",
        "private-cookie",
    ] {
        assert!(!text.contains(secret));
    }
    server.abort();
    fs::remove_dir_all(relay.auth_path.parent().unwrap())
        .await
        .unwrap();
}

#[tokio::test]
async fn provider_overload_does_not_delay_another_user() {
    let upstream = Response::builder()
        .status(503)
        .header("retry-after", "120")
        .body(Body::from(
            r#"{"error":{"code":"server_is_overloaded","message":"private-error"}}"#,
        ))
        .unwrap();
    let success = Response::new(Body::from(
        r#"{"usage":{"input_tokens":7,"output_tokens":3}}"#,
    ));
    let (relay, db, user, mut rx, server) = setup(vec![upstream, success]).await;
    let other = db.login("another@example.test").unwrap().0;
    let response = relay.forward(request(), db.clone(), &user).await;
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(response.headers()["retry-after"], "120");
    to_bytes(response.into_body(), 4096).await.unwrap();
    rx.recv().await.unwrap();
    let response = tokio::time::timeout(
        Duration::from_secs(1),
        relay.forward(request(), db.clone(), &other.id),
    )
    .await
    .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    to_bytes(response.into_body(), 4096).await.unwrap();
    rx.recv().await.unwrap();
    assert_eq!(db.quota(&user).unwrap().used_tokens, 0);
    let text = serde_json::to_string(&records(&relay).await).unwrap();
    assert!(!text.contains("private-error"));
    server.abort();
    fs::remove_dir_all(relay.auth_path.parent().unwrap())
        .await
        .unwrap();
}

#[tokio::test]
async fn three_users_can_stream_the_same_upstream_account_and_model_concurrently() {
    let mut senders = Vec::new();
    let mut responses = Vec::new();
    for _ in 0..3 {
        let (tx, rx) = mpsc::channel::<Result<&'static str, std::io::Error>>(1);
        tx.send(Ok("data: {\"type\":\"response.created\"}\n\n"))
            .await
            .unwrap();
        senders.push(tx);
        responses.push(Response::new(Body::from_stream(
            tokio_stream::wrappers::ReceiverStream::new(rx),
        )));
    }
    let (mut relay, db, user, mut rx, server) = setup(responses).await;
    relay.client = reqwest::Client::builder()
        .no_proxy()
        .read_timeout(Duration::from_secs(10))
        .build()
        .unwrap();
    let second = db.login("second@example.test").unwrap().0;
    let third = db.login("third@example.test").unwrap().0;
    // Remnants of the removed scheduler must not gate new requests.
    let admission = relay.diagnostics.join("admission");
    fs::create_dir_all(&admission).await.unwrap();
    let key = diagnostics::fingerprint("host-account\0gpt-6-astra");
    fs::write(
        admission.join(format!("{key}.state")),
        r#"{"until":4102444800000}"#,
    )
    .await
    .unwrap();
    let responses = tokio::time::timeout(Duration::from_secs(2), async {
        tokio::join!(
            relay.forward(request(), db.clone(), &user),
            relay.forward(request(), db.clone(), &second.id),
            relay.forward(request(), db.clone(), &third.id)
        )
    })
    .await
    .unwrap();
    for _ in 0..3 {
        rx.recv().await.unwrap();
    }
    for tx in &senders {
        assert!(!tx.is_closed());
    }
    for response in [&responses.0, &responses.1, &responses.2] {
        assert_eq!(response.status(), StatusCode::OK);
    }
    drop(responses);
    for tx in senders {
        tokio::time::timeout(Duration::from_secs(1), tx.closed())
            .await
            .unwrap();
    }
    server.abort();
    fs::remove_dir_all(relay.auth_path.parent().unwrap())
        .await
        .unwrap();
}

#[tokio::test]
async fn cancelled_stream_and_read_timeout_close_upstream() {
    for cancel in [true, false] {
        let (tx, rx) = mpsc::channel::<Result<&'static str, std::io::Error>>(1);
        tx.send(Ok("data: {\"type\":\"response.created\"}\n\n"))
            .await
            .unwrap();
        let upstream = Response::builder()
            .header("content-type", "text/event-stream")
            .body(Body::from_stream(
                tokio_stream::wrappers::ReceiverStream::new(rx),
            ))
            .unwrap();
        let (relay, db, user, mut requests, server) = setup(vec![upstream]).await;
        let response = relay.forward(request(), db, &user).await;
        requests.recv().await.unwrap();
        if cancel {
            drop(response);
        } else {
            assert!(to_bytes(response.into_body(), 4096).await.is_err());
        }
        let rows = records(&relay).await;
        assert_eq!(
            rows[0]["outcome"],
            if cancel {
                "cancelled"
            } else {
                "stream_timeout"
            }
        );
        tokio::time::timeout(Duration::from_secs(1), tx.closed())
            .await
            .unwrap();
        server.abort();
        fs::remove_dir_all(relay.auth_path.parent().unwrap())
            .await
            .unwrap();
    }
}

#[test]
fn retry_after_and_fragmented_sse_errors_are_classified() {
    assert_eq!(retry_after(Some("120")), Some(Duration::from_secs(120)));
    let date = httpdate::fmt_http_date(SystemTime::now() + Duration::from_secs(120));
    assert!((119..=120).contains(&retry_after(Some(&date)).unwrap().as_secs()));
    assert!(retry_after(Some("nonsense")).is_none());
    for code in [
        "server_is_overloaded",
        "rate_limit_exceeded",
        "insufficient_quota",
        "context_length_exceeded",
    ] {
        let mut usage = RelayUsage::default();
        let text = format!(
            "data: {{\"type\":\"response.failed\",\"response\":{{\"error\":{{\"code\":\"{code}\"}}}}}}\n\n"
        );
        for chunk in text.as_bytes().chunks(3) {
            usage.push(chunk);
        }
        usage.finish();
        assert_eq!(usage.error_code.as_deref(), Some(code));
        assert!(usage.failed);
        assert!(usage.tokens.is_none());
    }
}
