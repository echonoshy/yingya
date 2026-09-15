# 模型中继发布验证

## 当前版本：移除共享限制

2026-09-15 发布 `20260915-170741-no-model-limit`，基于下述上一版本，移除账号＋模型
并发上限、跨用户排队和共享冷却。旧调度状态文件不再读取。

- 格式检查、Clippy 通过；Rust 134 项通过、1 项按原配置忽略。
- 模拟上游验证：三个不同用户可以同时保持同账号/模型的响应流；一个用户收到
  带 `Retry-After: 120` 的 503 后，另一个用户立即请求成功。
- 公网脚本/CSS 与发布快照一致且 HTTP 200；1440/390/320 宽度下等待、键盘停止、
  完成和失败状态检查通过（事件使用隔离模拟）。
- 活动 API `/health`、`/ready` HTTP 200，所有存活 worker 已切换新版。
- 真实模型列表 HTTP 200；一次 GPT-6 Astra 最小生成请求收到 HTTP 200 流内
  `server_is_overloaded`，诊断为 `provider_error`、`queue_ms=0`，总耗时 2010 ms。
  这是上游仍存在的过载，未触发任何本地共享排队或冷却，不能报告为生成成功。

| 服务 | 当前 tmux 会话 | 端口 |
| --- | --- | --- |
| 入口 | `yingya-entry-22925192` | 8797 |
| API | `yingya-api-22925192-20260915-170741-no-model-limit` | 54229 |
| 本次项目 worker | `yingya-worker-22925192-9b4acd65-354a-4019-8783-b707ef12fdd1` | 35855 |

## Git 提交与追加重启检查

- 单独检出待提交的 Git 索引验证，不包含其他未提交功能：格式检查、Clippy、
  130 项 Rust 测试和 3 项代理/服务测试通过，1 项环境专项测试按原配置忽略。
  沙箱测试首次因检出目录缺少 node_modules 失败；确认 lockfile 一致并挂载依赖后重跑通过。
- 按用户要求逐个请求 worker 平滑重启，4 个空闲 worker 已完成，端口分别为
  45599、36575、40191、36887。检查时项目所属 worker 仍有运行中的工作，
  已进入排空状态，任务结束后由现有管理器自动重启；未中断视频任务。
- 上述 worker 均已加载 `20260915-170741-no-model-limit`，去掉共享限制的功能
  已生效，不依赖这次追加重启。入口/API 继续健康运行。

## 上一版本历史记录

验证时间：2026-09-15，Asia/Shanghai。

- 公网：<https://yingya.art/app#/>
- 发布：`20260915-165428-model-relay`
- 发布基础：`20260915-165159-video-audit`。从该不可变快照构建，仅叠加本次中继、
  沙箱代理、恢复预算和诊断脚本相关改动；保留已有视频审计功能。
- 实现与配置：[MODEL_RETRY.md](MODEL_RETRY.md)。

## 检查结果

- `npm run format:check`、`npm run lint:rust` 通过。
- Rust：137 通过，1 个环境专项测试按原配置忽略。
- 前端：typecheck、1531 项测试、生产构建通过。
- `npm run test:services`：3 项通过，涵盖大输出、代理取消和断流。
- `RollingRuntime.test_model_overload_recovers_and_stop_cancels_backoff` 通过：
  使用真实 API/worker、隔离数据和 tmux，Codex 上游为可控模拟。
- 传输测试覆盖新版关联头、凭据隔离、共享冷却、未发出的排队请求不计费、
  取消/读取超时释放槽、跨进程锁及进程退出释放。
- 公网 `/app` 与新快照均引用 `index-DSDvLL4f.js`、`index-BUIBtPiu.css`；
  两个公共资源 HTTP 200。此次没有修改 UI，因此资源哈希保持一致。
- Playwright 使用公共页面，在 1440/390/320 宽度验证等待、键盘停止、完成、
  最终失败和减少动画模式，没有控制台错误。这部分事件使用隔离 API 模拟。
- 当前线上 worker 的真实宿主中继：模型列表 HTTP 200；GPT-6 Astra 最小请求
  HTTP 200，收到 `response.completed` 和预期回复。请求实际 tier 为 `default`，
  记录总耗时 2743 ms。单次连通测试不能用来判断延迟或过载率改善。
- 诊断 JSONL 正常写入，权限 0600；记录包含上游状态、时间和用量，不包含请求正文。
- 激活 API 的 `/health`、`/ready` 均 HTTP 200；检查时所有存活 worker 均已切换到
  新版本，没有排空中的旧 worker。

## 服务位置

| 服务 | tmux 会话 | 端口 |
| --- | --- | --- |
| 公网入口 | `yingya-entry-22925192` | 8797 |
| 活动 API | `yingya-api-22925192-20260915-165428-model-relay` | 49029 |
| 本次项目所属 worker | `yingya-worker-22925192-9b4acd65-354a-4019-8783-b707ef12fdd1` | 43765 |

worker 的端口会随后续启动变化，以 `npm run release:status` 为准。
没有切换生产上游账号，也没有启用上游 WebSocket；同账号对照和并发负载实验尚未开展。
