import { newElement, emptyDocument } from "./model.mjs";
export const styles = [
  {
    id: "minimal-product",
    name: "极简产品",
    category: "产品",
    description: "清晰留白、克制淡入，适合产品介绍与功能发布。",
    background: "#f5f6f8",
    foreground: "#24262b",
    accent: "#006bd6",
    font: "sans",
    animation: "rise",
    title: "让想法，成为作品。",
    subtitle: "从一句描述，到一个可继续编辑的视频。",
  },
  {
    id: "editorial",
    name: "杂志叙事",
    category: "叙事",
    description: "大标题与细分栏，适合人物、品牌和长文叙事。",
    background: "#f5f0e7",
    foreground: "#302e2a",
    accent: "#a74430",
    font: "serif",
    animation: "fade",
    title: "把故事留在画面里",
    subtitle: "每一段经历，都值得被好好讲述。",
  },
  {
    id: "kinetic-type",
    name: "字幕强调",
    category: "文字",
    description: "高对比文字与短句节奏，适合观点、口播和开场。",
    background: "#202225",
    foreground: "#ffffff",
    accent: "#f1cb59",
    font: "sans",
    animation: "scale",
    title: "一个想法。\n无限可能。",
    subtitle: "让关键的一句话，成为画面的主角。",
  },
  {
    id: "data-story",
    name: "动态图表",
    category: "数据",
    description: "柱形数据、数值标签与有序出现，适合数据讲解。",
    background: "#f8fafc",
    foreground: "#23334b",
    accent: "#3478c0",
    font: "sans",
    animation: "rise",
    title: "每一步，都有进展",
    subtitle: "季度增长 · 示例数据",
  },
  {
    id: "field-notes",
    name: "手记说明",
    category: "讲解",
    description: "温暖纸色、注释和编号，适合知识拆解和教学。",
    background: "#fffbea",
    foreground: "#393a30",
    accent: "#3f7553",
    font: "mono",
    animation: "rise",
    title: "从第一个小步骤开始",
    subtitle: "01 观察问题     02 尝试方法     03 记录结果",
  },
  {
    id: "map-story",
    name: "地图叙事",
    category: "叙事",
    description: "地点与行程逐项展开，适合旅行和地域故事。",
    background: "#edf3ee",
    foreground: "#294238",
    accent: "#548a74",
    font: "sans",
    animation: "fade",
    title: "下一站，去看看世界",
    subtitle: "上海 → 杭州 → 黄山 · 一段新的旅程",
  },
];
export function templateScene(styleId, sceneId, doc = emptyDocument()) {
  const style = styles.find((s) => s.id === styleId) ?? styles[0];
  const scene = {
    id: sceneId,
    name: style.name,
    duration: 5,
    background: style.background,
    styleId: style.id,
    elements: [],
  };
  const title = {
    ...newElement(`${sceneId}-title`, "text", scene, doc),
    name: "主标题",
    text: style.title,
    font: style.font,
    color: style.foreground,
    animation: style.animation,
    x: doc.width * 0.08,
    y: doc.height * 0.21,
    width: doc.width * 0.84,
    height: doc.height * 0.33,
    fontSize: Math.round(doc.width * 0.055),
    align: "left",
  };
  const subtitle = {
    ...newElement(`${sceneId}-subtitle`, "text", scene, doc),
    name: "说明文字",
    text: style.subtitle,
    font: style.font,
    color: style.foreground,
    animation: "fade",
    x: doc.width * 0.08,
    y: doc.height * 0.72,
    width: doc.width * 0.84,
    height: doc.height * 0.16,
    fontSize: Math.round(doc.width * 0.022),
    fontWeight: 400,
    align: "left",
  };
  scene.elements.push(title, subtitle);
  if (style.id === "data-story") {
    title.y = doc.height * 0.08;
    title.height = doc.height * 0.2;
    title.fontSize = Math.round(doc.width * 0.04);
    [35, 62, 48, 86].forEach((value, i) =>
      scene.elements.push({
        ...newElement(`${sceneId}-bar-${i}`, "shape", scene, doc),
        name: `第 ${i + 1} 季度：${value}`,
        fill: style.accent,
        animation: "rise",
        x: doc.width * (0.12 + i * 0.2),
        y: doc.height * (0.67 - value * 0.004),
        width: doc.width * 0.11,
        height: doc.height * value * 0.004,
      }),
    );
  }
  return scene;
}
