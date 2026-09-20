# 映芽内部合成 API 与 MCP

制作系统使用内部命令模型（不提供用户编辑器）：`runtime/editor/model.d.mts`。文档格式版本为 1。
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

command 请求：

```json
{"action":"command","request":{"expectedRevision":4,"requestId":"unique-operation-id","command":{"type":"element.update","sceneId":"scene-id","elementId":"title-id","patch":{"text":"新标题"}}}}
```

品牌资料可保存项目内 PNG／JPEG／WebP 标识（最多 5 MB）；brand-load 将独立保存的标识复制到目标项目，品牌应用后仍是可编辑图层。模板依赖与原项目解耦；删除原项目不会破坏模板。

409 表示修订冲突，重新读取后再决定修改；同一 requestId 只可用于完全相同的重试。
checkpoint 创建独立的源文件版本，尚不代表 MP4 已渲染。render 的结果在项目 renderJobs 中查询，完成后 outputPath 才可下载和分享。
已存在的自定义 HTML 不会被工程初始化覆盖；现行工作区通过方案与视频预览、对话反馈完成修改。

## MCP

启动：`node runtime/editor/mcp.mjs`，使用标准 stdio transport。

远程 API 模式在 MCP 客户端环境中设置 `YINGYA_API_URL`（例如 `https://yingya.art`）和
`YINGYA_API_COOKIE`，或设置 `YINGYA_API_EMAIL` / `YINGYA_API_PASSWORD`。
凭据只从环境读取，不作为工具参数或工具输出；远程地址要求 HTTPS。
提供项目创建、AI 修改、计划确认、任务状态、取消、渲染、工程命令、模板工具。

本地固定工程模式设置 `YINGYA_EDITOR_PROJECT` 为该项目绝对路径，
可选 `YINGYA_EDITOR_LIBRARY` 指定个人资料库路径。该模式直接使用工程存储，不调用远程账号。
MCP 客户端必须以拥有该目录权限的用户运行。工具不能通过参数切换到其他目录。
