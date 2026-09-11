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
mod runtime;
mod sandbox;
mod studio_sessions;
mod voices;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    if matches!(
        std::env::args().nth(1).as_deref(),
        Some("runtime-target" | "runtime-status")
    ) {
        config::load_env();
        let paths = config::AppPaths::from_env()?;
        let registry = runtime::Registry::open(&paths.app_data)?;
        if std::env::args().nth(1).as_deref() == Some("runtime-target") {
            let file = std::env::args()
                .nth(2)
                .ok_or("Usage: runtime-target RELEASE_JSON")?;
            let release: runtime::Release = serde_json::from_slice(&std::fs::read(file)?)?;
            registry.set_target(&release)?;
        }
        let workers = registry
            .users()?
            .into_iter()
            .map(|user| registry.worker(&user))
            .collect::<Result<Vec<_>, _>>()?;
        println!(
            "{}",
            serde_json::to_string_pretty(
                &serde_json::json!({"target":registry.target().ok(),"workers":workers})
            )?
        );
        return Ok(());
    }
    if std::env::args().nth(1).as_deref() == Some("accounts-upgrade-defaults") {
        config::load_env();
        let paths = config::AppPaths::from_env()?;
        let accounts = accounts::Accounts::open(&paths.app_data.join("yingya.sqlite"), vec![])?;
        println!("{}", accounts.upgrade_default_quotas()?);
        return Ok(());
    }
    if std::env::args().nth(1).as_deref() == Some("admin-create") {
        config::load_env();
        let username = std::env::args()
            .nth(2)
            .ok_or("Usage: admin-create USERNAME EMAIL")?;
        let email = std::env::args()
            .nth(3)
            .ok_or("Usage: admin-create USERNAME EMAIL")?;
        let paths = config::AppPaths::from_env()?;
        std::fs::create_dir_all(&paths.app_data)?;
        let accounts = accounts::Accounts::open(&paths.app_data.join("yingya.sqlite"), vec![])?;
        let password = format!("Yy-{}", &accounts::secret()[..24]);
        let result = accounts.create_managed_user(
            "宿主终端",
            accounts::ManagedUserInput {
                email: email.clone(),
                username: username.clone(),
                name: "管理员".into(),
                password: password.clone(),
                is_admin: true,
                token_limit: accounts::DEFAULT_TOKEN_LIMIT,
                media_limit: accounts::DEFAULT_MEDIA_LIMIT,
            },
        )?;
        println!(
            "{}",
            serde_json::to_string_pretty(
                &serde_json::json!({"id":result["id"],"username":username,"email":email,"password":password})
            )?
        );
        return Ok(());
    }
    if matches!(
        std::env::args().nth(1).as_deref(),
        Some("account-invite" | "account-reset")
    ) {
        config::load_env();
        let email = std::env::args()
            .nth(2)
            .ok_or("Usage: cargo run -- account-invite EMAIL [--admin]")?;
        let paths = config::AppPaths::from_env()?;
        std::fs::create_dir_all(&paths.app_data)?;
        let accounts = accounts::Accounts::open(&paths.app_data.join("yingya.sqlite"), vec![])?;
        let value = if std::env::args().nth(1).as_deref() == Some("account-reset") {
            accounts.password_reset(&email)?
        } else {
            accounts.invite(
                accounts::InviteInput {
                    email: Some(email),
                    expires_in_days: 7,
                    max_uses: 1,
                    token_limit: accounts::DEFAULT_TOKEN_LIMIT,
                    media_limit: accounts::DEFAULT_MEDIA_LIMIT,
                },
                std::env::args().any(|arg| arg == "--admin"),
            )?
        };
        println!("{}", serde_json::to_string_pretty(&value)?);
        return Ok(());
    }
    api::run().await
}
