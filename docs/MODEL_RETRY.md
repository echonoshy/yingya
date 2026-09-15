# 模型过载重试

视频项目执行收到已结束的 `turn/completed(status=failed)`，且错误类别为
`serverOverloaded` 时，映芽最多自动重试 5 次。等待基准为 5、10、20、40、60 秒，
附加 ±10% 随机延迟，单次等待不超过 60 秒。
首次失败后的恢复窗口为 300 秒，后续等待和 Codex 原生重试耗时均计入窗口；
超过窗口不再开启新的恢复 turn。已开始执行的 turn 不会被这个窗口强行中断，
因此它不是整个视频任务的总时长上限。

## 宿主中继

- 透传 Codex 0.154.0 的 `session-id`、`thread-id`、`x-client-request-id` 等协议头，
  同时保留旧版别名。实际认证和账号头仍只由宿主注入。
- HTTP/SSE 中继读取超时默认 330 秒，晚于 Codex 默认的 300 秒 SSE 空闲超时；
  连接超时仍为 15 秒。这里的读取超时是两次数据到达之间的等待，不是任务总时长。
- 不按共享上游账号或模型限制并发，不增加跨用户排队或共享冷却。
  一个用户收到过载/限流错误时，不阻止其他用户发送请求。上游 `Retry-After`
  原样透传给对应客户端，错误恢复仅作用于对应任务。
- 中继本身不重放请求，保留 Codex 原生请求/流重试与上述已确认失败 turn 的恢复边界。
  沙箱代理在客户端停止时关闭对应上游连接；上游断流不会伪装成正常 EOF。
可配置环境变量（随新 release 生效）：

| 变量 | 默认 | 范围 |
| --- | --- | --- |
| `YINGYA_MODEL_READ_TIMEOUT_SECS` | 330 | 330–3600 |

## 诊断与对比

宿主 Codex home 的 `model-relay/requests.jsonl` 保存每次中继请求的结构化元数据，
权限 0600，单文件约 8 MiB，最多保留当前文件和两份轮转文件。
记录模型、请求/实际服务等级、状态码、错误码、上游 request ID、响应头/首字节/
总耗时和用量；账号与请求正文只记录 SHA-256 摘要。不会保存提示词、凭据或原始错误文案。

```bash
python3 scripts/model-relay-report.py --hours 24
```

报告区分连接/响应头/流超时、上游 HTTP 错误、流内模型错误和取消。
为兼容历史报告保留 `queue_ms` 字段，新版本始终为 0；历史准入失败记录仍可查看。
`headers_ms`、`first_byte_ms` 都从中继收到请求开始计时，首字节可能是
SSE 心跳或 created 事件，不能当作首个模型 token 的延迟。`repeated_payloads` 只是
相同请求内容的重复次数，可能包括用户重复操作，不能直接当作 Codex 原生重试次数。

比较 Codex 直连与映芽时，先固定同一上游账号、模型、推理强度、服务等级和输入，
使用隔离测试会话，交替采样；再单独比较并发 1/2/4。分别统计过载率、超时率、
请求耗时及完整完成率。一次成功请求只能证明连通，不能证明过载率降低。
账号套餐和入口不同的对比不能归因给 App Server。此次不切换生产账号或启用上游 WebSocket；
WebSocket 需要独立测试协议、代理、取消及计费，不能仅通过设置开关上线。

## 恢复边界

- 保持原 thread、模型、推理强度和项目任务身份；后续 turn 发送继续执行指令，
  不重复发送原始请求或附件。要求 Agent 核对已有成果和外部任务，只继续剩余步骤。
  这不是外部工具的事务回滚或绝对去重保证。
- 等待期间任务仍为运行中，队列保持串行；停止会立即取消等待。
- Codex 的 HTTP/流中断重试保留。只有确认结束的模型过载触发映芽的会话恢复；
  登录、额度、上下文超限、结果未知的超时或连接中断不进入这套重试。
- 重试期间如果出现其他错误，立即结束；达到上限后暂停队列，提示稍后重试或换模型。
- 仅视频项目执行启用，独立图片生成等调用不自动重放。worker 崩溃仍按原有中断恢复
  规则暂停，旧失败项目不会在发布后自动启动。
- `project/modelRetry` 持久化等待、运行、完成、停止及失败状态。活动记录按 `retryId`
  合并，并用 `failedTurnId` 关联各次过载；一个失败的 Codex turn 不会提前结束重试提示。

## Codex 参考

项目固定版本为 `@openai/codex@0.154.0`。官方配置文档列出 HTTP 请求默认重试 4 次、
SSE 中断默认重试 5 次：[Configuration Reference](https://developers.openai.com/codex/config-reference/)。

核对相同版本的实现：

- [retry.rs](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/codex-client/src/retry.rs)：
  按错误类型和次数上限重试，指数退避并加入 ±10% 随机延迟。
- [responses.rs](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/codex-api/src/sse/responses.rs)：
  `server_is_overloaded` 单独映射为 `ApiError::ServerOverloaded`。

本次真实项目记录中该类别返回 `willRetry: false` 并结束 turn。因此本功能是映芽增加的
应用层恢复，不是单纯调大 Codex 的 `stream_max_retries`，也不声称 Codex 本身会执行
上述 5–60 秒策略。

## 验证

- 中继传输测试：三个用户同时使用同一上游账号/模型；一个用户收到 503 后，
  另一个用户立即请求成功；旧调度状态文件不再影响新请求。

- Rust 协议测试：恢复成功、连续过载上限、等待中停止、上下文错误、其他错误、
  Codex 原生重试、独立图片调用；校验 thread/模型/附件不被重复提交。
- 真实 API + worker 集成：
  `python3 tests/rolling-runtime.test.py RollingRuntime.test_model_overload_recovers_and_stop_cancels_backoff`。
  使用独立 tmux 与数据目录，并模拟 Codex 过载。
- `eventTimeline.test.ts` 验证等待不被失败 turn 提前覆盖、恢复后收敛、停止、最终失败及旧错误文案。
