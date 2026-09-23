# 水墨 AI 片场素材

用户选稿：`/home/lake/.codex/attachments/7710c5e3-477d-44fa-8af0-1feb4f305a2e/codex-clipboard-3ea6fcda-35fc-43e1-b9ba-d36f8ae7bcc1.png`。

以下素材由内置 image_gen 独立生成，并逐一检查：

- `ink-ai-landscape.webp`：1536×1024，暖白水墨山水，无文字、UI、角色。
- `ink-ai-director.webp`：600×623，打板小怪兽，真实透明 alpha。
- `ink-ai-hanging.webp`：400×500，倒挂小怪兽，真实透明 alpha。
- `ink-ai-film.webp`：900×480，拖胶片小怪兽，真实透明 alpha。

原 PNG 与完整提示词位于 `output/imagegen/ink-ai/`：`landscape-prompt.txt`、`ink-ai-director.txt`、`ink-ai-hanging.txt`、`ink-ai-film.txt`。仅进行等比缩放与 WebP 编码，保留原透明通道。

`ink-ai-preview.mp4`：从上述背景制作的 12 秒无声山水运镜示例，1440×480、30fps。不是客户视频或实时 AI 生成结果；仅在用户操作时加载，不自动播放。

FFmpeg 制作参数：crop=960:320:288:540；scale=2880:960；zoompan 从1到1.025，360帧；输出1440×480、30fps、H.264/yuv420p、CRF22、faststart。首次播放的宽幅构图与示意取景框相近，手机等比显示完整视频。

## 2026-09-23 小怪兽参与拍片

按用户选择，将原轻微推镜改为12秒小怪兽片场：0.5–3.9秒打板小鬼从下沿探头、轻摇后退场；3.3–10.5秒绿怪兽拖胶片经过，中途踉跄一下；6.8–11.4秒倒挂小鬼从上沿探入、轻晃后缩回。首尾恢复山水，声音仍关闭。

使用现有透明角色直接合成入真实视频；播放、暂停、定位与全屏天然保持同步，无独立循环或新的运行时动画。新素材没有调用模型生成。导演与胶片的幅度由FFmpeg缓动/短暂旋转控制。

制作基片与完整滤镜保留于 `output/imagegen/ink-ai/crew-animation/`。输入顺序为基片、director、film、hanging；三张角色以30fps循环输入，filter_complex_script使用crew.ffgraph，输出12秒、30fps、H.264 CRF20、yuv420p、faststart。为0/4/8秒各提取一张288×96的真实WebP缩略图，供原定位按钮使用。

## 2026-09-23 全新框内角色（替代上版复用角色）

用户纠正：框内不能重复使用框外三只角色，需要新的形象和动作。通过内置 image_gen 分别生成以下三个全新透明角色，保留原生 alpha，裁去透明空边并等比缩为800px宽WebP：

- `ink-cast-camera.webp`：赭黄方头独眼摄影怪和带轮摄影机；滑入、急刹前倾、回弹，随后加速驶出。
- `ink-cast-boom.webp`：朱砂三眼长腿收音怪；举起毛绒话筒跳入、连续蹦跳保持平衡，失衡落出下沿。
- `ink-cast-pilot.webp`：雾蓝云朵飞行怪戴护目镜骑纸飞机；沿弧线从右向左掠过，随飞行倾斜。

原PNG、每个角色的完整提示词与新动作滤镜保存在 `output/imagegen/ink-ai/new-cast/`。不使用框外的director/film/hanging图像；原山水基片来自 `crew-animation/landscape-base.mp4`。滤镜输入顺序：基片、camera、boom、pilot。输出仍为12秒、1440×480、30fps、H.264 CRF20、faststart、无音轨；现有播放状态控制所有角色。0/4/8秒缩略图重新从新片段提取。
