use std::{env, sync::Arc, time::Duration};

use reqwest::{Client, Response, multipart};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;

const DEFAULT_API_BASE: &str = "http://127.0.0.1:8791";
const DESIGN_SAMPLE: &str =
    "每一个想法，都值得被清晰而有温度地表达。这里是映芽，为你的画面带来稳定的声音。";
const FIXED_DEFAULT_VOICE: &str = "yingya-default-narrator";

#[derive(Clone)]
pub struct VoiceClient {
    owner: Option<String>,
    storage: Option<std::path::PathBuf>,
    client: Client,
    base_url: String,
    default_voice_lock: Arc<tokio::sync::Mutex<()>>,
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
            owner: None,
            storage: None,
            client,
            base_url: env::var("VOXCPM2_API_BASE")
                .unwrap_or_else(|_| DEFAULT_API_BASE.to_owned())
                .trim_end_matches('/')
                .to_owned(),
            default_voice_lock: Arc::new(tokio::sync::Mutex::new(())),
        })
    }

    pub fn for_user(id: &str, storage: std::path::PathBuf) -> Result<Self, VoiceError> {
        let mut client = Self::from_env()?;
        client.owner = Some(format!("u_{}_", id.replace('-', "")));
        client.storage = Some(storage);
        Ok(client)
    }
    fn provider_name(&self, name: &str) -> String {
        if name == FIXED_DEFAULT_VOICE {
            return name.to_owned();
        }
        self.owner
            .as_ref()
            .map_or_else(|| name.to_owned(), |owner| format!("{owner}{name}"))
    }
    pub async fn list(&self) -> Result<VoiceList, VoiceError> {
        let response = self
            .client
            .get(format!("{}/v1/audio/voices", self.base_url))
            .send()
            .await?;
        let response = checked(response).await?;
        let mut list: VoiceList = response
            .json()
            .await
            .map_err(|error| VoiceError::InvalidResponse(error.to_string()))?;
        if let Some(owner) = &self.owner {
            list.voices = list
                .voices
                .into_iter()
                .filter_map(|name| {
                    if name == "default" || name == FIXED_DEFAULT_VOICE {
                        Some(name)
                    } else {
                        name.strip_prefix(owner).map(str::to_owned)
                    }
                })
                .collect();
            list.uploaded_voices = list
                .uploaded_voices
                .into_iter()
                .filter_map(|mut voice| {
                    if voice.name == FIXED_DEFAULT_VOICE {
                        return Some(voice);
                    }
                    voice.name = voice.name.strip_prefix(owner)?.to_owned();
                    Some(voice)
                })
                .collect();
        }
        Ok(list)
    }

    pub async fn synthesize(&self, voice: &str, text: &str) -> Result<Vec<u8>, VoiceError> {
        let voice = self.resolve(voice).await?;
        let response = self
            .client
            .post(format!("{}/v1/audio/speech", self.base_url))
            .json(&json!({
                "model": "voxcpm2",
                "input": text,
                "voice": self.provider_name(&voice.name),
                "ref_text": voice.ref_text,
                "response_format": "wav"
            }))
            .send()
            .await?;
        Ok(checked(response).await?.bytes().await?.to_vec())
    }

    pub async fn list_visible(&self) -> Result<VoiceList, VoiceError> {
        let mut voices = self.list().await?;
        // The persisted reference is represented by the existing default option.
        voices.voices.retain(|name| name != FIXED_DEFAULT_VOICE);
        voices
            .uploaded_voices
            .retain(|voice| voice.name != FIXED_DEFAULT_VOICE);
        Ok(voices)
    }

    pub async fn resolve(&self, voice: &str) -> Result<UploadedVoice, VoiceError> {
        // Serialize lazy creation so parallel scene requests share one reference.
        let _guard = if voice.eq_ignore_ascii_case("default") {
            Some(self.default_voice_lock.lock().await)
        } else {
            None
        };
        let name = if voice.eq_ignore_ascii_case("default") {
            FIXED_DEFAULT_VOICE
        } else {
            voice
        };
        if let Some(saved) = self
            .list()
            .await?
            .uploaded_voices
            .into_iter()
            .find(|item| item.name.eq_ignore_ascii_case(name))
        {
            return Ok(saved);
        }
        if voice.eq_ignore_ascii_case("default") {
            return self
                .create_design(
                    FIXED_DEFAULT_VOICE,
                    "自然清晰的中文旁白，语速适中，语气平稳",
                )
                .await;
        }
        Err(VoiceError::Service(format!(
            "音色“{voice}”没有可用的参考音频，请重新上传或创建音色"
        )))
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
                // VoxCPM2 encodes voice control in text; this adapter ignores
                // Qwen-style task_type/instructions fields.
                "input": design_text(description),
                "voice": "default",
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
        if let Some(storage) = &self.storage {
            let folder = storage.join(format!(
                "{:x}",
                <sha2::Sha256 as sha2::Digest>::digest(name.as_bytes())
            ));
            tokio::fs::create_dir_all(&folder)
                .await
                .map_err(|e| VoiceError::Service(e.to_string()))?;
            tokio::fs::write(folder.join("reference.audio"), &audio)
                .await
                .map_err(|e| VoiceError::Service(e.to_string()))?;
        }
        let audio_part = multipart::Part::bytes(audio)
            .file_name(filename.to_owned())
            .mime_str(mime_type)
            .map_err(|error| VoiceError::InvalidResponse(error.to_string()))?;
        let form = multipart::Form::new()
            .text("name", self.provider_name(name))
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
        let mut voice = envelope.voice;
        voice.name = name.to_owned();
        Ok(voice)
    }

    pub async fn exists(&self, voice: &str) -> Result<bool, VoiceError> {
        let list = self.list().await?;
        Ok(list
            .voices
            .iter()
            .any(|item| item.eq_ignore_ascii_case(voice)))
    }
}

