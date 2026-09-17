# 影芽 Anime.js 镜头库

先按表达任务查 `catalog.json`，打开候选的 `previews/*.png`，再读选中组件的配置与源码。三个组件是可组合的镜头素材；不要把所有视频固定为这三个镜头，也不要为装饰效果改写事实或虚构数据。文字可配真实图片/录屏，组件容器可放在半屏区域。

组件效果来自固定版本 Anime.js 4.5.0 的官方 API，镜头排版和节奏由影芽整理。`PROVENANCE.json` 记录未修改的官方 bundle、MIT 许可证、来源和 SHA256。无需 CDN、网络或额外 npm 依赖。

## 安装与选择

在已有 HyperFrames 项目中运行：

```bash
node "$YINGYA_ANIME_COMPONENTS" list --json
node "$YINGYA_ANIME_COMPONENTS" install --project "$PWD"
```

独立使用可直接运行本目录的 `node cli.mjs install --project /absolute/project`。目标必须是已有目录。安装器只写 `assets/animejs/`：相同内容重复安装返回 `unchanged`，有手工修改/不同版本就停止并保留全部原文件；不沿符号链接写入。若要升级，先保留旧包并明确迁移，或安装到新项目。安装结果包含源码、依赖、缩略图、许可证、目录和 SHA256 清单，可以随项目独立归档；复制后的 `cli.mjs` 仍可使用。

## 完整接入示例

先读取该视频的 `DESIGN.md`，把调色板和字体映射到 `--yga-*`。下例的 `--film-*` 都应由该文件定义；不要把产品网站的 UI 设计强行套到客户视频。已有工程的 GSAP 本地路径以该工程为准，保留原文件，不另装同库第二个版本。

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="assets/animejs/scenes.css">
  <!-- Define --film-canvas/ink/accent/muted/surface/line/font/radius
       in this local stylesheet from the video's DESIGN.md. -->
  <link rel="stylesheet" href="design.css">
  <style>
    html, body { margin: 0; }
    #film { width: 1280px; height: 720px; position: relative; }
    .shot {
      position: absolute; inset: 0;
      --yga-background: var(--film-canvas);
      --yga-foreground: var(--film-ink);
      --yga-accent: var(--film-accent);
      --yga-muted: var(--film-muted);
      --yga-surface: var(--film-surface);
      --yga-line: var(--film-line);
      --yga-font: var(--film-font);
      --yga-heading-weight: var(--film-heading-weight, 800);
      --yga-radius: var(--film-radius);
    }
  </style>
</head>
<body>
  <div id="film" data-composition-id="film" data-width="1280"
       data-height="720" data-duration="14.2">
    <div id="opening" class="shot"></div>
    <div id="process" class="shot"></div>
    <div id="result" class="shot"></div>
  </div>
  <script src="assets/gsap.min.js"></script>
  <script src="assets/animejs/anime.umd.min.js"></script>
  <script src="assets/animejs/scenes.js"></script>
  <script>
    // All markup/timelines are created synchronously, after styles and scripts.
    const opening = document.getElementById('opening');
    const process = document.getElementById('process');
    const result = document.getElementById('result');
    YingyaAnime.createScene(opening, {
      component: 'title-reveal', startSeconds: 0, durationSeconds: 4.8,
      eyebrow: '把想法变成视频', title: '让内容，真正动起来',
      subtitle: '用成熟镜头，把时间留给表达。'
    });
    YingyaAnime.createScene(process, {
      component: 'flow-path', startSeconds: 4.4, durationSeconds: 5.4,
      title: '从素材到成片', nodes: [
        { label: '上传素材', detail: '照片、录屏或一段想法' },
        { label: '组织镜头', detail: '选用适合内容的表达' },
        { label: '生成视频', detail: '预览、调整与导出' }
      ]
    });
    YingyaAnime.createScene(result, {
      component: 'number-compare', startSeconds: 9.4, durationSeconds: 4.8,
      title: '把数字讲清楚', metrics: [
        { label: '第一组（演示）', value: 24, unit: '小时' },
        { label: '第二组（演示）', value: 3.5, unit: '小时', decimals: 1 }
      ], footnote: '仅为效果演示，请使用真实数据和来源。'
    });
    // Anime owns descendants. GSAP owns these wrappers' scene transitions only.
    // These wrappers are not timed .clip elements; HyperFrames owns clip visibility.
    const main = gsap.timeline({ paused: true });
    main.fromTo(opening, { autoAlpha: 0 }, { autoAlpha: 1, duration: .25 }, 0)
      .set(process, { autoAlpha: 0 }, 0)
      .set(result, { autoAlpha: 0 }, 0)
      .to(process, { autoAlpha: 1, duration: .4 }, 4.4)
      .to(result, { autoAlpha: 1, duration: .4 }, 9.4);
    window.__timelines = window.__timelines || {};
    window.__timelines.film = main;
    // createScene already registered each paused timeline once in __hfAnime.
    // Do not push them again, play them, or add them to main.
  </script>
</body>
</html>
```

GSAP 按秒控制外层镜头切换；HyperFrames / 影芽预览以全片时间（毫秒）seek `window.__hfAnime`。`startSeconds` 已包含在返回的 Anime 时间轴中，不能再减一次开始时间。后镜头覆盖前镜头，交接前保持前镜头内容完整。`data-duration` 控制最终时长，动画提前结束会保持最后一帧，不需要空 tween。相同容器与相同配置再次调用 `createScene` 返回原时间轴；不同配置应创建新空容器，避免无意覆盖。

## 配置约束与布局

- 三个组件都必须传 `component`、`title`、`startSeconds`、`durationSeconds`；开始时间 0—86400 秒，时长 2—120 秒。数字必须有限。完整字段、长度和示例见 `catalog.json`；`YingyaAnime.validateConfig(config)` 可先验证。
- 标题揭示支持最多 44 字标题、100 字副标题；文字以 `textContent` 建立，用官方 `splitText` 拆字符，不把输入解释为 HTML。长标题会缩小并自然换行，仍应保持短句。
- 流程支持 2—5 个节点，每个标签最多 12 字、说明最多 32 字。横屏横向，竖屏纵向。必须在已连接、有明确尺寸的容器初始化，不能 `display:none`；画幅改变后重新载入/重建场景以重新计算 SVG 路径。字号/节点位置在初始化确定，没有播放时测量。
- 数字对比固定两项，分别支持 `label`、`from`（默认 0）、`value`、`unit`、`decimals`（0—2）。数值范围 ±9,999,999,999,999。`footnote` 保存数据来源/说明。单位不要塞进数值字符串。两条底线只是装饰，不表示跨单位的大小关系。
- 用 `--yga-background`、`--yga-foreground`、`--yga-accent`、`--yga-muted`、`--yga-surface`、`--yga-line`、`--yga-font`、`--yga-heading-weight`、`--yga-radius` 映射设计。容器内使用 `yga-` 前缀类，不影响其他镜头。
- `splitText` 的字符节点只创建一次，固定画幅下关闭其 resize observer，避免异步重建后时间轴引用旧节点。重建画幅请重新载入页面。

## 验证

读完候选预览再选组件；安装后检查所选源码和参数；组合完成运行项目的 HyperFrames lint/check、布局与对比度检查，检查每个镜头中间帧和转场；在影芽预览中来回拖动、播放暂停，再实际导出 MP4。官方演示的无限循环、自动播放、鼠标和滚动事件不能直接用于渲染。所有组件在末段有意留出阅读停顿；不要因为时间轴结束早于片长添加空动画。
