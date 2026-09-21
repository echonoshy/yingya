# 映芽预设头像

2026-09-21 使用内置 imagegen 分别生成小猫、兔子、狐狸、熊猫；原图保留在 Codex generated_images 中。此目录为 384px WebP 产品资源，无第三方角色、文字或商标。

共同提示：ONE square profile avatar for Yingya; centered cute handmade plush animal portrait; soft dark eyes, gentle smile, felt texture, pale cream background, diffuse lighting, safe circular-crop margins; no text, border or watermark.

主体分别为 creamy apricot kitten / ivory bunny with short rounded ears / terracotta fox with cream cheeks / baby panda. 四款使用独立生成调用，后处理仅压缩与缩放。文件名带版本号，更新时新增版本，不覆盖已发布文件。

完整共同提示词（内置 imagegen，四次 generate；将 `[SUBJECT]` 分别替换为下列主体）：

```text
Create ONE square profile avatar asset for Yingya, a friendly Chinese creative app.
Subject: [SUBJECT].
Beautiful cute handmade plush toy portrait, front-facing centered head and tiny upper shoulders,
big soft dark eyes and a tiny gentle smile, velvety felt texture, subtle studio shadows,
restrained premium 3D illustration. Pale warm cream background, soft diffuse lighting,
calm pastel palette. Face fills central 65 percent, generous safe margins for circular cropping.
No lettering, no accessories, no border, no watermark. Output a standalone square image,
only this one animal. Consistent profile-avatar collection art direction.
```

| 文件 | 主体 |
| --- | --- |
| cat-v1.webp | a creamy apricot kitten, tiny rounded ears |
| bunny-v1.webp | an ivory bunny with short rounded upright ears |
| fox-v1.webp | a warm terracotta little fox, creamy cheeks |
| panda-v1.webp | a baby panda with soft black rounded ears |
