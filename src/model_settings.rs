pub fn validate_model_settings(model: &str, reasoning_effort: &str) -> Result<(), String> {
    let model = model.trim();
    if model.is_empty() || model.len() > 100 {
        return Err("model must be between 1 and 100 characters".to_owned());
    }
    if !matches!(
        reasoning_effort,
        "auto" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra"
    ) {
        return Err("unsupported reasoning effort".to_owned());
    }
    Ok(())
}
