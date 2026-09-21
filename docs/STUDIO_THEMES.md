# 九套画风

映芽使用白色工作画布与九套原创插画。装饰在独立区域出现，不覆盖文字、控件或客户视频。

| 标识 | 名称 | 材质 |
| --- | --- | --- |
| paper | 纸上放映室 | 纸张叠层 |
| letterpress | 版画故事工坊 | 黑色刻印、少量朱红 |
| pencil | 铅笔动画工作室 | 石墨线条、少量鹅黄 |
| watercolor | 水彩自然手记 | 透明水彩、植物与山水 |
| felt | 毛毡定格片场 | 毛毡与柔软织物 |
| cel | 复古动画工作室 | 赛璐璐线条与淡蓝淡黄 |
| crayon | 蜡笔绘本 | 彩色蜡笔、纸张露白 |
| wood | 彩色木作 | 木纹与低彩度木制组件 |
| screenprint | 丝网印刷 | 红蓝套印与细颗粒 |

## 页面覆盖

每套在 `web/src/assets/themes/<标识>/` 下包含六张独立 WebP，共 54 张：

| 文件 | 使用页面 |
| --- | --- |
| home.webp | 创作首页、官网首页 |
| projects.webp | 我的作品页头与空状态 |
| assets.webp | 素材工坊页头与空状态 |
| access.webp | 登录、邀请注册、重置密码、管理后台登录 |
| account.webp | 用量统计、API 等价账单、用户/邀请/审计/分享管理 |
| workspace.webp | 制作工作区、创建等待、公开分享 |

表单、抽屉、任务菜单沿用统一中性色控件，不重复堆放装饰。制作中的画面、视频、音频和用户素材不套画风。
图片原稿、提示词与裁切记录保留于 `output/theme-art/`。构建使用哈希资源 URL，仅下载当前页面所需的主题图片。

## 随机与状态

`studioThemes.ts` 维护九套配置，`StudioThemeProvider` 包裹整个网站：

- 无有效记录的新会话均匀抽取九套之一。
- `sessionStorage[yingya-studio-theme-v1]` 保持当前选择，刷新、登录、页面跳转保持一致。
- 账户菜单及登录、官网页的「换个画风」均匀抽取另外八套之一，不重复当前风格。
- 存储被禁用或记录失效时自动降级到内存；不会阻断页面。
- 切换只替换插画与轻微表面样式，不重建表单、播放器、工作区和任务。
- 首页只有短暂入场与一次鼠标反馈；编辑输入时不触发鼠标反馈。
- 暂停设置保存于本机；`prefers-reduced-motion` 下禁用装饰运动。其他页面插画静止。

## 验证入口

- `npm run typecheck`、`npm run web:build`、`npm run test:web`。
- `npm run test:ui`：核心创作、素材、工作区、反馈和响应式回归。
- `npm run test:marketing`：官网布局、示例、对话框与移动端回归。
- `node tests/studio-themes.browser.mjs`：九套画风在全部页面的资源、主题一致性、390/320 像素视口、草稿与刷新持久性。
- `node tests/studio-browser.mjs`：鼠标反馈、暂停与减少动效、输入保护、任务等待和中间断点。
- `node tests/studio-theme-state.browser.mjs`：九个实际随机区间、各套创建等待与管理登录页、表单保留及禁用存储的回退。

浏览器测试通过 `YINGYA_UI_QA_URL` 指定本地或正式网站。主题测试使用隔离 API 数据，验证真实前端，不创建真实视频、账单或用户。正式发布仍须核对公网页面引用的 JS/CSS 及资源是否属于新版本。
