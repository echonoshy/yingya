<h1 align="center">YingYa · 映芽</h1>
<p align="center"><strong>Turn ideas into videos.</strong></p>
<p align="center">Turn ideas, source material, and existing media into videos that explain and are ready to share.</p>

<p align="center">
  <a href="https://yingya.art/app#/">Start creating</a> ·
  <a href="https://yingya.art/#style-references">Explore examples</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="README.md">简体中文</a>
</p>

[![YingYa promotional film: points, lines, shapes, volume, light, and sound in motion](docs/assets/yingya-demo.gif)](https://yingya.art/#yingya-film)

<p align="center">15-second promotional film · Click the GIF to watch with sound on the website.</p>

## What is YingYa?

YingYa is an AI video workspace built around conversation, for educators, knowledge creators, and people explaining products, business processes, or data.

Start with an idea, text, a web link, a reference video, or your own media. YingYa organizes the story and shows you an outline with actual keyframes. Once you approve the direction, it produces the animation, audio, and video. Review the result and keep refining the same project through conversation.

## What you can make

- **Clear explanations**: use animated text, graphics, processes, and charts to explain concepts and data, with your uploaded images, video, and audio.
- **A plan you can see**: review keyframes rendered from the actual production source before committing to the full video.
- **Audio and motion shaped around the content**: add narration, captions, and animation according to your brief.
- **Changes tied to specific moments**: give feedback through screenshots, timestamps, or time ranges, preserving unaffected content and earlier versions.
- **Videos you can share and revisit**: download an MP4 or share an independent copy of a selected version, then return to the project for further edits.

## From an idea to a video

1. **Describe the goal**: explain the audience and key message, and add media or style references.
2. **Review the plan**: check the outline and keyframes, suggest changes, and approve production.
3. **Watch and refine**: review the video and describe what you want to change.
4. **Share the result**: download or share the version you are happy with.

For example, start with:

> Make a roughly 60-second video for students learning about pendulums. Compare a long and a short pendulum side by side, explain how length affects the period with Chinese narration, and finish with a one-sentence takeaway.

Then refine the result:

> Make the title in the second scene bigger and hold the comparison for two more seconds. Keep everything else unchanged.

## Inside the project

The browser workspace uses React, the backend uses Rust, and the AI Agent interprets the brief and writes and revises the video project. Remotion handles preview and rendering. Each video project keeps its own media, production source, and versions for continued editing and delivery.

See the [product scope](docs/PRODUCT_POSITIONING.md), [production workflow](docs/VIDEO_PRODUCTION_WORKFLOW.md), and [documentation](docs/README.md) for details. Most product documentation is in Chinese. Questions and suggestions are welcome in [GitHub Issues](https://github.com/echonoshy/yingya/issues).
