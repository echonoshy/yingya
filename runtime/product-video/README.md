# 产品视频样片与制作起点

三个样片均使用映芽真实 React 界面的浏览器截图，文字和动画为本仓库制作。
`create/intro/launch.png` 来自已登录开发页面；`plan/choose/edit.png` 来自同一
产品组件加载受控演示项目资料的页面。后者用于展示操作位置，不代表模型已完成
该演示项目，也不作为模型生成质量的证据。样片没有旁白、配乐或第三方产品资产。

- `product-intro`：30 秒，产品价值、资料输入、制作方案、入口。
- `feature-launch`：25 秒，镜头选择与局部修改。
- `walkthrough`：35 秒，添加资料、确认方案、预览修改、导出。

首页展示的 MP4 和封面位于 `web/public/product-examples/`。Agent 读取本目录的
`DESIGN.md`、`examples/*.json` 和 `build.mjs`，按客户资料复用结构与动效。
不将映芽的文案、域名或界面自动插入客户影片。

## 重建样片

从仓库根目录运行，DIR 必须为新目录：

```bash
node runtime/product-video/build.mjs --project DIR --example product-intro
node node_modules/hyperframes/dist/cli.js check DIR --json
node node_modules/hyperframes/dist/cli.js render DIR --output OUTPUT.mp4 --quality high --fps 30 --workers 2
```

替换示例名即可制作另两条。源目录保留 `scenes.json`、`assets.json`、素材、
`DESIGN.md` 和 HTML，可独立继续制作。修改镜头文件后，不带 `--example` 重建：

```bash
node runtime/product-video/build.mjs --project DIR
```

构建器校验源文件指纹，拒绝覆盖人工改过的 HTML。该规则保护已有自定义作品。
画幅优先读取 `.yingya/manifest.json` 的 `outputSpec.aspectRatio`，独立项目可
用 `--aspect-ratio 16:9|9:16|1:1`。修改配音须先生成并登记真实音频及实测时长。
自定义品牌或复杂镜头应继续编辑源文件；该构建器是可选起点。

## 检查标准

检查必须包含实际 MP4 的镜头与边界、中文排版、截图可读性及输出时长。
结构检查通过不能代替成片审阅。局部修改还需比较未修改镜头、原素材和声音；
使用新的媒体 ID 和路径，保留旧版本的文件。
