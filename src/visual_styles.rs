use std::{collections::BTreeMap, path::Path, sync::LazyLock};

use serde::{Deserialize, Serialize};
use tokio::{fs, io::AsyncWriteExt};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualStyle {
    pub id: String,
    pub version: u32,
    pub name: String,
    pub description: String,
    pub inspiration: String,
    pub layout: String,
    pub tags: Vec<String>,
    pub tokens: BTreeMap<String, String>,
    pub motion: StyleMotion,
    pub rules: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct StyleMotion {
    pub enter: f64,
    pub stagger: f64,
    pub distance: f64,
    pub ease: String,
}

#[derive(Deserialize, Serialize)]
struct StyleKit {
    style: VisualStyle,
    css: String,
    scene: String,
    motion: String,
}

static CATALOG: LazyLock<Vec<VisualStyle>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../runtime/visual-styles/catalog.json"))
        .expect("bundled visual style catalog must be valid")
});

pub fn select(
    id: Option<&str>,
    version: Option<u32>,
    prompt: &str,
) -> Result<Option<VisualStyle>, String> {
    let Some(id) = id else { return Ok(None) };
    let id = if id == "auto" { recommend(prompt) } else { id };
    let style = CATALOG
        .iter()
        .find(|style| style.id == id)
        .ok_or_else(|| "所选视觉风格已不可用，请重新选择。".to_owned())?;
    if version.is_some_and(|version| version != style.version) {
        return Err("视觉风格已有更新，请刷新后重新选择。".to_owned());
    }
    Ok(Some(style.clone()))
}

fn recommend(prompt: &str) -> &'static str {
    let prompt = prompt.to_lowercase();
    for (keywords, id) in [
        (&["数据", "图表", "报告", "统计", "chart"][..], "data-story"),
        (
            &["知识", "原理", "科普", "流程", "讲解"][..],
            "clear-explainer",
        ),
        (
            &["活动", "促销", "动态文字", "音乐节"][..],
            "bold-geometric",
        ),
        (&["人文", "故事", "温暖", "旅行"][..], "warm-editorial"),
        (
            &["软件", "代码", "技术", "saas", "开发者"][..],
            "precise-tech",
        ),
    ] {
        if keywords.iter().any(|word| prompt.contains(word)) {
            return id;
        }
    }
    "quiet-product"
}

fn tokens_css(style: &VisualStyle) -> String {
    let tokens = style
        .tokens
        .iter()
        .map(|(key, value)| format!("  --ys-{key}: {value};"))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "/* {} v{} — project-owned starting tokens */\n:root {{\n{tokens}\n}}\n",
        style.name, style.version
    )
}

pub async fn snapshot(directory: &Path, style: &VisualStyle) -> Result<(), String> {
    let kit = StyleKit {
        style: style.clone(),
        css: include_str!("../runtime/visual-styles/scenes.css").to_owned(),
        scene: include_str!("../runtime/visual-styles/scene.html")
            .replace("{{layout}}", &style.layout),
        motion: include_str!("../runtime/visual-styles/motion.js").to_owned(),
    };
    let contents = serde_json::to_string_pretty(&kit).map_err(|e| e.to_string())?;
    fs::write(directory.join(".yingya/visual-style-kit.json"), contents)
        .await
        .map_err(|e| e.to_string())?;
    let rules = style
        .rules
        .iter()
        .map(|rule| format!("- {rule}"))
        .collect::<Vec<_>>()
        .join("\n");
    let notes = format!(
        "# 项目起始视觉规范：{}\n\n版本：{} / {}\n\n{}。{}。\n\n## 画面与节奏\n{}\n\n## 使用方式\n\n完整规则、tokens 和可复用场景源已快照在 `.yingya/visual-style-kit.json`。方案阶段只阅读与规划，不运行其中的 HTML/JS。方案批准后，应用会将同源参考安装到 `style/`。\n\n将选定规则落实到项目 DESIGN.md，并引用 style/tokens.css、style/scenes.css；按内容改编 style/scene.html，使用 style/motion.js 的 GSAP 入场函数。中文字体需验证可用，竖屏和方形使用 ys-portrait 并设置实际画布尺寸。示例文案必须替换，不把示例当用户事实。\n\n这是一套起始风格，用户提供的品牌规范与后续明确要求优先。变更时同步 DESIGN.md 和样式，不在下一轮重新套回起始规范。\n\n## 交付检查\n\n检查配色与字体是否一致、重点是否可读、字幕安全区是否保留、信息是否有足够停留时间。审阅实际截图与转场，对具体偏差修正；不以构建成功代替审美检查。\n",
        style.name, style.id, style.version, style.description, style.inspiration, rules
    );
    fs::write(directory.join(".yingya/visual-style.md"), notes)
        .await
        .map_err(|e| e.to_string())
}

