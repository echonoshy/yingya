mod agent_jobs;
mod agent_projects;
mod api;
mod codex;
mod config;
mod heygen;
mod model_settings;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    api::run().await
}
