# 小鬼片场插画

2026-09-21，按用户选择的第三张「平面漫画小鬼」效果图制作。内置 Image Gen 生成，
以原始 `web/public/brand/yingya-ghost.png` 和选中效果图作为图片参考。
所有图片使用相同的黑灰轮廓、白底、薄荷绿动作线与少量浅黄色；人物的幽默来自眼神和姿势。
不替换用户头像、视频封面或项目素材。

## 资产与生成提示

公共提示：平面 2D 编辑插画；原始小鬼的圆头、双眼、卷尾轮廓；白色不透明背景；
清晰黑灰线条；有限薄荷绿与浅黄；无文字、无 UI、无 3D 黏土、无恐怖元素；主体紧凑，不裁切。

| 文件 | 场景提示 | 使用位置 | 原始像素 |
| --- | --- | --- | --- |
| home.webp | 三幕横幅：举巨型场记板、推播放三角和倒挂缠胶片、藏在播放画框后 | 创作首页、介绍首页 | 2172 × 724 |
| projects.webp | 抬脚努力搬起超大场记板，姿势略显吃力，薄荷绿动作线 | 作品标题、作品空状态 | 1536 × 1024 |
| assets.webp | 小鬼翻素材箱，画框与音频卡片散落，眼神若无其事 | 素材标题、素材空状态及检查器 | 1536 × 1024 |
| access.webp | 藏在白色门后举巨大钥匙，卷尾露出，偷偷侧看 | 登录、注册、重置密码、后台登录 | 1536 × 1024 |
| account.webp | 躲在长折叠账单后，尾巴托着饼图 | 用量、账单、管理后台 | 1536 × 1024 |
| workspace.webp | 推巨大播放三角，小伙伴缠在胶片里倒挂 | 创建等待、工作台、分享页 | 1536 × 1024 |
| empty.webp | 拿着放大镜寻找空电影文件夹里的内容，眼神困惑 | 搜索、无任务、无文件、失效分享和服务不可用 | 1536 × 1024 |

原始 PNG 与选中效果图保留在工作区 `output/imagegen/comic/`。
发布素材只作 WebP 编码（质量 92），没有以代码重新绘制或改变图片内容。
Vite 导入产生哈希 URL；页面只请求实际渲染的插画，不预加载整个素材库。

## Account avatar (2026-09-21)

`avatar.webp` is a 256 × 256 account preset, generated with the built-in imagegen tool and encoded as WebP quality 92. Source: `output/imagegen/comic/avatar.png`. It replaces the visual for the existing `cat` preset ID, retaining account persistence and custom uploads. UI label: 捣蛋小鬼. Imported into the hashed build bundle (Vite inlines this small image) to avoid stale public-file caches.

Prompt: Create ONE square Yingya account avatar matching the supplied home comic illustration. A single large near-black rounded ghost with two white oval eyes, one subtly squinting, a playful tilted pose and a tiny raised arm. Flat clean 2D graphic; plain light cool gray background; central circular safe area, recognizable at 40px. No text, objects, extra characters, 3D or fur. Reference: `output/imagegen/comic/home.png`.

## Marketing landing hero (2026-09-21)

`marketing.webp`: 2172 × 724, real alpha transparency, dedicated to the public landing page. Built-in imagegen edited the user-provided 3D mockup into a standalone illustration. Original PNG: `output/imagegen/comic/marketing-transparent.png`. WebP conversion uses quality 92 and preserves alpha. Browser canvas verification found 907676 fully transparent pixels and 661588 partially transparent pixels; no opaque rectangular backdrop.

Prompt: Extract only the wide 3D clay ghost illustration from the supplied screenshot. Preserve the three black clay ghosts, ivory play button, clapperboard, gray filmstrip, pale yellow film frame and mint canister in their arrangement. Remove all UI, text and white background. Wide 3:1 composition, safe margins, transparent PNG; retain semitransparent contact shadows, never a white floor or simulated checkerboard.

## Click-triggered character pose sheets

`ghost-play.webp`, `ghost-film.webp`, `ghost-tumble.webp`: independent 3-column × 2-row, six-pose transparent raster sheets, generated with built-in imagegen from `marketing-transparent.png`. Original sheets retained in `output/imagegen/comic/ghost-*.png`; WebP quality 92 preserves alpha. A fixed square viewport shows one cell at a time. Animation advances discrete poses; the page and character containers do not slide.

Shared prompt: Create exactly six equally sized square panels in a strict 3×2 grid, transparent alpha, no borders/text, consistent matte black clay character, lighting, scale and central anchor, safe transparent margins. Frame 1 and 6 resting pose. Distinct purposeful hand/eye/prop changes rather than translation of the character.

