# 生成镜头：Image Gen → H3 → Remotion

映芽已内置 `minimax-h3-local`。需要新角色动作、真实质感短片或复杂运动时使用它；图表、精确文字和数字仍用 Remotion。H3 是素材生成器，Remotion 继续负责整片剪辑、字幕、混音、预览和最终交付。生成画面不能冒充真实事件记录。

## 在现有方案中选择

先读 `$CODEX_HOME/skills/minimax-h3-local/SKILL.md` 和它的 `references/prompt-writing.md`。用客户端 `health`、`capabilities` 做只读检查，确认对应模型已下载及当前参数。不可用时说明实际限制并提出合适替代，不默默交付静态图。

在现有方案中注明哪些镜头需要生成、底图/参考来源、主要动作、4–15 秒片段时长及原声用途。方案关键帧可以使用真实 Image Gen 底图；明确它是静态设计稿，不称其为已生成的视频帧。未授权制作时不以能力探测为由提交视频任务；既有授权允许继续时不另设 H3 确认关卡。

## 制作与恢复

1. 对需要先确定构图的镜头，调用可用的原生 Image Gen 生成底图并保存到项目 `assets/`，实际打开检查。用户已有底图时直接检查和使用。先设计单帧初始姿态，再编写从该姿态出发的运动提示词。没有图像生成工具时如实说明；不伪称已使用 Image Gen。
2. 在 `.yingya/h3/SCENE_ID-prompt.txt` 保存完整 H3 提示词，旁边保存输入文件、参数、用途、素材编号以及稍后返回的任务 ID。通常以底图作为 `--first-frame`；只有明确需要终点约束时加 `--last-frame`。角色/风格/音色参考用 reference 模式，不能与首尾帧混传。沿用同一素材和已检查的参考来维持镜头一致性，不承诺绝对一致。
3. 优先先做一个代表片段。示例命令（使用项目实际路径和场景编号）：

   ```bash
   h3_client="$CODEX_HOME/skills/minimax-h3-local/scripts/h3.py"
   python3 "$h3_client" generate --mode frames --first-frame assets/scene-01-start.png --prompt-file .yingya/h3/scene-01-prompt.txt --duration 6 > .yingya/h3/scene-01-job.json
   python3 "$h3_client" status JOB_ID
   python3 "$h3_client" download JOB_ID --output assets/scene-01-h3.mp4
   ```

   启动前读取本场景已有任务记录，不覆盖它。异步提交后立即保留返回的 ID，排队/加载/生成都不是失败，轮询同一 ID。提交断线且未收到 ID 时记录不确定状态，不能自动重复提交。恢复时先查原任务；新生成需新记录和文件名，不覆盖历史素材。不要列出共享服务所有任务。只有未开始的本项目任务可以取消；服务串行排队，不重复提交来加速。
4. 完成后下载到项目中，运行 ffprobe 检查实际时长、尺寸、帧率和音轨，查看首/中/尾帧并检查运动与声音。服务的 768p、24fps 素材按实测规格合成；1080p 导出不等于原生 1080p 生成。质量不符时按具体缺陷修改一个因素再生成，连续两次同类失败先报告限制，不无限重试。
5. 把 MP4 注册为项目素材，并按 `remotion.md` 放入 `media` 帧表，处理实测 source fps 与 composition fps。按 `existing-footage.md` 使用素材分析；来源标明 AI 生成及对应任务记录。字幕、图表与标志保留为可编辑覆盖层。
6. 有独立 VoxCPM2 旁白时保持已选 voiceId，并明确 H3 音轨保留、静音或降低音量的选择，避免两路对白重叠。用户要求完全静音时合成阶段移除声音；用户要求真实原声/精确音轨时直接保留源音频，不依赖生成模型复制。

生成成功只完成素材阶段。后续仍要完成代表场景检查、整片渲染、视听复核和不可变版本登记；不能把服务 URL 当作映芽已交付版本。续写可以下载 last frame 再作为下一段 first frame，逐段检查接缝与身份漂移。