/// Only called after plan approval. Read the project snapshot, never the latest catalog.
/// Do not overwrite project edits. Return new paths so checkpoint rollback can remove them.
pub async fn install(directory: &Path) -> Result<Vec<std::path::PathBuf>, std::io::Error> {
    let snapshot = directory.join(".yingya/visual-style-kit.json");
    let contents = match fs::read(snapshot).await {
        Ok(contents) => contents,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e),
    };
    let kit: StyleKit = serde_json::from_slice(&contents).map_err(std::io::Error::other)?;
    fs::create_dir_all(directory.join("style")).await?;
    let mut created = Vec::new();
    for (name, contents) in [
        ("tokens.css", tokens_css(&kit.style)),
        ("scenes.css", kit.css),
        ("scene.html", kit.scene),
        ("motion.js", kit.motion),
    ] {
        let path = directory.join("style").join(name);
        let result = async {
            let mut file = match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .await
            {
                Ok(file) => file,
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => return Ok(()),
                Err(e) => return Err(e),
            };
            created.push(path);
            file.write_all(contents.as_bytes()).await
        }
        .await;
        if let Err(e) = result {
            for path in &created {
                let _ = fs::remove_file(path).await;
            }
            return Err(e);
        }
    }
    Ok(created)
}

pub fn prompt_note(style: Option<&VisualStyle>) -> String {
    style.map(|style| format!("\n项目起始视觉风格：{}（{} v{}）。先读取 .yingya/visual-style.md、.yingya/visual-style-kit.json 和已有 DESIGN.md。方案需说明如何应用此风格；批准后复用 style/ 中的样式与场景参考，按实际内容改编，并检查真实画面的配色、字体、布局与动效是否符合规范。已有 DESIGN.md 中记录的用户明确修改优先，不能每轮重置风格。", style.name, style.id, style.version)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visual_style_selection_validates_version_and_preserves_legacy_default() {
        assert!(select(None, None, "数据").unwrap().is_none());
        assert_eq!(
            select(Some("auto"), None, "统计数据短片")
                .unwrap()
                .unwrap()
                .id,
            "data-story"
        );
        assert_eq!(
            select(Some("warm-editorial"), Some(1), "数据")
                .unwrap()
                .unwrap()
                .id,
            "warm-editorial"
        );
        assert!(select(Some("../unknown"), None, "").is_err());
        assert!(select(Some("quiet-product"), Some(999), "").is_err());
    }

    #[tokio::test]
    async fn visual_style_snapshot_installs_only_after_approval_and_preserves_edits() {
        let root = std::env::temp_dir().join(format!("yingya-style-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join(".yingya")).await.unwrap();
        let style = select(Some("warm-editorial"), Some(1), "")
            .unwrap()
            .unwrap();
        snapshot(&root, &style).await.unwrap();
        assert!(!root.join("style/scene.html").exists());
        // A project snapshot remains authoritative even when its tokens differ from the catalog.
        let path = root.join(".yingya/visual-style-kit.json");
        let mut kit: StyleKit = serde_json::from_slice(&fs::read(&path).await.unwrap()).unwrap();
        kit.style.tokens.insert("accent".into(), "#123456".into());
        fs::write(path, serde_json::to_vec(&kit).unwrap())
            .await
            .unwrap();
        assert_eq!(install(&root).await.unwrap().len(), 4);
        assert!(
            fs::read_to_string(root.join("style/tokens.css"))
                .await
                .unwrap()
                .contains("#123456")
        );
        fs::write(root.join("style/tokens.css"), "/* user edit */")
            .await
            .unwrap();
        assert!(install(&root).await.unwrap().is_empty());
        assert_eq!(
            fs::read_to_string(root.join("style/tokens.css"))
                .await
                .unwrap(),
            "/* user edit */"
        );
        assert!(prompt_note(Some(&style)).contains("用户明确修改优先"));
        fs::remove_dir_all(root).await.unwrap();
    }
}
