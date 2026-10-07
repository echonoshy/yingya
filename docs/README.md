# 映芽文档

[返回产品介绍](../README.md) · [English overview](../README.en.md)

| 文档 | 内容 |
| --- | --- |
| [安装与本地开发](DEVELOPMENT.md) | 环境准备、启动服务、运行配置、API 连通检查与测试 |
| [服务集成](INTEGRATIONS.md) | Codex 图像生成、HeyGen 配乐音效、Remotion 工具与 VoxCPM2 语音 |
| [模型过载重试](MODEL_RETRY.md) | 重试条件、宿主中继、恢复边界与验证 |
| [视频分享](VIDEO_SHARING.md) | 不可变分享副本、访问权限与版本 |
| [Remotion 运行时](REMOTION_MIGRATION.md) | 单引擎契约、浏览器准备、检查边界与发布验证 |
| [产品定位](PRODUCT_POSITIONING.md) | 目标用户、制作场景、能力边界与产品表达 |
| [用户沙箱与用量统计](USER_SANDBOX.md) | 内测登录、账号隔离、预览权限与用量口径 |
| [不停机更新与任务恢复](ROLLING_UPDATES.md) | 单机滚动发布、独立 Worker、回滚与任务恢复边界 |
| [开发版本与更新说明](VERSIONING.md) | 三段式版本号、开发记录、最近 5 个补丁版本说明与发布校验 |
| [视频制作流程](VIDEO_PRODUCTION_WORKFLOW.md) | 方案确认、旁白与分镜对齐、草稿检查与导出 |
| [项目结构](PROJECT_STRUCTURE.md) | 源码、用户数据、工具缓存与清理规则 |
| [字体维护](TYPOGRAPHY.md) | 字体分工、许可、字形覆盖与子集重建 |
| [界面设计规范](UI_DESIGN_STYLE.md) | 产品布局、设计令牌、交互与无障碍要求 |

## 相关参考

- [VoxCPM2 运维说明](../deploy/voxcpm2/README.md)：语音服务生命周期、音色与请求示例。

- 当前首页媒体来源：`web/src/assets/showcase/encoding.json`；用途短片源工程：`design-assets/capability-reels/`。
- 旧 UI 素材仅保存在本机 `local-ui-archive/`，不参与 Git 跟踪、构建或发布；过期文档与失效测试直接删除。