- play: left ghost peeks, blinks/winks, hugs the ivory triangular play key, returns to rest.
- film: middle ghost pulls film taut, curls it into a loop, reacts, then relaxes.
- tumble: upside-down tangled ghost wriggles, rolls upright and falls back into its tangled rest pose.

Click durations: 660/600/720ms, one iteration, repeat activation cancels/restarts only that character. Reduced motion suppresses pose animation. No hover labels, image navigation, sound or ambient loops.

## Connected-scene animation replacement

The independent ghost sheets above are archived. Active resources are `scene-play.webp`, `scene-film.webp`, `scene-tumble.webp`, each 1774×887, six full-scene panels in 2 columns × 3 rows. Every panel retains all three ghosts, continuous film, clapper, yellow frame and mint canister. Shared idle remains `marketing.webp`. Built-in imagegen edited that original scene; PNG originals live in `output/imagegen/comic/scene-*.png`, WebP quality 92 retains alpha.

Prompt common: Six full-scene 3:1 panels, 2×3 sheet, transparent background, fixed composition and scale, all three ghosts and props present, film continuously connects middle and right ghosts. Frame 1 resting reference, then small anticipation, quarter/half/almost/full gesture; render incremental outward poses for forward/reverse playback. Preserve identities, no camera movement, no isolated portraits or labels.

Actions: left peeks and winks behind stationary play button; middle pulls film gently taut and tilts head in puzzlement, keeping film linked; right attempts a small roll (up to 25°) while wrapped in film, no full flip or relocation. Playback uses 12 timed samples through six outward poses and reverse, with a peak hold, at 1800/1900/2000ms. Running clip is not interrupted by clicks. All clips end on the same original idle image. Brief opacity blend handles entry/exit; no whole-stage movement.

## GSAP original-texture interaction (archived)

The previous landing hero used only `marketing.webp` (2172×724, transparent). GSAP drives continuous local WebGL texture deformation for peeking/blinking, pulling film and wriggling. Previous `scene-*.webp` and `ghost-*.webp` sheets are archived and excluded from the artwork URL glob. No new bitmap or AI frame sequence is used. Rendering is capped at the original texture size and DPR 2; this preserves source detail but cannot create additional 3D geometry.
## Rigid-layer film tug (2026-09-21)

Built-in imagegen produced the following independent PNGs, saved in `output/imagegen/comic/`. Production `tug-*.webp` copies use Sharp WebP quality 92 / alpha quality 100 without visual editing or resizing (combined 425,440 bytes). Characters: 1254×1254; props/ribbon: 2172×724. The original combined `marketing.webp` is the static loading/error fallback. No body/face deformation or pose-sheet swapping remains.

GSAP drives rigid translate/rotate transforms on whole characters and a separate curved ribbon rendered from the real raster texture in Canvas 2D. The ribbon endpoints follow the rotated hand anchors; the shader from `heroWarp.ts` was removed. Pointer/touch input uses native pointer capture, vertical scrolling remains available, and keyboard arrows provide an equivalent tug. Static props remain behind the action. See `docs/UI_DESIGN_STYLE.md` for the interaction contract.

### Generation prompt set

