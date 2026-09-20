# 素材导航与编辑器布局修复（2026-09-20）

用户截图指出素材工坊导航与首页不一致、编辑器对话区过窄和工程等待空白。本轮修复延续映芽浅色设计，不改变现有作品内容。

## 发现与修复

| 问题 | 修改 | 验证 |
| --- | --- | --- |
| 首页与素材库分别维护导航，入口数、Logo 位置、栏宽不同 | 共用 AppNavigation；统一 208px 栏宽和新建、创作、风格、项目、素材入口；文件夹作为素材页附加区域 | 同视口测量 Logo 坐标和导航宽度，跨页跳转、重复定位 |
| 编辑器固定窄面板，宽屏画布与长对话比例失衡 | 对话默认约 30% 视口宽，工具默认 340px；拖动分隔线，分别记忆两种宽度；窗口变窄时限制边界 | 鼠标拖动、刷新、方向键、Home/End、双击复位、折叠、1024px 画布下限 |
| 工程读取没有前端超时，并与写操作共用任务锁 | 读取原子快照不再等待任务锁；15 秒超时、取消过期读取、去重和重试，避免旧响应覆盖新修订 | Rust 检查；浏览器模拟 503/超时与恢复。线上真实读取另行记录 |
| 旧项目有已保存视频但无新工程文件，画布空白 | 优先提供已有版本视频预览、真实时长与播放定位、视频预览轨道及原有工具入口 | 实际 MP4 在工程超时期间仍播放；旧视频不声称拥有可直接编辑的图层 |
| 分隔线方向键与编辑元素快捷键冲突 | 分隔线聚焦时排除元素快捷键；原有工作区不响应新编辑器快捷键 | 选中标题后调宽不移动元素 |
| 320px 素材文件夹栏溢出、来源按钮文字挤行 | 约束可滚动文件夹栏宽度，来源与批量操作分行 | 390/320px 截图和页面宽度断言 |

## 已完成检查

- `npm run typecheck`、`npm run web:build` 通过。既有第三方注释及大包提示仍存在。
- `npm run format:check`、`npm run lint:rust` 通过；Rust 163 项通过、2 项按既有配置忽略。
- 前端 Vitest 93 项通过（排除不可变发布目录和数据目录）；工程模型与 MCP 11 项通过。
- `tests/editor-layout-browser.mjs`：共享导航、文件夹、跨页定位、鼠标/键盘调宽、刷新恢复、上下限、折叠、播放、窄屏、读取失败重试、旧视频超时预览。
- `tests/editor-browser.mjs`：创建、模板插入、直接编辑及实际 iframe 预览、撤销重做、刷新、键盘与减少动效。
- 原 UI 回归实际选择 `assertAssetWorkshop,assertFunctionalEnhancements,assertCreateAndMobile`：批量移动、素材和文件夹管理、设置/文件保持、任务入口、会话编辑、音频、版本反馈、手机创建和输入。测试脚本末尾的通用日志包含未选择的流程，不作为额外通过依据。
- 浏览器插件在本次工具列表中不可用，使用本机 Playwright Chromium。以上自动回归使用隔离 API mock，编辑命令引擎和 MP4 播放为真实实现；不能据此宣称外部 AI 生成服务已恢复。

## 视觉证据与复核

截图目录 `/tmp/yingya-ui-repair/`：`before-home.png`、`before-assets.png`、`before-editor.png`；修复后 `after-home.png`、`after-assets.png`、`after-editor.png`、`after-assets-390.png`、`after-assets-320.png`、`after-editor-390.png`、`after-editor-320.png`、`after-legacy-video.png`。

初始公开页截图中的加载区域只用于核对导航和栏宽，不作为“永久卡住”的独立证据；加载恢复问题另以用户截图、代码路径及故障注入验证。

已按 `docs/UI_DESIGN_STYLE.md` 检查中性色与语义 token、中文层级、Logo/Phosphor 图标、焦点、分隔线键盘操作、输入框可达、长文字和窄屏。首次截图中双重文件夹分割线和窄屏按钮挤行已经修正。未进行整站逐项对比度审计，也未重新运行外部供应商完整生成长任务。

## 发布

已发布 `20260920-103905-ui-layout`，公开地址 https://yingya.art/app#/ 。保留上一版 `20260920-002759-motion-editor` 作为兼容回滚版本。

- 入口：tmux `yingya-entry-22925192`，端口 **8797**。
- API：tmux `yingya-api-22925192-20260920-103905-ui-layout`，端口 **59195**。
- 测试账号 worker：tmux `yingya-worker-22925192-efca3262-bc66-43af-a0dc-e65bd3d01102`，端口 **42763**。
- Vite 开发服务仍为 `yingya-frontend` / **8798**；没有用开发服务代替线上发布。
- `/app` 引用 `index-7SM9OQxC.js`、`index-Dy7cRcZs.css`；公开文件和已加载的 AccountGate JS/CSS 与新发布快照逐字节哈希匹配。
- 活跃 API `/health` 返回新发布 ID，`/ready` 正常。测试账号真实工程读取 254ms，素材模板库读取成功。
- 正式站点真实账号、无 API mock：共享导航、搜索/来源筛选、项目定位、鼠标/键盘调宽、刷新保持、实际工程播放、390/320px 页面不溢出；没有浏览器脚本异常。
- 当前 10 个存活 worker 的发布登记与各自 tmux 启动日志均确认新版本。直接调用 worker 健康路径受到内部访问限制，因此 worker 版本证据采用发布状态和日志，并通过正式网关验证实际工程 API。
- Nginx 配置检查和切换成功；命令输出仍有默认 `/var/log/nginx/error.log` 写权限提示，未阻止 readiness、公开资源和浏览器验证。
- 验证记录 `/tmp/yingya-ui-repair/public-verification.json`、`worker-verification.json`，公开截图 `public-home.png`、`public-assets.png`、`public-editor.png` 及 `public-*-390.png`、`public-*-320.png`。故障注入、批量素材操作和旧视频超时场景仍为隔离模拟验证，不当作真实外部生成服务验收。
