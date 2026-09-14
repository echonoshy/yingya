use super::*;

#[tokio::test]
async fn sharing_failed_deletion_retries_and_repairs_legacy_reservations() {
    let (g, owner, _, _, _, project) = fixture().await;
    let failed = sample(&owner.id, &project);
    g.shares.reserve(&failed).unwrap();
    let path = g.shares.root.join(&failed.id);
    // A storage error must not release capacity for files that still exist.
    fs::write(&path, b"cannot remove as a directory")
        .await
        .unwrap();
    assert!(g.shares.discard_failed(&failed.id).await.is_err());
    assert_eq!(g.shares.get(&failed.id).unwrap().state, "purging");
    fs::remove_file(&path).await.unwrap();
    fs::create_dir(&path).await.unwrap();
    let legacy = sample(&owner.id, &project);
    g.shares.reserve(&legacy).unwrap();
    g.shares.revoke(&legacy.id, "system").unwrap();
    let reopened = Store::open(&g.paths.app_data).unwrap();
    reopened
        .cleanup(&g.paths.app_data, &g.accounts)
        .await
        .unwrap();
    assert_eq!(reopened.get(&failed.id).unwrap().state, "purged");
    assert_eq!(reopened.get(&legacy.id).unwrap().state, "purged");
    assert!(!path.exists());
    fs::remove_dir_all(&g.paths.app_data).await.unwrap();
}

#[tokio::test]
async fn sharing_rejects_playlists_even_with_accessible_segments() {
    let root = env::temp_dir().join(format!("yingya-format-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).await.unwrap();
    assert!(
        Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=s=64x64:d=1",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-threads",
                "1",
                "-y"
            ])
            .arg(root.join("segment.mp4"))
            .status()
            .await
            .unwrap()
            .success()
    );
    fs::write(
        root.join("source.mp4"),
        b"#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1.0,\nsegment.mp4\n#EXT-X-ENDLIST\n",
    )
    .await
    .unwrap();
    let mut s = sample("owner", "project");
    assert!(prepare_video(&root, &mut s).await.is_err());
    assert!(!root.join("video.mp4").exists());
    fs::remove_dir_all(root).await.unwrap();
}

