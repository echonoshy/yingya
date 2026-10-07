# Recovery and draft commit

## Resume from evidence

Confirm actual defects before repeating work. If media is confirmed broken: preserve the original, repair the actual source/timeline, rerun checks and render a new immutable version. Reuse valid narration and assets, but never reuse a failed render or copy an old report to certify changed source. A previous export command succeeding does not mean delivery passed.

If the root manifest is `briefing` but composition or render files exist, treat them as unapproved recovery material. Inspect without continuing production; prepare `.yingya/plan.md`, register a `plan_review` checkpoint, and preserve the files. Do not present existing media as approved merely because it exists. Honor explicit prior user approval if the conversation proves it and reconcile the manifest accordingly.

For interrupted or timed-out quality commands:

1. Check whether the original process is active and poll it before launching another.
2. Inspect completed JSON reports; require top-level `ok: true`, never a partial file or prose success claim.
3. Reuse a report only if its checked source is current. TSX, configuration and build-receipt fingerprints must match; inspect changes to referenced assets, nested compositions, config, fonts, captions, and scripts too. If full dependency freshness cannot be established, rerun the unified check.
4. Probe an expected existing video with `ffprobe` and verify it belongs to the checked source and requested render settings. File existence alone is insufficient.
5. Resume only the incomplete stage: narration, alignment, scene build, quality check, render, or version registration. Never regenerate a passing render solely because the command client stopped waiting.

Start checks and renders through the durable production runner described in `runtime-tools.md`. A client wait window ending means the process is still running: poll its session or recorded job and continue the same task. Do not turn a wait window, empty log, or finished JavaScript wrapper into a workflow interruption. The runner has a separate execution deadline and records actual exits, cancellation, and failures. A renderer failure is not permission to mark a draft ready.

## Immutable drafts

Allocate the next unused `.yingya/versions/draft-N/`; never overwrite an older version. Snapshot composition source, required local assets, nested compositions, design/config files, scene timeline, captions, selected voice metadata, passing report, source fingerprint, manifest snapshot, and draft video. Exclude `node_modules`, caches, temporary intermediates, and older version directories. Source-relative references must resolve inside the snapshot.

Freeze the production requirements for every new draft, including custom and
third-party component compositions: copy `.yingya/requirements.json` into the
bundle at the same relative path and preserve `outputSpec.requirements` in its
manifest snapshot. Verify export using
that version's requirements, never the current workspace's later choices.
Missing requirements in legacy versions do not authorize inventing historical
constraints. Keep selected asset roles and referenced semantic observations as
project context when they are needed to explain the saved cut decisions.

For footage edits, retain `remotion.json.media`, selected source files, scene IDs,
source hashes and measured in/out intervals. Preserve the current render verification
report and actual MP4 frames as review evidence. Analysis caches need not be copied.

Keep TSX, `remotion.json`, generated `index.html`, Player resources and
`remotion-build.json` in the immutable bundle. The receipt and durable runner bind
source/assets and output hashes. Never hand-edit a receipt to certify changed source.

Treat registration as a commit:

1. Complete the immutable source bundle, report, and readable review video.
2. Verify every path the next manifest will reference. `sourcePath` can identify the bundle entry or source directory; retain the project's established convention.
3. Prepare the complete next manifest in a temporary file. Include new artifacts and version, set `currentDraft`, clear `dirty`, set `phase: "completed"`, register the delivered `final-video` artifact with its `version` ID and set `checkpoint: null`. Use `draft_review` with a `draft` checkpoint only for an explicit staged-review request or when continuing a legacy draft review.
4. Save the manifest snapshot into the draft bundle, validate complete JSON and references, then atomically rename the temporary manifest over `.yingya/manifest.json` **as the last write**.

If packaging fails, retain the render and incomplete bundle for recovery; do not advertise an unregistered draft as ready. On retry, inspect partial files and finish or allocate a fresh unused version without changing any registered version.

## Rollback

Restore source and manifest pointers from the selected version while retaining later versions. Restore relevant scene, caption, design, and voice context; if the user has since explicitly selected a different voice, surface the conflict instead of silently replacing that choice. Run relevant checks before describing the restored state as stable. Restoring a source version does not authorize external publication or require regenerating unchanged media.
