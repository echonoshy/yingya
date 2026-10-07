# YingYa motion studies

Four independent Remotion films, revised against the user-supplied 30-second motion reel on 2026-10-07. The reference informs the editorial contrast, tactile paper, fine film grain, orange/blue accents and shape transformations. No frames, soundtrack, brand marks or instructional text from the reference are republished.

| Composition | Length | Visual sequence |
| --- | --- | --- |
| Effects | 5 s | A rotating particle sphere resolves into FORM, then disperses back into space |
| Voice | 6 s | Large Chinese spoken typography on warm paper, an italic editorial heading and measured word highlights |
| Charts | 5 s | Isometric columns rise from a grid; an illustrative three-period comparison unfolds |
| Edit | 5 s | Filmstrip pauses contract; a decisive cut ends in oversized CUT typography |

All animation is driven by the Remotion frame clock. Particle positions, perspective, grain and isometric geometry are generated locally. There is no Remotion or graphics runtime in the website: only exported H.264 MP4s and JPEG posters are shipped. Exports use PNG source frames and explicit BT.709 color conversion; the paper texture stays fixed to avoid unnecessary video noise and bandwidth.

Run from the repository root:

```sh
uv run --with fonttools --with brotli --with numpy --with pillow python design-assets/capability-reels/prepare.py
npx tsc -p design-assets/capability-reels/tsconfig.json
node scripts/render-capability-reels.mjs --stills
node scripts/render-capability-reels.mjs
```

`YINGYA_EXAMPLE_ONLY=Effects` restricts inspection/rendering to one composition. Studio uses the existing `yingya-capability-studio` tmux session on port 3101, with entry `design-assets/capability-reels/src/index.tsx` and public directory `design-assets/capability-reels/public`.

Chinese narration is the existing project-owned VoxCPM2 recording using the saved `yingya-default-narrator` voice. Text: “让声音，有画面。每一个重点，都值得被看见。” Its measured offline ASR output is preserved in `voice-transcript.json`; punctuation is restored in `src/voice-captions.json`. Timing is an ASR estimate, not a claimed listening-certified alignment. No customer media or cloned user voices are used. Chart values are explicitly illustrative.

Local OFL fonts: Noto Sans SC, Noto Serif SC, Bodoni Moda Italic and Fragment Mono, with license copies in `public/fonts/licenses`. Posters, MP4s and durations/file sizes are recorded in `renders.json`.

`source-fonts/` 保存 Bodoni Moda 源字体及许可；准备脚本只依赖本工程与当前 npm 字体包，不读取旧 UI 归档。
