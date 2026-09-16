# 官网首屏鼠标交互

`StudioIllustration.tsx` 管理指针、短暂停留、一次回应和停止条件；`studioMotion.ts`
用 Canvas 2D 和原图的局部遮罩合成机械臂，不依赖 WebGL。左侧机械臂与夹爪、手中的照片共用变换；右侧拆成上下两段，肩关节和底座固定，肘部联动，夹爪接触区域与剪辑屏幕
保持原图。没有持续循环，也不更改鼠标指针。点击左右机械臂可立即重新播放，不受悬停冷却限制；支持触屏和按钮的 Enter/空格键。连续点击从当前姿态平滑重启，不累积播放队列。

- 允许动态效果时根据实际鼠标事件启用，不以窗口宽度区分桌面与手机；桌面窄分栏仍可交互。
- 机械臂靠近停留使用 `--motion-quick` 的一半（80ms），回应持续 `--motion-standard` 的两倍（480ms）。
- 读取时长同时处理 `ms` 和 `s`：生产 CSS 压缩会将 `160ms` 改写为 `.16s`。
- 左臂和右侧上臂最多旋转约 4°；下方桌面照片保持静止，不再跟随鼠标位移。
- 动作结束停止请求动画帧；悬停触发在离开时归位，主动点击触发会播完本次动作。滚动、失焦、页面隐藏和演示弹窗会停止交互。
- 减少动态效果、背景图加载失败或 Canvas 2D 不可用时保留原始可访问图片。
- 触屏仅在主动点击后加载动画背景；仅浏览或滑动时保持静态。
- 背景资源加载前已点击的动作会在加载后响应。
- 背景资源加载前已停留在插画上的鼠标位置会被保留，加载完成后继续响应。
- 背景补全图在桌面预加载、触屏主动点击后加载，不替换原始首屏图片。

## 资源来源

- 原图：`web/public/marketing/static-studio.png`，1942 × 809。
- 局部补全背景：`web/public/marketing/studio-clean-plate.png`，1942 × 809。
- 工具：内置 imagegen，2026-09-16。遮罩外始终使用原图，补全结果仅在物件移开后露出。
- 如更换插画，必须重新标定遮罩和关节坐标，并检查运动最大幅度时的边缘。

生成提示词：

> Use case: precise-object-edit. Image 1 is the edit target, a 1942x809 wide original Yingya studio illustration. Create a precisely aligned clean background plate for animating its foreground objects. REMOVE BOTH complete articulated robot arms above their cylindrical bases, including their black grippers and gray comic movement marks; REMOVE the landscape photograph held by the left gripper; REMOVE the two loose overlapping photo cards lying on the desk in the bottom-left foreground; REMOVE the single loose sunflower photo card in the bottom-right foreground. Keep BOTH cylindrical white robot bases and their ghost logos exactly intact, keep the whole center video editing monitor and its keyboard/platform intact, keep the lower-left tray of four standing photos intact, keep right pencil cup intact. Reconstruct only the regions hidden by removed objects: white studio background, a little top-left edge and landscape panel of the center monitor where the held photo had overlapped, and white tabletop under the loose photos. Preserve camera, framing, original object coordinates, shadows on retained objects, colors, screen images, all existing words, dimensions and wide aspect ratio. Nothing moves position. NO new objects, no restyling, no transparency. The output will sit exactly behind the original cutouts, so pixel alignment of retained objects is paramount.

## 验证

`node tests/studio-interaction-ui-qa.mjs` 验证交互、静止、归位、弹窗暂停、动态效果偏好变化、
并在禁用 WebGL 的浏览器中断言左右机械臂实际运动，覆盖桌面窄窗口、连续点击、键盘触发、手机触屏点击、
背景延迟加载及 Canvas 静态回退。通过 `YINGYA_UI_QA_URL` 指定线上页面，
`YINGYA_STUDIO_QA_OUTPUT` 指定仓库外截图目录。一般首页行为继续由 `npm run test:marketing` 检查。
涉及时长的改动还需针对正式构建产物运行这组交互检查，不能只验证 Vite 开发服务器。
