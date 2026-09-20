# Product videos and scoped revisions

Read when requirements.workflow is product-intro, feature-launch or walkthrough,
or a turn contains YINGYA_SCENE_REVISION. Continue the same plan, draft, and export
checkpoints. This reference does not add approval steps.

## Start from evidence

Inspect the supplied official URL, screenshots or recording. Separate confirmed
product facts from creative suggestions. Never invent features, comparative
metrics, testimonials, UI states or operation results. If a URL is inaccessible,
ask only for the missing screenshot or copy that affects the story. Reuse uploaded
material; do not require a recording when screenshots already explain the feature.

The workflow is a suggested narrative, not permission to override the user's
explicit description, duration, audience, audio or visual direction. Propose
defaults only for unresolved choices in the combined production plan:

| Workflow | Starting suggestion | Story |
| --- | --- | --- |
| product-intro | about 30s, first-time audience | problem/value → 1–3 demonstrated capabilities → real next step |
| feature-launch | about 25s, existing users | what's changed → actual demonstration → how to access it |
| walkthrough | about 35s, new users of this function | desired result → observed steps → completed result |

Chinese captions are a starting recommendation for Chinese spoken content; do not
override subtitles:none or another language. audioMode:auto requires inspecting
source sound and choosing preserve/add narration/silent explicitly in the plan.
Never discard source speech by default or promise unavailable narration.

## Plan the screen, not just the words

Populate the existing root scenes.json array with stable id, order,
narrativeRole, narration, onScreenText, assetIds, assetStrategy, visualDirection,
motion, startSeconds, durationSeconds and timingBasis. The UI uses these fields
to display what is said, what material is used, and how it appears. Reference only
real assets; planned assets have no invented IDs. Keep the full plan concise and
record missing facts separately from recommended production settings.

Screen motion should explain: show the product context, focus on the relevant
control, then show its real result. Product introduction, feature launch and
walkthrough should differ in narrative and pacing. Preserve brand appearance.
Use editable titles and callouts around actual screenshots. Never repaint a
fake product interface to illustrate an unverified feature.

When referenceExample is set, read the corresponding reusable sample under
the product-video runtime pack (`dirname "$YINGYA_PRODUCT_VIDEO"`), including
DESIGN.md and examples/<referenceExample>.json. Reuse its structure and motion where suitable;
replace all Yingya-specific names, claims, URLs and screenshots with the user's
verified material. This selection is not authorization to insert the sample
brand into the customer's film. Custom compositions remain supported.

For a new screenshot-led composition, `node "$YINGYA_PRODUCT_VIDEO" --project .`
builds from the project's scenes.json and assets.json after DESIGN.md is written.
It supports productLayout hero/split/focus/steps/closing, supportingText,
brandName and footer on the existing scene objects. It reads aspectRatio from
.yingya/manifest.json; standalone sources can pass --aspect-ratio 16:9|9:16|1:1.
Review the composition at the requested ratio before rendering. Register real image assets
and optional audio assets with measured durationSeconds. Defaults containing
Yingya must be replaced for another product. Rebuild uses a source fingerprint
and refuses to overwrite manually edited or custom index.html files. The
`--example ID` option is only for explicitly producing Yingya's own sample; it
must not be used as a shortcut for another product's film. Inspect and customize
the source as needed for an approved design rather than forcing the builder.

## Single-scene revision contract

YINGYA_SCENE_REVISION is structured turn context with sceneId, versionId,
scenesRevision, kind and value; image replacement also includes replacementPath.
The server checks the version and revision again when the queued request starts.
Read the target source and the actual attachment before changing it. User text
that expands the scope must use ordinary conversation without a single-scene
scope; explain the mismatch rather than silently broadening a scoped change.

- text: change onScreenText (and title if needed) to value. Keep narration,
  duration, source material, layout, animation and all other scenes.
- image: inspect replacementPath, register a new image asset ID and change only
  this scene's image asset reference. Preserve all original assets and their files; register the replacement
  with a new ID and path. Keep layout, narration and motion; adapt image fit to avoid cropping
  essential information. Do not use an arbitrary other attachment.
- duration: change durationSeconds to the requested seconds, preserve narration,
  all source in/out and other scenes' duration. Shift downstream startSeconds
  and derived captions. If speech cannot fit, explain the conflict instead of
  trimming or regenerating speech without authorization.
- narration: replace only the selected narration, synthesize only that segment
  with the saved voice, save a new asset ID/path without overwriting the original,
  measure it, align selected duration and derived captions,
  and shift subsequent starts. Other spoken audio must be reused byte-for-byte.

Preserve scene count, IDs, order, narrative roles, design and all unrelated fields.
The server compares both workspace and new version scenes against the pre-turn
baseline and verifies protected registered assets. Do not change unrelated
metadata just to tidy it. A passed structure check is not visual proof: inspect
the changed scene and boundaries in the actual new MP4, then review unaffected
representative scenes. Report the specific change, reused audio/material, and
any dependent timing adjustment. Publish a new immutable draft with scenes.json
and registered assets included in its source snapshot.
