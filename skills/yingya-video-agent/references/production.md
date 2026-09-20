# Current product contract

Read [knowledge-video.md](knowledge-video.md). Reuse approved keyframe source and record per-feedback evidence. No video-generation provider calls.

# Production dependencies

## Establish one scene language

Choose whether to reuse project source, consult the component catalog, search
a registry, or author an effect according to the scene's needs. Follow
[reusable-motion.md](reusable-motion.md) for a matching installed scene and
[third-party-components.md](third-party-components.md) when registry discovery
and adaptation are needed. Reuse the implementation with actual content and the
project's design. Choose by what the scene explains, not by rotating through
effects. Design the subject and its action before choosing an implementation.
Supplied video can be selected, edited and combined with newly produced material
according to the plan; retain its factual meaning and required content.
A 3D model scene displays supplied models, not newly synthesized
footage or a model generated from a prompt.

For a shot that needs a recorded action, follow
[existing-footage.md](existing-footage.md). The installed editorial assembler
is an optional treatment for compatible footage shots, not the default film
structure. Check its catalog before choosing a recipe and preserve source
evidence when assembling or revising those shots.

Reuse the app-provided `index.html` scaffold after plan confirmation; inspect it before editing. Do not reinitialize the project or overwrite a working entry. Create `DESIGN.md` from the approved plan with shared typography, colors, scene layout rules, motion timing, transitions, caption safe areas, and audio levels. Centralize these choices in composition styles / shared source.

If the plan used bundled design references, follow the applicable adaptation in
[design/index.md](design/index.md). Carry its chosen structure into actual
editable elements and semantic motion, not just a color change. Record the
resolved design and selected source commits in `DESIGN.md`; retain copies of
the used reference files, their licenses and provenance under project-local
`assets/design-reference/` for the draft snapshot. Upstream demo fonts, imagery,
fixed dimensions and web animation triggers are not runtime dependencies.
Use installed local fonts and the project's output dimensions. On revisions,
reuse these saved decisions and reference copies rather than rereading a newer
shared reference pack. New choices belong only to the affected scope.

For every new visual treatment, follow
[representative-scene.md](representative-scene.md). Create the sample's required
subjects/assets and inspect actual composition and motion before producing the
remaining scenes. Resolve generation consistency on this passage before ordering
a full set of imagery. An established treatment or focused edit may reuse valid
design evidence. Keep the existing authorization and draft workflow.

Keep each scene's purpose distinct and its dominant visual clear. Hold key text long enough to read, leave pauses between dense ideas, and motivate movement by entrance, emphasis, cause, or transition. Do not use identical scene lengths, arbitrary camera motion, or repeated transitions merely to fill time. Respect locked timing and the requested visual style. Keep characters, products, lighting, and typography consistent across shots.

## Audio before final timing

First choose the timing authority. For existing speech or recorded actions,
source in/out and the original audio determine timing; inspect any transcript
against the footage and preserve original sound by default. A saved TTS voice
does not require replacing the source voice. New narration leads timing only
when it is the approved audio treatment. Do not silently speed up, stretch or
mute original speech to fit an estimated scene length.

Follow `.yingya/requirements.json` and the approved plan. The bounded footage
assembler can preserve or mute source audio; it cannot synthesize narration,
choose music or prove translation merely by writing HTML. Resolve any reported
audio production tasks with actual tracks and matching timing before claiming
completion. `subtitles: none` omits added subtitles; `zh-en` requires both real
language texts and verified alignment. Original text burned into source footage
remains part of that source. Do not call an explanatory label a transcript.

For every project whose structured requirements request narration, replacement
audio, or music (including custom and third-party compositions), add actual
audible tracks and identify their purpose on the static audio node with
`data-editorial-audio-role="narration"`, `"replacement"` or `"music"`.
These tracks must be different from the preserved source recording and carry
real measured timing. Role labels alone cannot satisfy the requirement: verify
the files have audio, the rendered output contains it, and listen to confirm
the content and mix. Keep the requirements snapshot with each immutable
version, whether assembled or custom; do not change frozen requirements to bypass a
failed export. Audio roles are evidence for technical checks, not proof that
the wording, translation or music choice is correct.

For narration-led videos:

