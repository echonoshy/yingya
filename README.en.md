# YingYa · 映芽

[简体中文](README.md) | **English**

**Create and revise videos through conversation.**

YingYa is an AI video workspace. Start with text, a web page, a reference video, or your own media. Review the outline and keyframes before producing animation, narration, and captions. Refine the video through conversation, then download an MP4 or share a link.

[Start creating](https://yingya.art/app#/) · [Website](https://yingya.art/) · [Documentation](docs/README.md)

[![YingYa's 15-second promotional film](docs/assets/yingya-demo.gif)](https://yingya.art/#yingya-film)

*15-second promotional film. Click to watch with sound.*

## What you can make

- **Explainers and lessons.** Turn articles, scripts, and questions into videos using diagrams, formulas, steps, and comparisons.
- **Data and reports.** Animate your data to highlight trends, differences, and key changes in business reviews and research summaries.
- **Product introductions and walkthroughs.** Combine web pages, product images, and screen recordings to explain use cases, features, and steps.
- **Animated typography and visual shorts.** Use letterforms, geometry, particles, and transitions for motion posters, opening sequences, brand films, and short stories.
- **Existing media.** Select excerpts from uploaded videos, combine images and recordings, and add narration, captions, and supporting visuals.

## Videos from the homepage

Click a cover to watch its video, or choose a style from the [website gallery](https://yingya.art/#style-references) as a reference for your own content.

<table>
  <tr>
    <td width="50%">
      <a href="web/src/assets/showcase/demo-8-1080.mp4"><img src="web/src/assets/showcase/demo-8.webp" alt="From poetry to bits: text and a timeline organize an explanation" width="400" /></a><br />
      <strong>From poetry to bits · 24s</strong><br />
      Text, lines, and a chronological narrative.
    </td>
    <td width="50%">
      <a href="web/src/assets/showcase/demo-3-1080.mp4"><img src="web/src/assets/showcase/demo-3.webp" alt="Interface motion: depth and movement in interface elements" width="400" /></a><br />
      <strong>Interface motion · 30s</strong><br />
      Spatial depth, changing elements, and transitions.
    </td>
  </tr>
  <tr>
    <td width="50%">
      <a href="web/src/assets/showcase/demo-1-1080.mp4"><img src="web/src/assets/showcase/demo-1.webp" alt="Kinetic lyrics: large type and comments timed to music" width="400" /></a><br />
      <strong>Kinetic lyrics · 45s</strong><br />
      Type size and layout timed to a beat.
    </td>
    <td width="50%">
      <a href="web/src/assets/showcase/demo-9-1080.mp4"><img src="web/src/assets/showcase/demo-9.webp" alt="Cloud Express: a train crossing an illustrated landscape" width="400" /></a><br />
      <strong>Cloud Express · 18s</strong><br />
      Illustrated scenes, color, and camera movement.
    </td>
  </tr>
</table>

## Features

- **Media and references.** Use web pages, scripts, reference images and videos, or upload your own media. Reuse assets across projects through your account's media library.
- **Plan before production.** Review the outline and keyframes rendered from the actual production source. Adjust copy, sections, and visual direction before making the full video.
- **Narration and captions.** Generate voiceover from a script or transcribe a recording, then align captions, highlighted words, and visuals with the actual speech.
- **Targeted revisions.** Request changes through conversation, screenshots, timestamps, or time ranges. Keep earlier versions while refining the same project.
- **Export and share.** Download an MP4 or adjust resolution and frame rate for another export. Share an independent copy of a selected version, with no sign-in required to watch, optional expiry, and revocation.

## A typical workflow

Provide content and references → approve the outline and keyframes → watch the draft → request changes → download or share.

For example:

> Turn this product page and three screenshots into a 30-second introduction covering the use case and two key features. Use landscape format, English narration, and captions. Show me the outline and keyframes first.

## Project and documentation

The frontend uses React and the backend uses Rust. The AI Agent writes and revises video projects; Remotion handles preview and rendering.

[Product scope](docs/PRODUCT_POSITIONING.md) · [Production workflow](docs/VIDEO_PRODUCTION_WORKFLOW.md) · [Video sharing](docs/VIDEO_SHARING.md) · [Development and deployment docs](docs/README.md) · [Issues and suggestions](https://github.com/echonoshy/yingya/issues)

*Most project documentation is currently in Chinese.*