- **tug-play.webp** — Single original black clay ghost hugging ivory triangular play button. Two white oval eyes, no pupils or mouth, full silhouette, three-quarter facing right; no other props, text, action marks, floor or baked shadow; genuine alpha. Identity/material reference marketing.webp. Native 1254×1254.
- **tug-director.webp** — Single original center charcoal matte clay ghost facing slightly right; white oval eyes, no pupils or mouth, scalloped feet and short left tail. Empty rounded hands at belly height, right hand protruding right ready to grip app-rendered film. No film, props, marks, floor or shadow. Genuine alpha. Reference marketing.webp. Native 1254×1254.
- **tug-tumble.webp** — Single original upside-down charcoal clay ghost with white oval eyes low on body; feet at top. Short silver/charcoal film wraps twice around belly, terminating at left hand with no loose long ends. Complete silhouette, two rounded hands; no props, marks, shadow or ground. Genuine alpha. Reference marketing.webp. Native 1254×1254. Exact tool prompt also archived in output/imagegen/comic/tug-tumble.prompt.txt.
- **tug-ribbon.webp** — Use case: stylized-concept. Asset type: one repeatable movie-film ribbon texture for an interactive website. Generate a SINGLE completely straight horizontal strip of 35mm silver-gray film, twelve clear warm ivory rectangular frames bordered charcoal gray, small regularly spaced square sprocket holes along top and bottom edges, soft clay 3D material with very subtle bevel matching a miniature stop motion film set. Orthographic front view: absolutely no perspective, curves, folds, shadows, text or props. Strip runs exactly from left edge to right edge, thickness about one quarter of total canvas height, centered vertically. Landscape 3:1 canvas. Genuine transparent alpha background including sprocket holes. The strip must be straight and consistent width so the frontend can map this real raster texture onto an interactive curved ribbon. Neutral gray and ivory palette. No characters, no letters, no checkerboard.
- **tug-props.webp** — Edit target: reference original Yingya transparent clay film set. Produce a transparent background PROPS ONLY layer preserving the same wide 3:1 canvas and the original placement and size of the clapperboard at lower left, pale yellow rectangular film frame at right rear, and mint green canister at far right. Remove ALL THREE black ghost characters, ALL connecting and wrapped gray film ribbons, white play triangle, cartoon action marks and all of their shadows. Reconstruct any hidden parts of the three retained props naturally. There must be exactly three props total, NO characters, no play triangle, no film ribbons, no ground plane, no text, no UI, genuinely transparent alpha. Preserve neutral soft clay material, the same studio lighting, original size and positions. Entire center region empty transparent. Keep full props uncut inside canvas. This layer will sit behind separately animated characters.


## Left ghost: startled toss and catch (2026-09-21)

`toss-body.webp`, `toss-key.webp`, `toss-arm.webp` are aligned 1254×1254 transparent layers edited with imagegen from `tug-play.webp`. Original outputs are archived in `output/imagegen/comic/toss-{body,key,arm}.png`; WebP conversion uses quality 92 and alpha quality 100. Canvas placement is retained. Body and foreground arm rotate rigidly; the ivory prop travels independently, slows at the apex, falls and settles with the hand. One 1.22-second GSAP timeline; repeat taps do not restart it. It is independent from the film timeline and pointer following. No visible instruction caption.

Prompts:
### body

Edit target is the supplied square 1254x1254 transparent Yingya character artwork. This is an aligned animation layer, NOT a new composition. Keep original canvas, scale, exact object placement, charcoal soft clay material and studio lighting. Genuine transparent alpha, no checkerboard, no text, no ground shadow. Do not recenter or enlarge the retained elements. Remove the entire ivory triangular play button AND the FRONT arm/hand that crosses over the triangle. Retain only the little black ghost body at original left position: same round head, two white eyes, leftward tail/scalloped base. Reconstruct the hidden right edge/body behind the removed triangle as a complete smooth rounded ghost silhouette, with a small far hand at lower right ready to support an object. The ghost remains entirely in the LEFT HALF of the canvas; right half transparent. No ivory objects anywhere. Keep the original front shoulder area smooth, because the front arm will be separately animated. The result is only one ghost body with eyes, no front arm crossing its belly.

### key

Edit target is the supplied square 1254x1254 transparent Yingya character artwork. This is an aligned animation layer, NOT a new composition. Keep original canvas, scale, exact object placement, charcoal soft clay material and studio lighting. Genuine transparent alpha, no checkerboard, no text, no ground shadow. Do not recenter or enlarge the retained elements. Remove the entire black ghost, its arms, its shadow and all black pixels belonging to it. Retain ONLY the thick ivory triangular play object pointing right, exactly in its current original position and at the same original size. Reconstruct the small left edge of the triangle formerly hidden by the hand. Keep its softly rounded triangular corners, bevel, warm ivory 3D clay shading. Left half remains largely empty. One complete ivory triangle only. No black fragments.

### arm

Edit target is the supplied square 1254x1254 transparent Yingya character artwork. This is an aligned animation layer, NOT a new composition. Keep original canvas, scale, exact object placement, charcoal soft clay material and studio lighting. Genuine transparent alpha, no checkerboard, no text, no ground shadow. Do not recenter or enlarge the retained elements. Retain ONLY the front charcoal curved arm with rounded mitten that crosses in front of the triangular button, exactly at the current original coordinates and size. Remove ALL other content: ghost body, eyes, base, far arm, ivory play triangle and shadows. The retained arm is the dark curved capsule spanning approximately x300..580 and y650..820 of the original canvas. Reconstruct its hidden shoulder end as a rounded stub. The result is just ONE small dark charcoal curved arm/mitten in the lower-left-center of an otherwise entirely transparent original-size canvas. Keep soft clay highlights, do not recenter. No face, no body, no other props.
