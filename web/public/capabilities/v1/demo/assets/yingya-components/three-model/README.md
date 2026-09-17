# 本地 3D 模型镜头

使用官方 Three.js 0.186.0 + GLTFLoader；浏览器 bundle 内含依赖，不使用 CDN、不需要 React Three Fiber 或第二套播放时钟。只在内容需要真实空间形体、产品旋转或模型自带动作时选用；文字、数字、连线继续复用现有二维组件。

## 接入

用影芽统一组件入口安装 `model-stage` 后，先加载 `assets/yingya-components/clock.js`，再加载此目录的 `model-scene.js`（`type="module"`）。通过 `YingyaComponents.createScene` 创建，容器必须已连接页面且为空。根 composition 必须声明有限的 `data-duration`。示例：

```js
// 放在 module script 中；先静态 import 以便工厂在 createScene 前注册。
import './assets/yingya-components/three-model/model-scene.js';
const model = YingyaComponents.createScene(document.querySelector('#model'), {
  component: 'model-stage',
  modelUrl: 'assets/models/product.glb',
  startSeconds: 2,
  durationSeconds: 6,
  width: 1280,
  height: 720,
  motion: 'turntable', // turntable | orbit | still
  turns: 0.5,
  yawDegrees: -25,
  elevationDegrees: 12,
  framing: 1.15,
  animationClip: null, // 模型动作的名字或索引；null 保持模型静态姿态
  animationLoop: true,
});
await model.ready;
```

`modelUrl` 相对于 composition HTML，不相对于此 JS 模块。HTML 布局负责容器的尺寸、背景、文字和镜头显隐；透明画布叠加于其上。`width` / `height` 是画布输出像素，固定像素比 1，不能随浏览器 DPR 改变。先以模型原始包围盒自动居中、等比缩放和构图；大幅移动的骨骼动作需要增大 `framing` 并检查所有关键帧。

工厂同步返回 `{ready, renderAt(globalSeconds), seek(globalSeconds), dispose(), startSeconds, durationSeconds}`，桥接负责统一注册、初始加载与 `hf-seek.waitUntil`。`ready` 等待模型、纹理及着色器准备，并应用加载期间最后一次 seek。动画仅由绝对视频时间决定；没有 RAF、增量物理模拟、OrbitControls 或无限循环。动作结束后回跳也会重置暂停状态。`dispose` 取消主文件加载并释放几何体、材质、纹理、ImageBitmap、混合器和 WebGL 上下文。

直接导入 `createModelScene` 可用于测试或自定义桥接；直接调用者必须自行等待 `ready`、驱动时间和释放实例。不要同时使用两套驱动。`animations` getter 可列出模型内置动作，`scene/camera/renderer` 可供已验证的高级定制，但改变其状态后须再次检查时间轴可重复性。

## 素材边界

- 支持 glTF 2.0 `.glb`、`.gltf`，PBR 材质、GLTFLoader 原生支持的普通纹理与动作。推荐包含所有纹理的单文件 GLB，减少路径丢失。
- glTF 外置 `.bin` 与纹理须一起放入模型目录，保留相对关系；不允许 `..`、绝对路径、远程模型/纹理或 CDN。允许标准 base64 内嵌 buffer/image；GLB 内嵌图片使用 loader 创建的本地 blob。
- 初版不装 Draco、Meshopt、KTX2 解码器。含对应扩展的模型明确报错，先从建模软件导出未压缩 GLB 与普通 PNG/JPEG/WebP 纹理。没有静默替换、下载解码器或降低成空白画面。
- 主模型默认限制 64 MiB（配置上限 256 MiB）；这不是总 GPU 内存限制，外置纹理和解码后的网格可更大。控制纹理尺寸、面数、骨骼数量，先验证 3D 加载和关键帧，再批量渲染。
- 场景使用固定灯光和模型原始材质，没有外部 HDRI、模型库账户、付费素材或自动下载。透明、玻璃和特定模型材质需要逐项视觉验收。需要 WebGL 2。
- Three.js MIT 许可只覆盖引擎，不覆盖用户/第三方模型。每个真实模型记录来源、作者、许可证、署名要求、可商用及可随工程分发的权限；把许可文本与素材一起交付。

`sample-model.glb` 是由 `build.mjs` 自制的几何测试对象（MIT，见 `LICENSE.sample-model.txt`），带 `detail-slide` 动作，可验证加载、旋转、相机绕行、回跳和本地离线打包，不代表用户真实产品模型。

## 维护与验证

仓库维护者运行 `node runtime/components/three-model/build.mjs` 从锁定 npm 依赖重建本地 bundle 与 fixture。`PROVENANCE.json` 保存版本、官方来源和文件 hash；`LICENSE.three.txt` 必须随 bundle 保留。验证包括本地 GLB 和 glTF+bin、纹理失败、错误压缩格式、加载期间 seek、前后任意跳转、动画末帧回跳、画布像素和 dispose。Three.js 场景不可只通过静态编译验收。