async fn fixture() -> (Gateway, User, String, User, String, String) {
    let root = env::temp_dir().join(format!("yingya-share-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).await.unwrap();
    let accounts = Accounts::open(
        &root.join("accounts.sqlite"),
        vec!["share-admin@example.test".into()],
    )
    .unwrap();
    let (owner, session) = accounts.login("share-owner@example.test").unwrap();
    let (other, other_session) = accounts.login("share-other@example.test").unwrap();
    let mut paths = AppPaths::from_env().unwrap();
    paths.app_data = root.clone();
    paths.resources = root.clone();
    let g = Gateway {
        shares: Store::open(&root).unwrap(),
        paths,
        accounts,
        model_relay: crate::model_relay::ModelRelay::new(&root).unwrap(),
        previews: Default::default(),
        tenants: Default::default(),
        service_tokens: Default::default(),
        registry: None,
        pool: None,
        worker: None,
        control: Default::default(),
        service_base: "http://127.0.0.1:1".into(),
    };
    let id = Uuid::new_v4().to_string();
    let project = root
        .join("users")
        .join(&owner.id)
        .join("projects")
        .join(&id);
    fs::create_dir_all(project.join(".yingya")).await.unwrap();
    let record = json!({"id":id,"title":"分享测试","status":"idle","statusLabel":"完成","threadId":null,"activeTurnId":null,"queueDepth":0,"model":"test","reasoningEffort":"low","aspectRatio":"16:9","createdAt":1,"updatedAt":1});
    fs::write(
        project.join("project.json"),
        serde_json::to_vec(&record).unwrap(),
    )
    .await
    .unwrap();
    let manifest = json!({"schemaVersion":1,"phase":"completed","artifacts":[{"id":"final-job","kind":"final-video","label":"已导出视频","path":"final.mp4","version":"v1"}],"versions":[{"id":"v1","label":"视频 1","sourcePath":"index.html","videoPath":"final.mp4","createdAt":1}]});
    fs::write(
        project.join(".yingya/manifest.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .await
    .unwrap();
    let mut job = RenderJob::queued("job".into(), "v1".into(), "landscape".into(), 30, 1);
    job.status = RenderJobStatus::Completed;
    job.output_path = Some("final.mp4".into());
    fs::write(
        project.join(".yingya/render-jobs.json"),
        serde_json::to_vec(&vec![job]).unwrap(),
    )
    .await
    .unwrap();
    (g, owner, session, other, other_session, id)
}
async fn request(
    g: &Gateway,
    method: &str,
    path: &str,
    session: Option<&str>,
    body: Value,
    headers: &[(&str, &str)],
) -> Response {
    let mut r = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    if let Some(session) = session {
        r = r.header("cookie", format!("yingya_session={session}"));
    }
    for (key, value) in headers {
        r = r.header(*key, *value);
    }
    routes()
        .with_state(g.clone())
        .oneshot(
            r.body(Body::from(serde_json::to_vec(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap()
}
async fn json_body(response: Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap()).unwrap()
}
fn sample(owner: &str, project: &str) -> Share {
    Share {
        id: Uuid::new_v4().to_string(),
        owner: owner.into(),
        project_id: project.into(),
        artifact_id: "final-job".into(),
        token: crate::accounts::secret(),
        title: "分享测试".into(),
        version: "视频 1".into(),
        created_at: crate::accounts::now(),
        expires_at: None,
        revoked_at: None,
        state: "active".into(),
        bytes: 10,
        duration: 1.,
        width: 320,
        height: 180,
    }
}
#[tokio::test]
async fn sharing_is_anonymous_scoped_immutable_and_revocable() {
    assert_share_lifecycle(false).await;
}
#[tokio::test]
async fn sharing_preview_without_artifacts_or_exports_has_full_lifecycle() {
    assert_share_lifecycle(true).await;
}
async fn assert_share_lifecycle(preview: bool) {
    let (g, owner, session, _, other_session, id) = fixture().await;
    let source = g
        .paths
        .app_data
        .join("users")
        .join(&owner.id)
        .join("projects")
        .join(&id)
        .join("final.mp4");
    if preview {
        let root = source.parent().unwrap();
        let path = root.join(".yingya/manifest.json");
        let mut manifest: Value = read_json(&path).await.unwrap();
        manifest["artifacts"] = json!([]);
        manifest["phase"] = json!("draft_review");
        fs::write(path, serde_json::to_vec(&manifest).unwrap())
            .await
            .unwrap();
        fs::remove_file(root.join(".yingya/render-jobs.json"))
            .await
            .unwrap();
    }
    let status = Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=320x180:d=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-threads",
            "1",
            "-y",
        ])
        .arg(&source)
        .status()
        .await
        .unwrap();
    assert!(status.success());
    let input = if preview {
        json!({"projectId":id,"versionId":"v1","days":7})
    } else {
        json!({"projectId":id,"artifactId":"final-job","days":7})
    };
    assert_eq!(
        request(&g, "POST", "/api/shares", None, input.clone(), &[])
            .await
            .status(),
        401
    );
    assert_eq!(
        request(
            &g,
            "POST",
            "/api/shares",
            Some(&other_session),
            input.clone(),
            &[]
        )
        .await
        .status(),
        404
    );
    assert_eq!(
        request(
            &g,
            "POST",
            "/api/shares",
            Some(&session),
            input.clone(),
            &[("origin", "https://evil.test"), ("host", "yingya.art")]
        )
        .await
        .status(),
        403
    );
    assert_eq!(
        request(
            &g,
            "POST",
            "/api/shares",
            Some(&session),
            input.clone(),
            &[("x-yingya-user", "different")]
        )
        .await
        .status(),
        401
    );
    let created = request(&g, "POST", "/api/shares", Some(&session), input, &[]).await;
    let status = created.status();
    let created = json_body(created).await;
    assert_eq!(status, 201, "{created}");
    let share_id = created["id"].as_str().unwrap();
    let s = g.shares.get(share_id).unwrap();
    let url = format!("/api/public/shares/{}", s.token);
    let video_url = format!("{url}/video");
    let response = request(&g, "GET", &url, None, json!(null), &[]).await;
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["cache-control"], "private, no-store");
    let metadata = json_body(response).await;
    assert_eq!(metadata["title"], "分享测试");
    for key in [
        "owner",
        "projectId",
        "artifactId",
        "path",
        "email",
        "manifest",
    ] {
        assert!(metadata.get(key).is_none());
    }
    assert_eq!(
        request(&g, "POST", &video_url, None, json!(null), &[])
            .await
            .status(),
        405
    );
    let data = to_bytes(
        request(&g, "GET", &video_url, None, json!(null), &[])
            .await
            .into_body(),
        MAX_FILE as usize,
    )
    .await
    .unwrap();
    assert!(!data.is_empty());
    fs::write(&source, b"changed source").await.unwrap();
    g.accounts.logout(&session).unwrap();
    assert_eq!(
        request(&g, "GET", &url, None, json!(null), &[])
            .await
            .status(),
        200
    );
    let data2 = to_bytes(
        request(&g, "GET", &video_url, None, json!(null), &[])
            .await
            .into_body(),
        MAX_FILE as usize,
    )
    .await
    .unwrap();
    assert_eq!(data, data2);
    for (method, range, status) in [
        ("HEAD", "", 200),
        ("GET", "bytes=0-9", 206),
        ("GET", "bytes=-5", 206),
        ("GET", "bytes=99999999-", 416),
    ] {
        let headers = if range.is_empty() {
            vec![]
        } else {
            vec![("range", range)]
        };
        let response = request(&g, method, &video_url, None, json!(null), &headers).await;
        assert_eq!(response.status().as_u16(), status);
        if method == "HEAD" {
            assert!(
                to_bytes(response.into_body(), 1024)
                    .await
                    .unwrap()
                    .is_empty()
            );
        }
    }
    assert_eq!(
        request(&g, "GET", &format!("{url}/poster"), None, json!(null), &[])
            .await
            .status(),
        200
    );
    assert_eq!(
        request(
            &g,
            "GET",
            &format!("{url}/source.mp4"),
            None,
            json!(null),
            &[]
        )
        .await
        .status(),
        404
    );
    let (_, session) = g.accounts.login("share-owner@example.test").unwrap();
    let item_url = format!("/api/shares/{share_id}");
    assert_eq!(
        request(
            &g,
            "PATCH",
            &item_url,
            Some(&other_session),
            json!({"days":0}),
            &[]
        )
        .await
        .status(),
        404
    );
    assert_eq!(
        request(
            &g,
            "DELETE",
            &item_url,
            Some(&other_session),
            json!(null),
            &[]
        )
        .await
        .status(),
        404
    );
    assert_eq!(
        request(
            &g,
            "GET",
            "/api/admin/shares",
            Some(&other_session),
            json!(null),
            &[]
        )
        .await
        .status(),
        403
    );
    assert_eq!(
        request(
            &g,
            "PATCH",
            &item_url,
            Some(&session),
            json!({"days":0}),
            &[]
        )
        .await
        .status(),
        200
    );
    assert!(g.shares.get(share_id).unwrap().expires_at.is_none());
    g.shares
        .change_expiry(share_id, &owner.id, Some(1))
        .unwrap();
    assert_eq!(
        request(
            &g,
            "GET",
            &video_url,
            None,
            json!(null),
            &[("if-none-match", "*")]
        )
        .await
        .status(),
        404
    );
    assert_eq!(
        request(
            &g,
            "PATCH",
            &item_url,
            Some(&session),
            json!({"days":30}),
            &[]
        )
        .await
        .status(),
        200
    );
    let (_, admin_session) = g.accounts.login("share-admin@example.test").unwrap();
    let admin_items = json_body(
        request(
            &g,
            "GET",
            "/api/admin/shares",
            Some(&admin_session),
            json!(null),
            &[],
        )
        .await,
    )
    .await;
    assert!(admin_items["shares"][0]["url"].is_null());
    assert_eq!(
        request(
            &g,
            "DELETE",
            &format!("/api/admin/shares/{share_id}"),
            Some(&admin_session),
            json!(null),
            &[]
        )
        .await
        .status(),
        204
    );
    let reopened = Store::open(&g.paths.app_data).unwrap();
    assert!(reopened.token(&s.token).unwrap().revoked_at.is_some());
    assert_eq!(
        request(
            &g,
            "GET",
            &video_url,
            None,
            json!(null),
            &[("range", "bytes=0-9")]
        )
        .await
        .status(),
        404
    );
    assert_eq!(
        request(
            &g,
            "PATCH",
            &item_url,
            Some(&session),
            json!({"days":7}),
            &[]
        )
        .await
        .status(),
        404
    );
    fs::remove_dir_all(&g.paths.app_data).await.unwrap();
}
#[tokio::test]
async fn sharing_rejects_symlinks_unfinished_exports_and_arbitrary_files() {
    let (g, owner, session, _, _, id) = fixture().await;
    let root = g
        .paths
        .app_data
        .join("users")
        .join(&owner.id)
        .join("projects")
        .join(&id);
    let outside = g.paths.app_data.join("secret.mp4");
    fs::write(&outside, b"private").await.unwrap();
    std::os::unix::fs::symlink(&outside, root.join("final.mp4")).unwrap();
    let input = json!({"projectId":id,"artifactId":"final-job","days":7});
    assert_eq!(
        request(
            &g,
            "POST",
            "/api/shares",
            Some(&session),
            input.clone(),
            &[]
        )
        .await
        .status(),
        400
    );
    fs::remove_file(root.join("final.mp4")).await.unwrap();
    fs::write(root.join("final.mp4"), b"not a video")
        .await
        .unwrap();
    assert_eq!(
        request(
            &g,
            "POST",
            "/api/shares",
            Some(&session),
            input.clone(),
            &[]
        )
        .await
        .status(),
        400
    );
    fs::write(root.join(".yingya/render-jobs.json"), b"[]")
        .await
        .unwrap();
    assert_eq!(
        request(&g, "POST", "/api/shares", Some(&session), input, &[])
            .await
            .status(),
        400
    );
    assert_eq!(
        request(
            &g,
            "POST",
            "/api/shares",
            Some(&session),
            json!({"projectId":id,"artifactId":"final-job","days":1}),
            &[]
        )
        .await
        .status(),
        400
    );
    fs::remove_dir_all(&g.paths.app_data).await.unwrap();
}
#[tokio::test]
async fn sharing_budgets_persist_and_deletion_disables_snapshots() {
    let (g, owner, _, _, _, id) = fixture().await;
    let s = sample(&owner.id, &id);
    g.shares.reserve(&s).unwrap();
    g.shares.activate(&s).unwrap();
    let reopened = Store::open(&g.paths.app_data).unwrap();
    let limits = [("bytes:test".into(), 6, 10)];
    g.shares.budget(&limits, 1).unwrap();
    assert_eq!(reopened.budget(&limits, 1).unwrap_err().status, 429);
    reopened.budget(&limits, 2).unwrap();
    let two = [("bytes:atomic".into(), 1, 10), ("bytes:test".into(), 6, 10)];
    assert!(g.shares.budget(&two, 1).is_err());
    g.shares
        .budget(&[("bytes:atomic".into(), 10, 10)], 1)
        .unwrap();
    assert!(live(&g, &s).is_ok());
    fs::remove_file(
        g.paths
            .app_data
            .join("users")
            .join(&owner.id)
            .join("projects")
            .join(&id)
            .join("project.json"),
    )
    .await
    .unwrap();
    assert!(live(&g, &s).is_err());
    assert!(reopened.get(&s.id).unwrap().revoked_at.is_some());
    assert!(reopened.change_expiry(&s.id, &owner.id, None).is_err());
    fs::create_dir_all(g.shares.root.join(&s.id)).await.unwrap();
    fs::write(g.shares.root.join(&s.id).join("video.mp4"), b"snapshot")
        .await
        .unwrap();
    g.shares
        .db
        .lock()
        .unwrap()
        .execute("UPDATE shares SET revoked=1 WHERE id=?1", [&s.id])
        .unwrap();
    g.shares
        .cleanup(&g.paths.app_data, &g.accounts)
        .await
        .unwrap();
    assert!(!g.shares.root.join(&s.id).exists());
    assert_eq!(g.shares.get(&s.id).unwrap().state, "purged");
    fs::remove_dir_all(&g.paths.app_data).await.unwrap();
}

#[tokio::test]
async fn sharing_owner_revoke_and_account_disable_cannot_be_undone_by_renewal() {
    let (g, owner, session, _, _, project) = fixture().await;
    let s = sample(&owner.id, &project);
    g.shares.reserve(&s).unwrap();
    g.shares.activate(&s).unwrap();
    let path = format!("/api/shares/{}", s.id);
    assert_eq!(
        request(&g, "DELETE", &path, Some(&session), json!(null), &[])
            .await
            .status(),
        204
    );
    assert!(g.shares.change_expiry(&s.id, &owner.id, None).is_err());
    let second = sample(&owner.id, &project);
    g.shares.reserve(&second).unwrap();
    g.shares.activate(&second).unwrap();
    g.shares.revoke_owner(&owner.id).unwrap();
    assert!(live(&g, &g.shares.get(&second.id).unwrap()).is_err());
    let third = sample(&owner.id, &project);
    g.shares.reserve(&third).unwrap();
    g.shares.activate(&third).unwrap();
    g.shares.revoke_project(&owner.id, &project).unwrap();
    assert!(live(&g, &g.shares.get(&third.id).unwrap()).is_err());
    assert!(g.shares.token("123").is_err());
    assert_eq!(
        deleted_project(
            &axum::http::Method::DELETE,
            &format!("/api/u/{}/agent-projects/{project}", owner.id)
        ),
        Some(project)
    );
    assert!(
        deleted_project(
            &axum::http::Method::DELETE,
            "/api/agent-projects/invalid/files/video.mp4"
        )
        .is_none()
    );
    fs::remove_dir_all(&g.paths.app_data).await.unwrap();
}

#[tokio::test]
async fn sharing_preview_rejects_ambiguous_missing_and_escaping_sources() {
    let (g, owner, session, _, _, id) = fixture().await;
    for input in [
        json!({"projectId":id,"days":7}),
        json!({"projectId":id,"versionId":"v1","artifactId":"final-job","days":7}),
        json!({"projectId":id,"versionId":"missing","days":7}),
        json!({"projectId":id,"versionId":"../../outside.mp4","days":7}),
    ] {
        assert_eq!(
            request(&g, "POST", "/api/shares", Some(&session), input, &[])
                .await
                .status(),
            400
        );
    }
    let root = g
        .paths
        .app_data
        .join("users")
        .join(&owner.id)
        .join("projects")
        .join(&id);
    let outside = g.paths.app_data.join("outside.mp4");
    fs::write(&outside, b"private media").await.unwrap();
    let path = root.join(".yingya/manifest.json");
    let mut manifest: Value = read_json(&path).await.unwrap();
    for video_path in [outside.to_str().unwrap(), "preview.mp4"] {
        manifest["versions"][0]["videoPath"] = json!(video_path);
        fs::write(&path, serde_json::to_vec(&manifest).unwrap())
            .await
            .unwrap();
        if video_path == "preview.mp4" {
            std::os::unix::fs::symlink(&outside, root.join("preview.mp4")).unwrap();
        }
        assert_eq!(
            request(
                &g,
                "POST",
                "/api/shares",
                Some(&session),
                json!({"projectId":id,"versionId":"v1","days":7}),
                &[]
            )
            .await
            .status(),
            400
        );
    }
    fs::remove_dir_all(&g.paths.app_data).await.unwrap();
}

#[tokio::test]
async fn sharing_rejects_playlists_that_reference_other_users() {
    let (g, owner, session, other, _, id) = fixture().await;
    let outside = g
        .paths
        .app_data
        .join("users")
        .join(&other.id)
        .join("private.mp4");
    fs::create_dir_all(outside.parent().unwrap()).await.unwrap();
    assert!(
        Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=64x64:d=1",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-threads",
                "1",
                "-y"
            ])
            .arg(&outside)
            .status()
            .await
            .unwrap()
            .success()
    );
    let source = g
        .paths
        .app_data
        .join("users")
        .join(&owner.id)
        .join("projects")
        .join(&id)
        .join("final.mp4");
    fs::write(
        &source,
        format!(
            "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1.0,\n{}\n#EXT-X-ENDLIST\n",
            outside.display()
        ),
    )
    .await
    .unwrap();
    let response = request(
        &g,
        "POST",
        "/api/shares",
        Some(&session),
        json!({"projectId":id,"versionId":"v1","days":7}),
        &[],
    )
    .await;
    let status = response.status();
    let body = json_body(response).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(
        g.shares
            .list(Some(&owner.id), Some(&id), 0)
            .unwrap()
            .is_empty()
    );
    let isolated = media_command(source.parent().unwrap(), "/bin/sh")
        .args([
            "-c",
            "test -r /media/final.mp4 && ! test -e \"$1\"",
            "check",
        ])
        .arg(&outside)
        .output()
        .await
        .unwrap();
    assert!(isolated.status.success());
    fs::remove_dir_all(&g.paths.app_data).await.unwrap();
}

#[tokio::test]
async fn sharing_failed_copies_release_capacity_immediately() {
    let (g, owner, session, _, _, id) = fixture().await;
    let source = g
        .paths
        .app_data
        .join("users")
        .join(&owner.id)
        .join("projects")
        .join(&id)
        .join("final.mp4");
    for _ in 0..99 {
        let s = sample(&owner.id, &id);
        g.shares.reserve(&s).unwrap();
        g.shares.activate(&s).unwrap();
    }
    fs::write(&source, b"not an mp4").await.unwrap();
    let response = request(
        &g,
        "POST",
        "/api/shares",
        Some(&session),
        json!({"projectId":id,"versionId":"v1","days":7}),
        &[],
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let shares = g.shares.list(Some(&owner.id), Some(&id), 0).unwrap();
    assert_eq!(shares.len(), 99);
    let failed: (String, String) = g
        .shares
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT id,state FROM shares WHERE revoked IS NOT NULL",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(failed.1, "purged");
    assert!(!g.shares.root.join(&failed.0).exists());
    g.shares.reserve(&sample(&owner.id, &id)).unwrap();
    fs::remove_dir_all(&g.paths.app_data).await.unwrap();
}

#[tokio::test]
async fn sharing_completed_exports_survive_history_pruning_and_restart() {
    let (g, owner, session, _, _, id) = fixture().await;
    let projects = g
        .paths
        .app_data
        .join("users")
        .join(&owner.id)
        .join("projects");
    let source = projects.join(&id).join("final.mp4");
    assert!(
        Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=64x64:d=1",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-threads",
                "1",
                "-y"
            ])
            .arg(&source)
            .status()
            .await
            .unwrap()
            .success()
    );
    let before = request(
        &g,
        "POST",
        "/api/shares",
        Some(&session),
        json!({"projectId":id,"artifactId":"final-job","days":7}),
        &[],
    )
    .await;
    assert_eq!(before.status(), StatusCode::CREATED);
    let store = crate::render_jobs::RenderJobStore::new(projects);
    for i in 0..50 {
        store
            .create(
                &id,
                RenderJob::queued(
                    format!("new-{i}"),
                    "v2".into(),
                    "landscape".into(),
                    30,
                    i + 2,
                ),
            )
            .await
            .unwrap();
    }
    assert_eq!(store.list(&id, 100).await.unwrap().len(), 50);
    assert!(
        !store
            .list(&id, 100)
            .await
            .unwrap()
            .iter()
            .any(|j| j.id == "job")
    );
    let mut g = g;
    g.shares = Store::open(&g.paths.app_data).unwrap();
    let response = request(
        &g,
        "POST",
        "/api/shares",
        Some(&session),
        json!({"projectId":id,"artifactId":"final-job","days":7}),
        &[],
    )
    .await;
    let status = response.status();
    let body = json_body(response).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    fs::remove_dir_all(&g.paths.app_data).await.unwrap();
}
