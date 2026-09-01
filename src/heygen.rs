use std::{env, sync::Arc, time::Duration};

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone)]
pub struct HeyGenClient {
    http: reqwest::Client,
    api_key: Option<Arc<str>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct HeyGenAudioSound {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(rename(deserialize = "audio_url", serialize = "audioUrl"))]
    pub audio_url: String,
    pub duration: f32,
    pub score: f32,
    #[serde(rename = "type")]
    pub audio_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HeyGenAudioSearchResponse {
    pub data: Vec<HeyGenAudioSound>,
    #[serde(default, rename(deserialize = "has_more", serialize = "hasMore"))]
    pub has_more: bool,
    #[serde(default, rename(deserialize = "next_token", serialize = "nextToken"))]
    pub next_token: Option<String>,
}

#[derive(Debug, Error)]
#[error("{0}")]
pub struct HeyGenError(pub String);

impl HeyGenClient {
    pub fn new() -> Result<Self, reqwest::Error> {
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(45))
                .build()?,
            api_key: env::var("HEYGEN_API_KEY")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .map(Arc::<str>::from),
        })
    }

    fn api_key(&self) -> Result<&str, HeyGenError> {
        self.api_key
            .as_deref()
            .ok_or_else(|| HeyGenError("服务端尚未配置 HEYGEN_API_KEY".to_owned()))
    }

    pub async fn search_audio(
        &self,
        query: &str,
        audio_type: &str,
        limit: u8,
        min_score: f32,
    ) -> Result<HeyGenAudioSearchResponse, HeyGenError> {
        let response = self
            .http
            .get("https://api.heygen.com/v3/audio/sounds")
            .header("X-Api-Key", self.api_key()?)
            .query(&[
                ("query", query.to_owned()),
                ("type", audio_type.to_owned()),
                ("limit", limit.to_string()),
                ("min_score", min_score.to_string()),
            ])
            .send()
            .await
            .map_err(|error| HeyGenError(format!("无法连接 HeyGen：{error}")))?;
        let status = response.status();
        if !status.is_success() {
            let message = response.text().await.unwrap_or_default();
            return Err(HeyGenError(format!(
                "HeyGen 音频搜索失败（{status}）：{}",
                compact_external_error(&message)
            )));
        }
        response
            .json()
            .await
            .map_err(|error| HeyGenError(format!("HeyGen 响应无法解析：{error}")))
    }

    pub async fn download_audio(&self, url: &str) -> Result<Vec<u8>, HeyGenError> {
        let response = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|error| HeyGenError(format!("下载 HeyGen 音频失败：{error}")))?;
        if !response.status().is_success() {
            return Err(HeyGenError(format!(
                "下载 HeyGen 音频失败（{}）",
                response.status()
            )));
        }
        if response
            .content_length()
            .is_some_and(|size| size > 100 * 1024 * 1024)
        {
            return Err(HeyGenError("HeyGen 音频超过 100 MiB 安全限制".to_owned()));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|error| HeyGenError(format!("读取 HeyGen 音频失败：{error}")))?;
        if bytes.len() > 100 * 1024 * 1024 {
            return Err(HeyGenError("HeyGen 音频超过 100 MiB 安全限制".to_owned()));
        }
        Ok(bytes.to_vec())
    }
}

fn compact_external_error(value: &str) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        "未知错误".to_owned()
    } else {
        compact.chars().take(300).collect()
    }
}
