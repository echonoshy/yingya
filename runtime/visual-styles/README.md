# 映芽视觉风格库 v1

六套中文视频设计包由映芽编写。借鉴 OpenDesign 的「设计说明 + tokens + 可运行示例」组织方式，
没有复制第三方品牌标识、字体文件、产品图片或整套设计源码。品牌名称仅说明设计灵感，非官方品牌规范。

参考来源：
- https://github.com/nexu-io/open-design/blob/main/docs/design-systems.md
- https://github.com/nexu-io/open-design/blob/main/design-systems/apple/DESIGN.md
- https://github.com/nexu-io/open-design/blob/main/design-systems/linear-app/DESIGN.md
- https://github.com/nexu-io/open-design/blob/main/design-systems/notion/DESIGN.md

`catalog.json` 是前端目录和后端选择的共同来源。每次变更风格、场景或动画时增加相应风格版本，
并运行 `node scripts/build-style-previews.mjs` 重建示例。预览和项目使用同一套 tokens、scene.html、
scenes.css 和 motion.js。预览是说明表达方式的原创样例，不是用户作品的效果保证。

新项目保存完整设计与场景包快照，不在发布后悄悄替换旧项目的风格。方案批准前只保存规范；
批准后安装可编辑样式与场景参考。用户明确修改优先于起始规范，制作助手须同步项目 DESIGN.md。
自动推荐仅按需求关键词选择起点，已有资料、品牌规范与后续用户决定优先。

此版本仅提供视频风格选择；没有独立网页生成入口。
