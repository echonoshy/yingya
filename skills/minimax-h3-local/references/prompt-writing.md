# H3 镜头提示词

2026-09-30 核对的 MiniMax 官方来源：
- [基础模式指南](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md)
- [全参考指南](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md)
- [模型与开放模块说明](https://github.com/MiniMax-AI/MiniMax-H3)

以下是映芽的写作适配与原创示例。按素材和镜头复杂度填写，不把短请求机械扩展成无关剧情。它不是官方 Context-IR 调用。

## 先分开底图与运动

Image Gen 提示词只设计一张可检验的起始画面：画幅、景别、主体外观与初始姿势、前后景关系、材质、光源、配色、动作所需空间。指定用户真正要求的保留项。不要让静态图同时表达一串动作，不在底图烘焙讲解字幕、数据或需要编辑的标注。

实际查看底图后再写 H3 提示词。把出现的人物、道具、位置、接触关系作为约束；让主体从已有姿势开始行动。改变设计时先修底图，不写与图片矛盾的描述。用户已有合适底图时复用，不强制再生图。

## 文生 / 首帧 / 首尾帧

基础模式使用 `integrated_multimodal_description`、`overall_soundscape`、`non_diegetic_music` 三部分。将镜头正文组织为英文，用户对白和画内文字保留原文。图生在正文前声明图片与首/尾时刻的对应；纯文生没有图片对齐行。

镜头正文按播放顺序描述可见变化，包括起始构图、动作起因、接触与运动过程、反应和结束姿态。运镜说清方向、幅度、速度与跟随目标；区分相机平移与原地摇镜、推进与变焦。短镜头通常一个主要动作即可。采用 `[Shot 1]`，真正切镜才新增 `[Shot 2] At 00:03.500, ...`，切点必须递增且落在时长内。

图生从底图出发；首尾帧强调可实现的中间路径；仅尾帧则设计合理的起始状态，最终收敛到该图。普通参考图片不等于固定首帧。

环境声写在 `overall_soundscape`，观众听到的配乐写在 `non_diegetic_music`；对白属于具体镜头，使用稳定说话者编号及 `<d>[Chinese] 用户原文</d>`。无配乐时填 `N/A`，不要替用户增加对白。映芽已有独立旁白时不让 H3 重复生成旁白，片段环境声与旁白在合成中单独控制。

原创例：6 秒，已查看一张蓝围裙陶艺师双手扶着湿泥碗的首帧。

```text
The supplied first frame anchors the opening at 0.00 seconds. Keep its potter, apron, wheel, bowl shape, daylight and spatial arrangement throughout this six-second shot.

integrated_multimodal_description: [Shot 1] A realistic close view begins on the wet clay bowl and the potter's hands exactly as shown in the first frame. Soft window light falls from camera left. The wheel turns steadily clockwise. During the first two seconds the thumbs rest inside the rim while the fingertips support its outside; the bowl remains centered on the wheel. Over the next three seconds the hands rise a little together, easing the damp rim upward without pulling it sideways. A thin line of water glints on the rotating surface and slips down the outer wall. The camera moves forward slowly over a short distance, keeping both hands and the complete rim in view. In the final second the fingers release their pressure and hover just above the unchanged circular opening while the wheel continues to turn. There is no cut and nobody speaks.

overall_soundscape: A low wheel-motor hum continues beneath soft wet rubbing sounds. A small droplet taps the splash pan as the fingers lift.

non_diegetic_music: N/A
```

## 全参考：素材角色先于描述

分为 `subject_definitions`、`summary`、`retention_analysis`、`detailed_description`、`overall_soundscape`、`non_diegetic_music` 六部分。逐项定义人物、产品、场景、运镜或音色的来源、保留项、允许变化与生效镜头，再按播放顺序写成具体画面。

注意接入差异：官方改写指南称图片为 `<Picture N>`；此本机服务的上传标签使用 `<Image N>`。正文以服务素材编号为准，可定义 `<Subject 1>` 来指代 `<Image 1>` 中的人物，不创建并未上传的图片编号。有声参考视频占用音频编号；提交前检查音轨并登记实际对应表。

不要让“参考产品外观”误变成“复制产品图片背景”；不要让“参考运镜”误变成“复制视频人物”。官方区分完全保留、部分保留、属性迁移与弱参考，也区分音频直接复用和音色参考。本机生成不能保证音频逐样本复刻；需要原声完全保留时，直接在 Remotion 使用原音轨。

## 提交前检查

对照底图与用户要求检查：编号、动作可行性、镜头时长、对白容量、声音用途、保留项与变化是否互相冲突。用具体空间与动作代替“高级、电影感、动起来”等空泛修饰；不要为了长度添加新角色、镜头或音乐。精确字幕、标志与数值放在 Remotion 可编辑层。把最终提示词、参数和素材路径保存到项目 `.yingya/h3/`，生成后检查真实视频再决定是否修订。