1. Resolve final spoken copy from the approved plan or supplied script before synthesizing. Do not rewrite locked user copy.
2. Read `.yingya/voice.json`. Use its exact `voiceId` in every VoxCPM2 call, including retries and revisions. Check the saved voice is available; a missing voice is not permission to substitute another.
3. Synthesize by scene or natural sentence group, retaining consistent settings and tone. Reuse existing audio only when text, voice, and synthesis settings match. Use versioned filenames so earlier drafts retain their original audio.
4. Measure each output with `ffprobe`. Record scene-local audio paths and measured durations in the scene fields. Use actual speech duration plus intentional pauses to set scene ends; never truncate a sentence to fit an earlier estimate.
   Generate HTML audio start/duration and scene windows from these same fields. Ordinary section nesting does not add the section start to an audio element's zero start. Only real sub-composition offsets are inherited. For a single full narration track, obtain sentence/scene offsets from the recording before setting visual cuts; never keep estimated cuts and label them measured.
5. Derive captions from the resulting audio using an installed alignment / transcription capability. Check recognized text against the script. If only manual sentence alignment is available, describe it accurately and verify it by listening; do not claim word-level alignment.
6. Keep caption times scene-local until assembly, then add the scene offset exactly once. Recompute offsets after duration changes. Hold the ending until narration and captions finish.

For music-led work, align major visual beats with the supplied track using installed audio tools when available. For silent work, omit speech synthesis and transcription; use readable on-screen copy and deliberate hold time. Music and effects should leave speech intelligible. Never generate speech merely because a voice is saved when the user requested a silent video.

## Assets and composition

Execute the approved asset strategy: generate or obtain the subjects, images,
environments, textures and sound it needs, and build procedural objects or
diagrams where they communicate best. Read the installed media skill when using
its tool. Inspect generated assets before integrating them; preserve the shared
subject design, material, lighting and palette. Missing attachments do not
justify quietly reducing a visual concept to text panels. If a required asset
route fails, disclose the effect on the result and preserve usable work.

Compose assets for motion: choose crops, layering, masks, staging and camera
changes that support the shot. Keep words and data editable and use actual
subject animation when the plan promises it; panning a still does not establish
continuous character action. Resolve each shot's action and transition within
the common measured scene schedule.

Keep narration and generated media in `assets/`, scene sources in `compositions/` when needed, review media in `artifacts/`, and reports in `.yingya/reports/`. Use relative paths so immutable source snapshots can render independently. Register produced media in the existing `assets.json` shape before linking its ID to a scene. Preserve existing IDs and fields.

Stable scene IDs connect `scenes.json`, HTML scene elements, assets, and feedback. Write scene-local animation times and assemble from the shared timeline. Do not maintain unrelated hand-written timing copies in captions and HTML. Check local media and fonts load and that the first and last frames contain the intended content.

For GSAP API details or text/SVG/path effects, use [GSAP for video](gsap/index.md).
Its offline plugin bundle and video adaptation supplement the installed
HyperFrames references. Keep required scripts inside the project snapshot;
verify direct, backward and repeated seeks as well as the exported MP4.

Independent media preparation can run concurrently when tools support it; integration waits for required inputs. Keep one writer for shared scene timing and the root manifest. Do not start duplicate TTS, checks, or renders for an already-running operation.

## Review evidence

The unified `hyperframes check --snapshots --json` is the final technical gate. Invoke it through `python3 "$YINGYA_PRODUCTION_TASK" check` with the current request ID and report path (see `runtime-tools.md`); use the same runner's `render` command for draft rendering. It preserves command status and separates JSON from stderr. Use installed CLI help for supported flags. Where default sampling misses a short scene or critical transition, use explicit timestamps / transition sampling. Review the opening, scene midpoints, important transitions, caption-dense frames, and ending; use additional snapshots only to close a specific coverage gap.

Apply [visual-review.md](visual-review.md) to the representative passage and the
complete draft. Inspect composition, asset consistency, motion, editing and sound
against the approved treatment. Repair observed defects and retain the compact
review with this draft's source/output identity. Probe actual duration,
dimensions, fps and expected audio streams as separate technical evidence.

The render runner also records verification tied to the current source and MP4.
Read that report and open the extracted MP4 frames. A browser can correctly play
a dynamically inserted video while the offline compiler discovers zero media;
check snapshots alone cannot validate the export. For footage scenes, verify
both the original source identity/in-out and the resulting rendered action and
result. Missing extraction, stale bindings or a readable MP4 containing the
wrong source are failures, not successful drafts. No numeric visual score is
needed; report concrete content, legibility and timing defects.

Check each gate's enabled state and actual samples, not only top-level `ok`. For animation, repair invalid motion assertions using the installed CLI schema; deleting the assertion file is not a repair. Preserve scene, asset, style, font and audio dependencies inside the immutable version.

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
