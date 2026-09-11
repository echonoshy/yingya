pub const ALLOWED_MODELS: [&str; 4] = [
    "gpt-6-astra",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
];

pub fn model_allowed(model: &str) -> bool {
    ALLOWED_MODELS.contains(&model)
}

pub fn validate_model_settings(model: &str, reasoning_effort: &str) -> Result<(), String> {
    if !model_allowed(model) {
        return Err("请选择 GPT-6 Astra 或 GPT-5.6 Sol / Terra / Luna".to_owned());
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
    fn only_the_four_product_models_are_selectable() {
        for model in ALLOWED_MODELS {
            assert!(validate_model_settings(model, "medium").is_ok());
        }
        for model in ["gpt-5.5", "gpt-5.6", "gpt-5.6-astra", "gpt-5.6-terra ", ""] {
            assert!(validate_model_settings(model, "medium").is_err());
        }
    }
}
