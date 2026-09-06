# Recovery and draft commit

## Resume from evidence

If the root manifest is `briefing` but composition or render files exist, treat them as unapproved recovery material. Inspect without continuing production; prepare `.yingya/plan.md`, register a `plan_review` checkpoint, and preserve the files. Do not present existing media as approved merely because it exists. Honor explicit prior user approval if the conversation proves it and reconcile the manifest accordingly.

For interrupted or timed-out quality commands:

1. Check whether the original process is active and poll it before launching another.
2. Inspect completed JSON reports; require top-level `ok: true`, never a partial file or prose success claim.
3. Reuse a report only if its checked source is current. Main source and motion-sidecar fingerprints must match; inspect changes to referenced assets, nested compositions, config, fonts, captions, and scripts too. If full dependency freshness cannot be established, rerun the unified check.
4. Probe an expected existing video with `ffprobe` and verify it belongs to the checked source and requested render settings. File existence alone is insufficient.
5. Resume only the incomplete stage: narration, alignment, scene build, quality check, render, or version registration. Never regenerate a passing render solely because the command client stopped waiting.

Start long checks and renders through an execution path that yields and can be polled. Allow up to ten minutes for healthy work that continues producing progress. A client wait limit is `incomplete` until the process exits or valid output proves the result. A renderer failure is not permission to mark a draft ready.

## Immutable drafts

Allocate the next unused `.yingya/versions/draft-N/`; never overwrite an older version. Snapshot composition source, required local assets, nested compositions, design/config files, scene timeline, captions, selected voice metadata, passing report, source fingerprint, manifest snapshot, and draft video. Exclude `node_modules`, caches, temporary intermediates, and older version directories. Source-relative references must resolve inside the snapshot.

Keep `source-fingerprint.json` beside the report. Its `files` map contains SHA-256 digests keyed by relative path, including `index.html` and `index.motion.json` when present. Include other production dependencies for recovery comparison. Fingerprint the actual checked source; do not label new source with an old passing report.

Treat registration as a commit:

1. Complete the immutable source bundle, report, and readable review video.
2. Verify every path the next manifest will reference. `sourcePath` can identify the bundle entry or source directory; retain the project's established convention.
3. Prepare the complete next manifest in a temporary file. Include new artifacts and version, set `currentDraft`, clear `dirty`, set `phase: "draft_review"`, and add a `draft` checkpoint referencing review artifacts.
4. Save the manifest snapshot into the draft bundle, validate complete JSON and references, then atomically rename the temporary manifest over `.yingya/manifest.json` **as the last write**.

If packaging fails, retain the render and incomplete bundle for recovery; do not advertise an unregistered draft as ready. On retry, inspect partial files and finish or allocate a fresh unused version without changing any registered version.

## Rollback

Restore source and manifest pointers from the selected version while retaining later versions. Restore relevant scene, caption, design, and voice context; if the user has since explicitly selected a different voice, surface the conflict instead of silently replacing that choice. Run relevant checks before describing the restored state as stable. Restoring a source version does not authorize external publication or require regenerating unchanged media.
