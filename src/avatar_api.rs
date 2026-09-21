use super::*;
use axum::body::Bytes;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PresetInput {
    preset_id: String,
}

pub(super) async fn get_avatar(State(g): State<Gateway>, headers: HeaderMap) -> Response {
    let Some(user) = user(&g, &headers) else {
        return failure(StatusCode::UNAUTHORIZED, "请先登录");
    };
    avatar_result(g.accounts.avatar(&user.id))
}

pub(super) async fn select_preset(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Json(input): Json<PresetInput>,
) -> Response {
    let Some(user) = user(&g, &headers) else {
        return failure(StatusCode::UNAUTHORIZED, "请先登录");
    };
    if !same_origin(&headers) {
        return failure(StatusCode::FORBIDDEN, "请从本站修改头像");
    }
    avatar_result(g.accounts.set_avatar_preset(&user.id, &input.preset_id))
}

pub(super) async fn upload(State(g): State<Gateway>, headers: HeaderMap, body: Bytes) -> Response {
    let Some(user) = user(&g, &headers) else {
        return failure(StatusCode::UNAUTHORIZED, "请先登录");
    };
    if !same_origin(&headers) {
        return failure(StatusCode::FORBIDDEN, "请从本站上传头像");
    }
    static PROCESSORS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
    let Ok(permit) = PROCESSORS.try_acquire() else {
        return failure(StatusCode::TOO_MANY_REQUESTS, "图片处理繁忙，请稍后重试");
    };
    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let image = crate::accounts::normalize_avatar(&body)?;
        g.accounts.set_avatar_image(&user.id, &image)
    })
    .await
    .unwrap_or_else(|_| Err("头像保存失败，请重试".into()));
    avatar_result(result)
}

pub(super) async fn image(State(g): State<Gateway>, headers: HeaderMap) -> Response {
    let Some(user) = user(&g, &headers) else {
        return failure(StatusCode::UNAUTHORIZED, "请先登录");
    };
    match g.accounts.avatar_image(&user.id) {
        Ok(bytes) => (
            [
                ("content-type", "image/png"),
                ("cache-control", "private, no-store"),
                ("x-content-type-options", "nosniff"),
            ],
            bytes,
        )
            .into_response(),
        Err(message) => failure(StatusCode::NOT_FOUND, &message),
    }
}

fn avatar_result(value: Result<crate::accounts::Avatar, String>) -> Response {
    match value {
        Ok(avatar) => ([("cache-control", "no-store")], Json(avatar)).into_response(),
        Err(message) => failure(StatusCode::BAD_REQUEST, &message),
    }
}
