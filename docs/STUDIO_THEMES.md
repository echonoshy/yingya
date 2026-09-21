# 小鬼片场插画资源

当前采用用户选定的第三种黑白二维漫画风格，以原始映芽小鬼 Logo 延展角色，少量薄荷绿与鹅黄仅用于插画。完整规则见 `UI_DESIGN_STYLE.md`。

生产资源位于 `web/src/assets/comic/`，七张 WebP 合计约 375 KB。提示词、尺寸和生成记录见该目录 README；原稿与选定效果图保存在 `output/imagegen/comic/`。

| 文件 | 使用页面 |
| --- | --- |
| home.webp | 首页与官网三幕片场插画 |
| projects.webp | 我的作品页头与空状态 |
| assets.webp | 素材工坊与素材检查器空状态 |
| access.webp | 登录、注册、重置密码、后台登录 |
| account.webp | 用量、账单、账户管理 |
| workspace.webp | 制作工作区、创建等待、视频分享 |
| empty.webp | 搜索无结果、暂无任务、错误与恢复状态 |

旧九套插画仍留作资源归档，不再进入当前主题。原始 Logo、头像、客户视频和上传素材保持其自身内容。

`studioThemes.ts` 固定使用 comic；旧 sessionStorage 主题值自动迁移，不重建表单、草稿、播放器或任务。存储不可用仍显示 comic。首页只有短暂入场与鼠标反馈，遵守 `prefers-reduced-motion`；其余插画静止。

验证入口：`npm run typecheck`、`npm run test:web`、`npm run test:ui`、`node tests/studio-themes.browser.mjs`、`node tests/studio-theme-state.browser.mjs`、`npm run web:build`。浏览器检查使用隔离 API fixtures，覆盖桌面和 390/320px。
