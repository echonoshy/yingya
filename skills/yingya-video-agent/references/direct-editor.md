# 可直接编辑的视频工程

新制作优先使用可直接编辑的镜头工程。已有自定义 HTML 不强制转换，不覆盖旧作品。
用户的制作方式、风格和流程选择位于 `.yingya/requirements.json`：

- `creationMode: motion`：多镜头动画；`single`：只能一个镜头；`edit`：须先分析上传视频，保留真实源入点与用户的音频要求；`ai-video`：仅兼容读取历史字段。本阶段不得探测或调用视频生成供应商；保留历史文件并说明新素材缺口。
- `styleId`：从运行时 `editor/catalog.mjs` 读取该风格约束，客户内容替换样例。模板是可插入片段，风格是全片约束。
- `reviewMode: auto`：已有明确请求时写简短计划后继续完成制作；只有无法推断的关键事实或额外付费授权才等待。`review` 或未指定：继续执行原方案确认流程。
- `aspectMode: auto`：根据交付用途和素材决定画幅，在制作前同步项目与 manifest 的画幅；不要把默认值当作用户硬性约束。

## 统一修改接口

`node "$YINGYA_EDITOR" --project . --action read </dev/null` 返回 `revision` 和 `document`。
若 `available: true`，必须以该数据为当前制作内容；手动修改与 AI 修改共用命令。

输入上下文里的 `editor-target:` JSON 指定用户当前选中的 `sceneId`、`elementId` 和 `revision`。局部修改优先使用这些稳定标识，读取最新工程后核对对象，不能根据名称误改其他镜头。该选择只是修改上下文，用户明确要求全片修改时遵循用户的范围；排队任务开始时若对象已被删除，应说明原因而非自动选中其他对象。

读取 `$YINGYA_EDITOR` 同目录的 `model.mjs` 和 `model.d.mts` 查看完整结构与支持命令。
向命令 stdin 传入 JSON（不要把长 JSON 拼进 shell 参数）：

```json
{"expectedRevision":4,"requestId":"unique-operation-id","command":{"type":"element.update","sceneId":"scene-id","elementId":"title-id","patch":{"text":"用户要求的新文案"}}}
```

运行 `--action command`；修订冲突后重新读取，核对用户修改后再计算命令，不能盲目重放旧工程。
使用 `scene.add/update/move/remove/split`、`element.add/update/remove`、`track.add/update/remove`、`brand.apply` 或原子 `batch`。
保留未被请求的镜头、元素、素材与声音；不能覆盖 `state.json`、重建全部工程或直接修改编译 HTML 来绕过修订检查。

新项目使用 `--action init`，stdin 为 `{"document": ...}`。先构造有效的完整工程；已存在时 init 拒绝覆盖。
`emptyDocument`、`newElement`、`templateScene` 可从同目录模块导入。所有音视频需要实测时长 `sourceDuration` 与合法 `sourceIn`。

`--action checkpoint` 接收 `{"expectedRevision":5,"requestId":"unique-snapshot-id"}`，返回不可变 `versionId`、`sourcePath` 和 `revision`。
快照包含字体、素材与 `editor-document.json`，由同一编译器产出 `index.html`。在该快照执行检查与渲染。
按已有版本提交契约登记快照结果、真实视频路径、检查记录和 manifest；不要登记不存在的 MP4 为已完成预览。
页面可在没有 MP4 时播放可编辑工程，导出仍必须实际渲染。

旧自定义 HTML 工程继续使用原来的源文件和版本流程；可将成片作为视频素材插入新工程，不能声称其任意文字已转换为图层。