fn design_text(description: &str) -> String {
    format!("({description}){DESIGN_SAMPLE}")
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Json, Router,
        extract::{Multipart, State},
        routing::{get, post},
    };
    use tokio::sync::Mutex;

    #[derive(Clone, Default)]
    struct MockTts {
        voices: Arc<Mutex<Vec<UploadedVoice>>>,
        requests: Arc<Mutex<Vec<Value>>>,
    }

    async fn catalog(State(state): State<MockTts>) -> Json<VoiceList> {
        let uploaded_voices = state.voices.lock().await.clone();
        Json(VoiceList {
            voices: vec!["default".into()],
            uploaded_voices,
        })
    }

    async fn speech(State(state): State<MockTts>, Json(body): Json<Value>) -> Vec<u8> {
        state.requests.lock().await.push(body);
        b"reference-audio".to_vec()
    }

    async fn upload(State(state): State<MockTts>, mut form: Multipart) -> Json<Value> {
        let mut body = json!({});
        while let Some(field) = form.next_field().await.unwrap() {
            let name = field.name().unwrap().to_owned();
            if name != "audio_sample" {
                body[&name] = json!(field.text().await.unwrap());
            }
        }
        let voice: UploadedVoice = serde_json::from_value(body).unwrap();
        state.voices.lock().await.push(voice.clone());
        Json(json!({"voice": voice}))
    }

    async fn mock_client() -> (VoiceClient, MockTts, tokio::task::JoinHandle<()>) {
        let state = MockTts::default();
        let app = Router::new()
            .route("/v1/audio/voices", get(catalog).post(upload))
            .route("/v1/audio/speech", post(speech))
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let client = VoiceClient {
            owner: None,
            storage: None,
            client: Client::new(),
            base_url: format!("http://{}", listener.local_addr().unwrap()),
            default_voice_lock: Arc::new(Mutex::new(())),
        };
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (client, state, task)
    }

    #[tokio::test]
    async fn private_voices_are_not_listed_or_usable_by_another_account() {
        let (base, _, task) = mock_client().await;
        let mut a = base.clone();
        a.owner = Some("user_a_".into());
        let mut b = base.clone();
        b.owner = Some("user_b_".into());
        a.create_design("narration", "清晰温暖的中文旁白")
            .await
            .unwrap();
        assert!(
            a.list_visible()
                .await
                .unwrap()
                .uploaded_voices
                .iter()
                .any(|v| v.name == "narration")
        );
        assert!(b.list_visible().await.unwrap().uploaded_voices.is_empty());
        assert!(b.synthesize("narration", "hello").await.is_err());
        assert!(a.synthesize("narration", "hello").await.is_ok());
        task.abort();
    }

    #[tokio::test]
    async fn design_encodes_control_in_text_and_cloning_reuses_transcript() {
        let (client, state, task) = mock_client().await;
        client
            .create_design("女性1", "温暖清晰的青年女声")
            .await
            .unwrap();
        client.synthesize("女性1", "第一段旁白").await.unwrap();
        let requests = state.requests.lock().await;
        assert_eq!(
            requests[0]["input"],
            format!("(温暖清晰的青年女声){DESIGN_SAMPLE}")
        );
        assert!(requests[0].get("task_type").is_none());
        assert_eq!(requests[1]["voice"], "女性1");
        assert_eq!(requests[1]["ref_text"], DESIGN_SAMPLE);
        assert_eq!(requests[1]["input"], "第一段旁白");
        task.abort();
    }

    #[tokio::test]
    async fn concurrent_default_segments_create_one_persisted_reference() {
        let (client, state, task) = mock_client().await;
        let (first, second) = tokio::join!(
            client.synthesize("default", "第一段"),
            client.synthesize("default", "第二段")
        );
        first.unwrap();
        second.unwrap();
        assert_eq!(state.voices.lock().await.len(), 1);
        // A fresh client after restart resolves the saved reference as well.
        let restarted = VoiceClient {
            default_voice_lock: Arc::new(Mutex::new(())),
            ..client.clone()
        };
        restarted
            .synthesize("default", "修改后的第三段")
            .await
            .unwrap();
        let requests = state.requests.lock().await;
        assert_eq!(requests.len(), 4);
        for request in requests.iter().skip(1) {
            assert_eq!(request["voice"], FIXED_DEFAULT_VOICE);
            assert_eq!(request["ref_text"], DESIGN_SAMPLE);
        }
        task.abort();
    }

    #[tokio::test]
    async fn missing_saved_voice_never_falls_back_to_default() {
        let (client, state, task) = mock_client().await;
        assert!(client.synthesize("已删除的音色", "第一段").await.is_err());
        assert!(state.requests.lock().await.is_empty());
        task.abort();
    }
}
