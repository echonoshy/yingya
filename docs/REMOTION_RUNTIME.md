# Remotion 运行时

Remotion 是唯一制作与导出引擎。新项目使用 Remotion，无需试运行开关。
旧 HTML 工程不再编辑或重新渲染；旧引擎依赖、安装器、模板、装配器、外部 Studio
和播放器适配已退出当前链路。旧项目数据按管理员明确授权清理，不在启动时批量删除。

## 项目契约

- `remotion.json`：`schemaVersion: 1`、`engine: "remotion"`、入口、画幅、整数帧率/帧数、props 和 media。
- `src/Video.tsx`：默认导出的 React 画面组件，以 `useCurrentFrame()` 驱动画面。
- `media`：所有音视频的素材路径、起始帧、持续帧、源入点、音量和用途；宿主统一挂载。
- `build` 生成 `index.html`、Player 资源及 `remotion-build.json`。源或素材改变后必须重建。
- 快照保留 TSX、配置、素材、生成预览、构建凭证、场景和制作要求。不能手改凭证认证过期源码。
- 缺少或无效引擎标记直接失败。初始化拒绝覆盖已有源。导出 FPS 必须等于源帧率。

## 检查边界

检查覆盖构建、源码新鲜度、浏览器启动、代表帧和媒体区间，不自动认证排版、对比度、
讲解质量或审美。制作 Agent 仍须检查实际画面、运动和声音。持久任务保留锁、取消、
超时、结果复用、源/产物哈希、媒体完成凭证、完整解码和实际 MP4 抽帧。

## 浏览器和宿主适配

`npm run browser:ensure` 安装 Playwright 固定版本的 Chromium；`npm run browser:path`
返回入口。可用 `YINGYA_BROWSER_PATH` 指定可执行文件。后端先解析路径，再通过只读
沙箱挂载和浏览器包装器交给 Agent 与 Remotion，不依赖其他视频引擎。

Ubuntu 20.04 的 glibc 2.31 不满足原生 compositor 的 2.35 要求。
`scripts/setup-remotion.py` 校验固定 SHA-256 的 Ubuntu 包并提取发布目录内的独立库，
不安装系统包、不覆盖系统链接器。归档缓存在 `.runtime/remotion-downloads`；
glibc >= 2.35 的主机使用原生依赖。标准 release build 自动准备浏览器与运行库。

## 验证与发布

运行 Rust fmt/clippy/tests、前端 typecheck/build、生产任务测试、Remotion 构建和浏览器
音视频导出测试。发布不可变 release，再核对公网资源、活跃 API/worker 与受控导出。
旧 release 保留到滚动任务交接与安全清理完成；不修改正在使用的快照。

## 生产技能与媒体准备

主制作 skill 统一方案确认、内部审阅与直接交付；显式分阶段审稿和旧草稿检查点仍兼容。
原 faceless-explainer 已并入叙事参考。原生讲解组件通过组件工具 catalog/view/install
获取；旧 presentation 字段按表达意图解释，不再假定 Anime.js 或旧 HTML 组件可直接使用。

字幕由宿主预置的离线 faster-whisper small 提供真实词时间戳，并与稿件比较；结果必须校对，
不将识别成功等同于对齐精度通过。淡入淡出、响度标准化和音乐闪避通过音频工具生成新 WAV，
再进入统一 media 帧表。模型和 Python 环境按版本只读挂载，项目 turn 不安装依赖。
