# 首页标题字体

当前标题使用霞鹜文楷 v1.522 Medium 的字形子集，导出名称为 Yingya WenKai。
沿用确认样张的 Medium 字形，不做人工加粗；仅包含“你的想法，映芽来制作。”，
以 WOFF2 格式随站点部署，无外部运行时请求。正文、按钮继续使用界面字体。

- 原始项目：https://github.com/lxgw/LxgwWenKai
- 原始版本：https://github.com/lxgw/LxgwWenKai/releases/tag/v1.522
- 原始文件：LXGWWenKai-Medium.ttf。
- 部署文件：yingya-wenkai-hero-v1.522.woff2。
- 字体许可：LXGWWenKai-OFL.txt（SIL OFL 1.1）。
- 修改：fontTools 裁切标题字符并转换为 WOFF2；名称表的字体家族、完整名称、PostScript 名称和唯一标识改为 Yingya WenKai，保留原始版权与许可信息；未改变字形。
- 修改标题时需更新子集；缺失字形会回退到正文中文字体。

## 资源清理

2026-09-17 删除了当前页面和构建流程均不再引用的寒蝉半圆体子集及其许可副本。
历史发布快照保持不变；当前部署仅保留实际使用的霞鹜文楷子集及许可。

## Current playful title subset

`yingya-playful-hero-v2.woff2` replaces the generic sans-serif landing heading with the hand-drawn character of LXGW WenKai Medium v1.522. It includes every character of “对话式视频制作”. Source: https://github.com/lxgw/LxgwWenKai/releases/tag/v1.522 (LXGWWenKai-Medium.ttf). Family renamed to Yingya Playful Hero using fontTools; SIL OFL license remains in this directory. No synthetic bold. Loaded locally, only for the hero title, with sans-serif fallback and swap behavior.

## Enlarged comic heading

Current hero uses `yingya-comic-title-v1.woff2`, a seven-character subset of ChillRoundM v1.805, renamed Yingya Comic Title. Original copyright and SIL OFL license: `ChillRound-LICENSE.txt`. FontTools subset retains original glyphs. Display size 48–76px desktop, 36–56px mobile, with static character rotations and baseline offsets. Prior title font assets remain archived.
