# 模型过载重试

视频项目执行收到已结束的 `turn/completed(status=failed)`，且错误类别为
`serverOverloaded` 时，映芽最多自动重试 5 次。等待基准为 5、10、20、40、60 秒，
附加 ±10% 随机延迟，单次等待不超过 60 秒。

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

- Rust 协议测试：恢复成功、连续过载上限、等待中停止、上下文错误、其他错误、
  Codex 原生重试、独立图片调用；校验 thread/模型/附件不被重复提交。
- 真实 API + worker 集成：
  `python3 tests/rolling-runtime.test.py RollingRuntime.test_model_overload_recovers_and_stop_cancels_backoff`。
  使用独立 tmux 与数据目录，并模拟 Codex 过载。
- `eventTimeline.test.ts` 验证等待不被失败 turn 提前覆盖、恢复后收敛、停止、最终失败及旧错误文案。
