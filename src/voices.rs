use std::{env, time::Duration};

use reqwest::{Client, Response, multipart};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;

const DEFAULT_API_BASE: &str = "http://127.0.0.1:8791";
const DESIGN_SAMPLE: &str =
    "每一个想法，都值得被清晰而有温度地表达。这里是映芽，为你的画面带来稳定的声音。";

#[derive(Clone)]
pub struct VoiceClient {
    client: Client,
    base_url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct UploadedVoice {
    pub name: String,
    #[serde(default)]
    pub consent: String,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub file_size: u64,
    #[serde(default)]
    pub mime_type: String,
    #[serde(default)]
    pub ref_text: Option<String>,
    #[serde(default)]
    pub speaker_description: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct VoiceList {
    #[serde(default)]
    pub voices: Vec<String>,
    #[serde(default)]
    pub uploaded_voices: Vec<UploadedVoice>,
}

#[derive(Debug, Deserialize)]
struct VoiceUploadEnvelope {
    voice: UploadedVoice,
}

#[derive(Debug, Error)]
pub enum VoiceError {
    #[error("无法连接本地语音服务：{0}")]
    Transport(#[from] reqwest::Error),
    #[error("语音服务返回错误：{0}")]
    Service(String),
    #[error("语音服务返回了无法识别的数据：{0}")]
    InvalidResponse(String),
}

impl VoiceClient {
    pub fn from_env() -> Result<Self, VoiceError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(300))
            .build()?;
        Ok(Self {
            client,
            base_url: env::var("VOXCPM2_API_BASE")
                .unwrap_or_else(|_| DEFAULT_API_BASE.to_owned())
                .trim_end_matches('/')
                .to_owned(),
        })
    }

    pub async fn list(&self) -> Result<VoiceList, VoiceError> {
        let response = self
            .client
            .get(format!("{}/v1/audio/voices", self.base_url))
            .send()
            .await?;
        let response = checked(response).await?;
        response
            .json()
            .await
            .map_err(|error| VoiceError::InvalidResponse(error.to_string()))
    }

    pub async fn synthesize(&self, voice: &str, text: &str) -> Result<Vec<u8>, VoiceError> {
        let response = self
            .client
            .post(format!("{}/v1/audio/speech", self.base_url))
            .json(&json!({
                "model": "voxcpm2",
                "input": text,
                "voice": voice,
                "response_format": "wav"
            }))
            .send()
            .await?;
        Ok(checked(response).await?.bytes().await?.to_vec())
    }

    pub async fn create_design(
        &self,
        name: &str,
        description: &str,
    ) -> Result<UploadedVoice, VoiceError> {
        let seed = self
            .client
            .post(format!("{}/v1/audio/speech", self.base_url))
            .json(&json!({
                "model": "voxcpm2",
                "input": DESIGN_SAMPLE,
                "task_type": "VoiceDesign",
                "instructions": description,
                "response_format": "wav"
            }))
            .send()
            .await?;
        let audio = checked(seed).await?.bytes().await?.to_vec();
        self.upload(
            name,
            description,
            DESIGN_SAMPLE,
            "generated-by-voxcpm2",
            "voice-design.wav",
            "audio/wav",
            audio,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn upload(
        &self,
        name: &str,
        description: &str,
        ref_text: &str,
        consent: &str,
        filename: &str,
        mime_type: &str,
        audio: Vec<u8>,
    ) -> Result<UploadedVoice, VoiceError> {
        let audio_part = multipart::Part::bytes(audio)
            .file_name(filename.to_owned())
            .mime_str(mime_type)
            .map_err(|error| VoiceError::InvalidResponse(error.to_string()))?;
        let form = multipart::Form::new()
            .text("name", name.to_owned())
            .text("consent", consent.to_owned())
            .text("ref_text", ref_text.to_owned())
            .text("speaker_description", description.to_owned())
            .part("audio_sample", audio_part);
        let response = self
            .client
            .post(format!("{}/v1/audio/voices", self.base_url))
            .multipart(form)
            .send()
            .await?;
        let response = checked(response).await?;
        let envelope: VoiceUploadEnvelope = response
            .json()
            .await
            .map_err(|error| VoiceError::InvalidResponse(error.to_string()))?;
        Ok(envelope.voice)
    }

    pub async fn exists(&self, voice: &str) -> Result<bool, VoiceError> {
        let list = self.list().await?;
        Ok(list
            .voices
            .iter()
            .any(|item| item.eq_ignore_ascii_case(voice)))
    }
}

async fn checked(response: Response) -> Result<Response, VoiceError> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let detail = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .or_else(|| value.get("detail"))
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or(body);
    Err(VoiceError::Service(format!("HTTP {status}: {detail}")))
}
