# 界面字体维护

字体分工属于已定格的[产品 UI 基准](UI_DESIGN_STYLE.md#品牌颜色与字体)。本文维护现有资源、字形与许可，不用于重新选字体或扩展视觉风格。固定文案使用小型字体子集，用户输入、项目标题和工作控件使用完整的 Noto Sans SC 字族。

字号、行高、字重和飞书 / Lark 参考的采用边界统一见[字号、行高与字重](UI_DESIGN_STYLE.md#字号行高与字重)及其后续章节，不在本文复制另一份字阶表。常规 UI 通过 Noto Sans SC Variable 的现有字重表达层级；展示字子集不依靠浏览器合成粗体。更改字体样式后，等待 `document.fonts.ready`，核对实际字体、计算样式、中英文混排和长标题换行。

| 角色 | 字体与使用位置 |
| --- | --- |
| 正文与强调主字 | Noto Sans SC Variable；官网“让想法”、工作内容标题、正文与操作。 |
| 活泼展示字 | 站酷快乐体子集，CSS 名称 `Yingya Display`；“有画面”、创作／项目／素材／登录固定标题、产品方向入口。 |
| 手写短句 | 霞鹜文楷 Regular 子集，CSS 名称 `Yingya Note`；“今天”“一步步”“无限种讲法”、故事方向和“讲法”键帽。 |
| 衬线强调 | Noto Serif SC 900 子集，CSS 名称 `Yingya Serif`；仅用于覆盖表内的固定字形。 |
| 数字与快捷键 | 已有依赖 Fragment Mono 的 Latin 400；序号、Enter、时间和等宽字符。 |

## 资源与维护

`web/src/assets/typography/` 保存 `display.woff2`、`note.woff2` 和 `serif.woff2`。`coverage.json` 记录每份子集的字形、大小与哈希；`web/src/typography.css` 定义字体及 `font-display: swap`。子集不能用于任意用户文字。

- [站酷快乐体源文件](https://github.com/google/fonts/tree/main/ofl/zcoolkuaile)：当前子集原始 TTF 的 SHA-256 为 `812a6fc1fe54b6d73a419245c32dfeba8aa33104d5be90d1cf6af082007cb71d`。
- [霞鹜文楷](https://github.com/lxgw/LxgwWenKai)：使用项目现有 `@chinese-fonts/lxgwwenkai` 的 Regular 分片，提取所需字形并合并。子集改用映芽内部家族名，保留原版权信息；依赖版本以包锁文件为准。
- Fragment Mono 使用现有 `@fontsource/fragment-mono` 包；Noto Sans SC 和 Serif SC 使用对应的 `@fontsource-variable` 包。字体许可保留在 `web/public/fonts/`，不能作为旧文档删除。

增改使用展示／手写字体的固定文案时，更新 `coverage.json` 中相应字符并重新生成，不要直接将子集用于任意用户文字。生成脚本为 `design-assets/typography/build_subsets.py`，需要 fonttools 与 brotli：

```bash
uv run --with fonttools --with brotli python design-assets/typography/build_subsets.py --display-source /path/to/ZCOOLKuaiLe-Regular.ttf
```

脚本读取现有 `coverage.json` 的字符并重建字体与摘要。重建后核对实际字形覆盖、大小、哈希和许可，再查看使用该固定文案的页面；无需重建的文字改动不必改写字体文件。生成客户视频的字体按该视频的设计与许可选择，不由本表统一。
