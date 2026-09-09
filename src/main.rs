mod accounts;
mod agent_jobs;
mod agent_projects;
mod api;
mod codex;
mod config;
mod feedback;
mod heygen;
mod model_relay;
mod model_settings;
mod render_jobs;
mod sandbox;
mod studio_sessions;
mod voices;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    api::run().await
}
