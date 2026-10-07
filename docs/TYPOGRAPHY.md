# 界面字体维护

固定文案使用小型字体子集，用户输入、项目标题和工作控件使用完整的 Noto Sans SC 字族。

| 角色 | 字体与使用位置 |
| --- | --- |
| 正文与强调主字 | Noto Sans SC Variable；官网“让想法”、工作内容标题、正文与操作。 |
| 活泼展示字 | 站酷快乐体子集，CSS 名称 `Yingya Display`；“有画面”、创作／项目／素材／登录固定标题、产品方向入口。 |
| 手写短句 | 霞鹜文楷 Regular 子集，CSS 名称 `Yingya Note`；“今天”“一步步”“无限种讲法”、故事方向和“讲法”键帽。 |
| 衬线强调 | Noto Serif SC 900 子集，CSS 名称 `Yingya Serif`；仅用于覆盖表内的固定字形。 |
| 数字与快捷键 | 已有依赖 Fragment Mono 的 Latin 400；序号、Enter、时间和等宽字符。 |

## 资源与维护

`web/src/assets/typography/` 保存 `display.woff2`、`note.woff2` 和 `serif.woff2`。`coverage.json` 记录每份子集的字形、大小与哈希；`web/src/typography.css` 定义字体及 `font-display: swap`。子集不能用于任意用户文字。

- [站酷快乐体源文件](https://github.com/google/fonts/tree/main/ofl/zcoolkuaile)：来源于 Google Fonts；本次原始 TTF 的 SHA-256 为 `812a6fc1fe54b6d73a419245c32dfeba8aa33104d5be90d1cf6af082007cb71d`。
- [霞鹜文楷](https://github.com/lxgw/LxgwWenKai)：使用项目现有 `@chinese-fonts/lxgwwenkai@3.0.0` 中的 Regular 1.520 分片，提取所需字形并合并。子集改用映芽内部家族名，保留原版权信息。
- Fragment Mono 使用项目现有 `@fontsource/fragment-mono@5.3.0`。字体许可保留在 `web/public/fonts/`。

增改使用展示／手写字体的固定文案时，更新 `coverage.json` 中相应字符并重新生成，不要直接将子集用于任意用户文字。生成脚本为 `design-assets/typography/build_subsets.py`，需要 fonttools 与 brotli：

```bash
uv run --with fonttools --with brotli python design-assets/typography/build_subsets.py --display-source /path/to/ZCOOLKuaiLe-Regular.ttf
```
