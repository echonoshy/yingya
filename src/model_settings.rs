pub const DEFAULT_MODEL: &str = "gpt-6.1-sol";
pub const ALLOWED_MODELS: [&str; 4] = [DEFAULT_MODEL, "gpt-6-astra", "gpt-6-sol", "gpt-6-luna"];

/// Resume saved projects and queued turns without sending a retired model upstream.
pub fn current_model(model: &str) -> &str {
    match model {
        "gpt-5.6-sol" | "gpt-5.6-terra" | "gpt-5.6-luna" => DEFAULT_MODEL,
        _ => model,
    }
}

pub fn model_allowed(model: &str) -> bool {
    ALLOWED_MODELS.contains(&model)
}

pub fn validate_model_settings(model: &str, reasoning_effort: &str) -> Result<(), String> {
    if !model_allowed(model) {
        return Err("请选择 GPT-6.1 Sol 或 GPT-6 Astra / Sol / Luna".to_owned());
    }
    if !matches!(
        reasoning_effort,
        "auto" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra"
    ) {
        return Err("unsupported reasoning effort".to_owned());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retired_saved_models_resume_with_sol() {
        for model in ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] {
            assert_eq!(current_model(model), DEFAULT_MODEL);
        }
        for model in ALLOWED_MODELS {
            assert_eq!(current_model(model), model);
        }
        assert_eq!(current_model("unknown"), "unknown");
    }

    #[test]
    fn only_the_four_product_models_are_selectable() {
        for model in ALLOWED_MODELS {
            assert!(validate_model_settings(model, "medium").is_ok());
        }
        for model in [
            "gpt-5.5",
            "gpt-5.6",
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
            "gpt-6.1-sol ",
            "",
        ] {
            assert!(validate_model_settings(model, "medium").is_err());
        }
    }
}
