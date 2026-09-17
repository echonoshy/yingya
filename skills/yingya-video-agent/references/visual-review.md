# Review the film's visual craft

Use during the representative dynamic passage and before registering a new
draft. This is an internal production step within existing authorization.
Technical checks, asset generation and a successful render do not themselves
establish that the film looks good. Judge the user's approved treatment; do not
impose a house palette, ban expressive effects or add a user approval checkpoint.

## Inspect actual evidence

For a representative passage, open the rendered/preview frames and inspect its
movement at meaningful times. For draft delivery, read the production runner's
output-bound render report and inspect frames decoded from that actual MP4.
Cover every scene's subject, main action and readable result, plus significant
transitions and the ending. Supplement the runner's default samples when they
miss these moments. Use browser playback or sufficiently close frame sequences
to inspect motion; one attractive still cannot validate pacing or transitions.
Listen to the actual sound when present. State any unavailable viewing/listening
capability accurately; never claim a full motion/audio review from stills alone.

## Assess and repair concrete defects

| Dimension | What to look for | Repair when observed |
| --- | --- | --- |
| Composition | Clear subject and focal hierarchy, intentional scale, depth, balance and negative space; readable Chinese at output size | Reframe, simplify competing elements, adjust type and spacing |
| Assets and art direction | Relevant imagery; compatible subject appearance, material, light and palette across shots; clean cutouts and adequate resolution | Select or regenerate the affected asset using the shared treatment; integrate its crop, edges and lighting |
| Motion | Subject transformation or intentional emotional movement; coherent easing, timing and settling; reproducible seeking | Adjust the actual action and timing, not only its entrance; remove accidental drift, jitter or conflicting clocks |
| Editing | Shots advance the story; changes of scale and composition sustain attention; holds and transitions feel intentional | Vary staging where scenes repeat mechanically; trim empty waits and give complex actions time |
| Sound and meaning | Visible events follow real speech/beats when appropriate; important content has time to register; music leaves speech intelligible | Repair timing or mix while preserving locked wording and required audio |

Notice failures such as unrelated stock-like imagery, inconsistent generated
subjects, paragraphs copied into identical cards, the same fade on every scene,
or decorative motion obscuring the message. Treat these as observed issues to
fix, not universal bans: an explicitly requested typographic film or deliberate
minimal hold can be the right treatment. Do not force new assets into a strong
procedural scene merely to increase tool usage.

Choose the highest-impact visible problem, make a targeted change and inspect
the affected passage again. Reuse clean assets and audio. After two targeted
repairs leave the same material defect unresolved, preserve the evidence and
explain the concrete blocker; do not disguise it as a passing aesthetic review.
Follow the existing scope-change process if the approved concept must change.
Do not invent numerical beauty scores or run an unbounded polishing loop.

## Retain a compact review with the draft

For the representative passage, record results in the existing plan section.
For the complete draft, write `.yingya/reports/visual-review-draft-N.md` and
register it as a report artifact together with the normal draft artifacts.
Include:

- The reviewed draft/output path, `sourceFingerprint` and `outputSha256` from
  the actual render receipt, and the render-verification report path.
- Reviewed scene IDs/time ranges and actual frame/sequence evidence paths;
  whether motion and sound were inspected and by what means.
- Specific observed defects, repairs, the reinspection outcome and limitations.

Record an observation when the result needs no repair; do not manufacture a
defect or claim to have opened evidence that was only generated. Update the
review after any source/output change, using the new render's identity; never
attach a previous draft's conclusion to different output. Preserve the review
and its evidence with the immutable version. This is review evidence, not a
new manifest phase or an automated aesthetic score.
