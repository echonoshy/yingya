# 真实录屏镜头装配

```bash
node runtime/editorial/assemble.mjs --project /absolute/project --scenes scenes.json
```

读取现有根数组 `scenes.json`，输出可编辑的 HyperFrames `index.html`、
`index.motion.json`、`source-bindings.json` 和本地素材/字体/组件来源文件。
不运行模型，不改写场景真源，不自动渲染或跳过验收。

```json
[
  {
    "id": "search",
    "order": 1,
    "startSeconds": 0,
    "durationSeconds": 8,
    "onScreenText": "输入关键词，找到已有素材",
    "recipe": "screen-focus",
    "sourceClip": {
      "source": "assets/screen.mp4",
      "sourceIn": 13,
      "sourceOut": 21,
      "audioMode": "preserve",
      "focus": { "anchor": { "x": 0.7, "y": 0.08 }, "zoom": 1.8 },
      "overview": { "introSeconds": 1, "outroSeconds": 2 }
    }
  }
]
```

- `recipe` 固定放场景顶层；唯一可执行目录为 `catalog.json`，前后端共用。
  `screen-overview` 保留全景；`screen-focus` 放大操作后回到全景；
  `screen-highlight` 保留全景并压暗焦点矩形外部；`screen-callout` 在全景上
  增加引线与空心定位圈；`screen-result` 前段全景，片尾放大结果并停留。
  后四种要求明确 focus；highlight 必须矩形，不能凭空猜测区域。
- `source` 必须是项目内真实视频文件；拒绝绝对路径、`..` 和符号链接。
- `sourceIn/Out` 是源媒体秒数，经过 ffprobe 边界核对。只支持 1x，
  `durationSeconds` 默认差值，显式不等就拒绝。`startSeconds` 必须连续。
- `focus` 可改用 `{ "rect": { "x": 0.6, "y": 0.02, "width": 0.2, "height": 0.1 } }`。
  坐标归一化到源画面，zoom 1–3。首段全景，中段聚焦，末段回全景；
  `overview.resultFocus` 可指定末段结果区域。`screen-overview` 全程保留全景。
- `audioMode` 默认 `preserve`。有原声则生成独立同步 audio 节点；video
  本身 muted 防重复混音。无音轨时明确返回警告。静音必须显式写 `mute`。
- 保持原始画面比例并把字幕放在素材外。首版拒绝旋转元数据、非方形像素、
  非零视频 start_time；请先规范显示方向/SAR/时间戳，再以新素材重算 focus。
  视频时长只取视频流，缺失时查视频 packet，绝不借用更长的音轨/容器时长。
- `--width/--height/--fps` 可覆盖 `.yingya/manifest.json` 的 outputSpec
  对应字段；仅有 aspectRatio 时支持 16:9→1280×720、9:16→720×1280、
  1:1→1080×1080、4:3→960×720、3:4→720×960。未知比例要求显式尺寸。
  缺少输出规范时默认 1280×720、30fps。标题过长会拒绝，不截断。
- `--out` 默认 `.`，必须位于项目内。首次可创建；重建会核对上次记录的
  全部生成文件哈希。手动编辑后拒绝覆盖，保留原件并选另一个 `--out`，
  或在明确允许替换这些输出时使用 `--replace`。不删除无关文件。

JS API：`assembleEditorial({ project, scenes, out, width, height, fps, replace })`；
纯结构验证：`validateScenes(array)`。成功返回 `{ ok, entry, bindings,
durationSeconds, sceneIds, warnings, requiredAudioWork, overlayCaptionHidden }`；
失败抛异常，CLI 非零退出并输出 JSON。

局部修改使用受控入口，revision 为当前根 `scenes.json` 原始字节 SHA256：

```bash
node runtime/editorial/edit-scene.mjs --project /absolute/project \
  --scene-id search --expected-revision SHA256 \
  --patch-json '{"title":"检索已有素材","recipe":"screen-callout"}'
```

仅允许 `title`/`onScreenText`、`recipe`、`focus`。保留其他镜头、全部源区间、
原音策略和语义证据；返回 `{ok, changedSceneIds, summary, scenesRevision}`。
没有明确 focus 时不能切到需要焦点的方案。先验证、暂存完整输出，再复核 revision
与原文件哈希，使用 `.yingya/editorial-edit/transaction.json` 可恢复事务发布；
失败回滚，手动改过的工程拒绝覆盖。后端负责当前版本与任务占用约束。
更新后的 HTML 可直接由现有预览刷新；未实现独立镜头渲染缓存。

读取 `.yingya/requirements.json`，缺失则读取 manifest.outputSpec.requirements。
要求同时写入 bindings 和 `assets/editorial/requirements.snapshot.json`；导出旧版本
优先验证该冻结快照。`mute` 输出无源音频，`preserve` 保留真实原音；`subtitles:none`
隐藏本装配器新增的底部说明字幕（`overlayCaptionHidden:true`），保留原素材文字和
SVG 指示标注。它不是通用对白识别/删除器；关闭时局部编辑说明仍保存但不会显示。
`exact`/`max` 在装配与实际 MP4 验收时约束时长，不自动变速。

本装配器不自动生成配音/背景音乐。要求 `narration`、`replace` 或 `music:on` 时
返回 warnings 和 `requiredAudioWork`，原声不能充当已完成的配音/音乐。
补充制作后须使用静态 `<audio data-editorial-audio-role="narration|replacement|music">`
节点、独立项目内真实音频、明确 data-start/data-duration/data-media-start 和 1x
零起点 WAV/M4A；生产验收核对这些证据和实际成片音轨。角色标签只能证明结构，
不能证明配音说对了、音乐合适或混音质量，报告明确 semanticVerified:false。

`source-bindings.json` schemaVersion=1，绑定 entrySha256、scenesSha256、
素材 SHA256、源 in/out、输出 start/duration、videoId、mediaSrc、focus/overview
和 generatedFiles 哈希。所有可验证路径均相对输出入口；scenesFile 指输入场景
原文的只读证据副本 `assets/editorial/scenes.snapshot.json`。编辑仍用原
`scenes.json`，重新装配刷新证据。originalPath/originScenesFile 仅记录来源。

相机复用 HeyGen `ui-focus-zoom` 的 translate/scale 法则和缓动。原件、SHA、
Apache-2.0 许可证及适配记录见 `vendor/PROVENANCE.json`。必要适配固定在本模块：
静态 video、单层时间线、按绝对时间纯计算 transform、移除共享漂移状态、
首尾全景、字幕和主体分区。此为组件的确定性适配，不是原封不动安装后即用。
高亮和操作引线为 Yingya 添加的 SVG 覆盖层；结果镜头复用同一相机表达，
仅调整进入聚焦的时段。没有把五种方案声称为五个独立上游组件。
GSAP 3.14.2 单独遵循 GSAP Standard License，不属于 Apache-2.0；文件和官方
许可证页面快照一同保留。字体来自现有 Noto Sans SC 包及其 OFL 许可证。

验证：`node --test tests/editorial-composition.test.mjs`。装配通过只证明文件与
片段绑定有效；仍须执行 HF check/render、实际 MP4 抽帧和语义审片。
