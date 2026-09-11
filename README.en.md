<p align="center"><strong>Yingya · 映芽</strong> is a workspace for making animated videos through conversation.</p>
<p align="center">Turn text, web pages, and media into videos. Refine them in chat, preview, and export to MP4.</p>

<p align="center">
  <a href="README.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  <img src="docs/images/yingya-workspace.jpg" alt="Yingya workspace with chat on the left and video preview and export settings on the right" width="100%" />
</p>
<p align="center"><sub>Chinese-language interface with sample project data and an original Yingya brand film</sub></p>

To make a video, visit [yingya.art](https://yingya.art/).
To see it in action, watch the [66-second product demo](https://youtu.be/DuEsvIO0zt4) or explore the [showcase](https://yingya.art/#showcase).
To run Yingya on your own server, follow the setup below.

---

## Quickstart

### Using Yingya

Open the [workspace](https://yingya.art/app), sign in, and bring your text, a web page, screenshots, or existing media. Yingya works well for product demos, animated explainers, data stories, and brand films.

Approve a production plan, then preview and refine the video. For example:

> Make the title in the second scene bigger and hold the shot for two more seconds. Keep everything else unchanged.

Export to MP4 when you are happy with the result. Projects and draft versions are saved so you can return and make further changes.

### Installing and running

You need Linux, Rust 1.88+, Node.js 22+, tmux, FFmpeg, and Bubblewrap with unprivileged user namespaces enabled.

```shell
git clone https://github.com/echonoshy/yingya.git
cd yingya
npm ci
cp .env.example .env
```

Follow the [installation guide](docs/DEVELOPMENT.md) to configure your environment, host model credentials, and initial account. Set up the HyperFrames browser using the [integration guide](docs/INTEGRATIONS.md). Speech, music, and image generation require their respective service configurations. Keep your existing `.env` when updating an installation.

```shell
npm run web:build
npm run backend:service:start
```

Open `http://127.0.0.1:8797/app`. The backend runs in the `yingya-backend` tmux session on port `8797` by default.

For frequent updates, use the [rolling deployment workflow](docs/ROLLING_UPDATES.md). The API and per-user workers run independently; workers finish their current work before switching versions. The first migration from the older standalone service requires waiting for active tasks to finish.

## Docs

- [Installation and development](docs/DEVELOPMENT.md)
- [Service integrations](docs/INTEGRATIONS.md)
- [Video production workflow](docs/VIDEO_PRODUCTION_WORKFLOW.md) (Chinese)
- [User sandboxes and usage](docs/USER_SANDBOX.md) (Chinese)
- [Rolling updates and task recovery](docs/ROLLING_UPDATES.md) (Chinese)
- [All documentation](docs/README.md) (Chinese)

Questions and suggestions are welcome in [GitHub Issues](https://github.com/echonoshy/yingya/issues).
