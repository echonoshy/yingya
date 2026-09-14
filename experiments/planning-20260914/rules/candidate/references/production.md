# Production dependencies

## Establish one scene language

Reuse the app-provided `index.html` scaffold after plan confirmation; inspect it before editing. Do not reinitialize the project or overwrite a working entry. Create `DESIGN.md` from the approved plan with shared typography, colors, scene layout rules, motion timing, transitions, caption safe areas, and audio levels. Centralize these choices in composition styles / shared source.

For complex work, choose one representative difficult scene for early internal inspection. Resolve text readability, image treatment, and motion rhythm before expanding it across the film. Small/simple videos can proceed directly to the assembled draft. This does not require another user approval or a separate rendered video.

Keep each scene's purpose distinct and its dominant visual clear. Hold key text long enough to read, leave pauses between dense ideas, and motivate movement by entrance, emphasis, cause, or transition. Do not use identical scene lengths, arbitrary camera motion, or repeated transitions merely to fill time. Respect locked timing and the requested visual style. Keep characters, products, lighting, and typography consistent across shots.

## Audio before final timing

For narration-led videos:

1. Resolve final spoken copy from the approved plan or supplied script before synthesizing. Do not rewrite locked user copy.
2. Read `.yingya/voice.json`. Use its exact `voiceId` in every VoxCPM2 call, including retries and revisions. Check the saved voice is available; a missing voice is not permission to substitute another.
3. Synthesize by scene or natural sentence group, retaining consistent settings and tone. Reuse existing audio only when text, voice, and synthesis settings match. Use versioned filenames so earlier drafts retain their original audio.
4. Measure each output with `ffprobe`. Record scene-local audio paths and measured durations in the scene fields. Use actual speech duration plus intentional pauses to set scene ends; never truncate a sentence to fit an earlier estimate.
5. Derive captions from the resulting audio using an installed alignment / transcription capability. Check recognized text against the script. If only manual sentence alignment is available, describe it accurately and verify it by listening; do not claim word-level alignment.
6. Keep caption times scene-local until assembly, then add the scene offset exactly once. Recompute offsets after duration changes. Hold the ending until narration and captions finish.

For music-led work, align major visual beats with the supplied track using installed audio tools when available. For silent work, omit speech synthesis and transcription; use readable on-screen copy and deliberate hold time. Music and effects should leave speech intelligible. Never generate speech merely because a voice is saved when the user requested a silent video.

## Assets and composition

Keep narration and generated media in `assets/`, scene sources in `compositions/` when needed, review media in `artifacts/`, and reports in `.yingya/reports/`. Use relative paths so immutable source snapshots can render independently. Register produced media in the existing `assets.json` shape before linking its ID to a scene. Preserve existing IDs and fields.

Stable scene IDs connect `scenes.json`, HTML scene elements, assets, and feedback. Write scene-local animation times and assemble from the shared timeline. Do not maintain unrelated hand-written timing copies in captions and HTML. Check local media and fonts load and that the first and last frames contain the intended content.

Independent media preparation can run concurrently when tools support it; integration waits for required inputs. Keep one writer for shared scene timing and the root manifest. Do not start duplicate TTS, checks, or renders for an already-running operation.

## Review evidence

The unified `hyperframes check --snapshots --json` is the final technical gate. Use installed CLI help for supported flags. Where default sampling misses a short scene or critical transition, use explicit timestamps / transition sampling. Review the opening, scene midpoints, important transitions, caption-dense frames, and ending; use additional snapshots only to close a specific coverage gap.

Technical success is not narrative approval. Review frames for hierarchy, safe areas, continuity, and legibility. Listen to narration and inspect caption sync; check music does not mask words. Probe the rendered draft for actual duration, dimensions, fps, and expected audio streams. Keep specific evidence and limitations with the draft. Do not add a numeric aesthetic score or iterate without a concrete defect. If the same failure persists after two targeted repairs, stop repeating the operation, preserve failed evidence, and report the blocker and reusable work without registering a passing draft.

## Revision dependency table

| Change | Rebuild / recheck | Reuse |
| --- | --- | --- |
| Color, layout, graphic, or image in one scene | That scene's visual source / changed asset, composition check, new draft render | Unchanged narration, captions, other scene assets |
| On-screen text only | Text layout and reading time; captions only if tied to the changed text | Speech when its copy is unchanged |
| Spoken copy in one scene | That segment's speech, captions, duration, dependent offsets, composition check and render | Other speech and unchanged media |
| Scene order or duration | Assembly offsets, global captions, transitions, music sync, composition check and render | Unchanged scene-local assets and narration |
| Project voice | All narration and derived captions / timing, composition check and render | Unchanged visual assets |
| Export resolution / fps only | Verify settings and render approved snapshot; rerun source checks if source or layout changed | Approved content and assets; eligible passing report |
| Explanation / scene inventory | Requested metadata only | All rendered media |

A local asset edit can invalidate a composition report even when `index.html` is unchanged. A main-file fingerprint alone is insufficient after an asset, font, nested composition, caption, config, or shared script change. Keep a dependency fingerprint with the report when practical; otherwise rerun the unified check after such changes.
