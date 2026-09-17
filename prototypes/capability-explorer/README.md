# 映芽 · 创作能力独立预览

这是根据已选样式稿制作的独立 React / Vite 原型。没有修改正式首页路由、业务 API 或发布中的版本。

## 体验

本机预览：http://localhost:8808/

服务运行于 tmux `yingya-capability-preview`，从仓库根目录启动：

```sh
npm --prefix prototypes/capability-explorer run dev -- --host 0.0.0.0 --port 8808 --strictPort
```

启动前检查 `tmux has-session -t yingya-capability-preview`，不要重复启动。

- 六类效果支持用途筛选、搜索、详情查看和表现方式选择。
- 选择的能力 ID 与变体进入创作要求，不仅是输入框中的提示文案。
- 本地素材可添加、拖放、移除；不会上传到服务器。
- 方案预览为界面演示，不调用 AI。可以下载包含能力 ID、变体、画幅、文案及文件元数据的 JSON。
- 3D 要求添加 GLB 文件；原型仅检查扩展名，未验证或播放用户上传模型。它播放仓库自带的几何模型。
- Anime.js 标题、流程、数字及 Magic UI 连线调用仓库的现有运行时，支持播放、暂停、重播与拖动定位。
- Baoyu 展示已接入设计参考的用途，不声称完整技能执行器或现成视频模板。
- 预览数据只保存在本次页面内，刷新后清空。

## 文件

- `src/App.jsx`：交互流程与预览面板。
- `src/capabilities.js`：能力说明、来源、输入要求与适用场景。
- `src/tokens.css`：复制自正式项目 `web/src/styles.css` 的语义设计 token，保持预览独立；非新的产品设计系统。
- `public/demo/`：通过仓库组件安装器复制的本地运行时、许可及示例播放器。
- `public/assets/`：已有预览图、原始 Logo 与新生成概念素材。
- `design-qa.md`：视觉与交互验收。

## 素材与范围

耳机与信息图由内置 image_gen 生成，只用于此次原型。耳机是视觉概念图片，不对应真实耳机 GLB；信息图是布局示意，不是 Baoyu 运行输出。参考图：
`/home/lake/.codex/generated_images/01a0ae60-5697-7da3-a37c-6161f0a1c535/exec-64d44748-23a8-40b1-948c-693eee9deeaf.png`。

耳机生成 brief：原创无商标石墨金属头戴耳机，三分之四视角，暖浅石灰背景，精致工作室柔光，完整中央物体，无文字或 UI，16:9。

信息图生成 brief：米白纸底，墨黑线条，柔和橙色中心节点“映芽”，左侧“文案/素材/要求”，右侧“方案/预览/成片”，标题“把内容，组织成故事”，下方“布局示意”，16:9。

标题、流程与数字图片来自 `runtime/animejs/previews`；连线图片来自当前 `beam-network` 组件实际渲染截图。Logo 来自 `web/public/brand/yingya-ghost.png`。组件源码及字体许可证随 `public/demo` 保留。

下一阶段如果要正式接入，需要把能力选择接入正式创作要求、核验用户模型、接入项目/素材 API，并按仓库滚动发布流程部署。此原型不替代这些步骤。
