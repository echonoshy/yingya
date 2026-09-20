# 映芽可编辑视频 API 与 MCP

编辑器与 AI 使用同一命令模型：`runtime/editor/model.d.mts`。文档格式版本为 1。
现有账号、项目隔离和会话认证继续生效；新接口不开放匿名写入。

## HTTP

先使用 `/api/auth/login` 登录并保留会话 cookie，再从 `/api/auth/me` 获取自己的用户 ID。
以下路径均位于 `/api/u/USER_ID` 下；浏览器发送同源 Origin，程序客户端也应发送该站点 Origin。

| 路径 | 方法 | 用途 |
| --- | --- | --- |
| `/agent-projects` | GET / POST | 列表 / 创建项目 |
| `/agent-projects/ID/composition` | GET | 读取工程、revision、canUndo/canRedo |
| `/agent-projects/ID/composition` | POST | `{action, request}`：init、command、checkpoint、restore |
| 同上 | POST | library-list、brand-save、brand-load、library-delete、template-save、template-load |
| `/agent-projects/ID/turns` | POST | 向 AI 提交创作或局部修改 |
| `/agent-projects/ID/checkpoint` | POST | 确认制作计划 |
| `/agent-projects/ID/render` | POST | 渲染不可变版本 |
| `/video/capabilities` | GET | 查询真实可用视频生成能力 |
| `/agent-projects/ID/footage` | GET / POST | 查询并导入生成结果 / 提交生成 |
| `/agent-projects/ID/footage/JOB/cancel` | POST | 取消待执行或运行中的片段生成 |

command 请求：

```json
{"action":"command","request":{"expectedRevision":4,"requestId":"unique-operation-id","command":{"type":"element.update","sceneId":"scene-id","elementId":"title-id","patch":{"text":"新标题"}}}}
```

品牌资料可保存项目内 PNG／JPEG／WebP 标识（最多 5 MB）；brand-load 将独立保存的标识复制到目标项目，品牌应用后仍是可编辑图层。模板依赖与原项目解耦；删除原项目不会破坏模板。

409 表示修订冲突，重新读取后再决定修改；同一 requestId 只可用于完全相同的重试。
checkpoint 创建独立的源文件版本，尚不代表 MP4 已渲染。render 的结果在项目 renderJobs 中查询，完成后 outputPath 才可下载和分享。
已存在的自定义 HTML 不会被工程初始化覆盖；旧版入口继续支持原来的预览与 AI 修改。

## MCP

启动：`node runtime/editor/mcp.mjs`，使用标准 stdio transport。

远程 API 模式在 MCP 客户端环境中设置 `YINGYA_API_URL`（例如 `https://yingya.art`）和
`YINGYA_API_COOKIE`，或设置 `YINGYA_API_EMAIL` / `YINGYA_API_PASSWORD`。
凭据只从环境读取，不作为工具参数或工具输出；远程地址要求 HTTPS。
提供项目创建、AI 修改、计划确认、任务状态、取消、渲染、视频能力与生成、工程命令、模板工具。

本地固定工程模式设置 `YINGYA_EDITOR_PROJECT` 为该项目绝对路径，
可选 `YINGYA_EDITOR_LIBRARY` 指定个人资料库路径。该模式直接使用工程存储，不调用远程账号。
MCP 客户端必须以拥有该目录权限的用户运行。工具不能通过参数切换到其他目录。

## 可选视频供应商

部署环境设置 `YINGYA_RUNWAY_API_SECRET` 后启用 Runway Gen-4.5 文字／图片生成视频。
未配置时能力接口返回 unavailable，UI 明确显示服务未连接；不以假结果代替真实片段。
支持 2–10 秒、16:9 和 9:16；参考图来自当前项目，最大 3.5 MB。生成结果下载、实测时长后登记项目素材。
查询间隔至少 5 秒，任务记录持久保存，重启后可继续查询。每个项目最多 3 个等待／运行任务。
提交前持久化请求标识；网络结果不明确时保留 unknown，禁止自动重复提交以免重复计费。

供应商协议依据 [Runway 官方入门文档](https://docs.dev.runwayml.com/guides/using-the-api/)、
[官方 text-to-video SDK 源码](https://github.com/runwayml/sdk-node/blob/main/src/resources/text-to-video.ts)、
[image-to-video](https://github.com/runwayml/sdk-node/blob/main/src/resources/image-to-video.ts) 和
[tasks](https://github.com/runwayml/sdk-node/blob/main/src/resources/tasks.ts)。检视日期 2026-09-19。
尚未配置供应商时，本地和模拟验证不代表真实供应商生成已验收。
