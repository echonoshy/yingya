# Planning experiment — 2026-09-14

Status: isolated experiment; production skills and customer projects are untouched.

## Question

Does explicit guidance on visual mechanisms, state changes, and continuity
improve the specificity and realization of plans from short prompts, without
unnecessarily complicating simple requests?

## Design fixed before generation

- Three paired planning cases: a silent explanatory diagram, a child-oriented
  creative invitation, and a short typographic loop.
- Same model (`gpt-6-astra`), reasoning effort (`medium`), supplied facts,
  capability description, output envelope, and user brief within each pair.
- Baseline: snapshot of current Yingya skill and planning reference.
- Candidate: the same inputs plus the linked visual-story reference. The queue
  example intentionally differs from every evaluation topic.
- Each generation is a fresh model request with no conversation history or tools.
  This isolates planning instructions; it does not test the full production agent,
  tool discovery, approval flow, or real asset search.
- One sample per condition/case. No statistical generalization or causal claim
  about finished-video quality from this small exploratory sample.
- Save exact inputs, model outputs, usage, elapsed times, and instruction hashes.
- For the explanatory case, use the same builder instructions, renderer, local
  fonts/GSAP, canvas, and duration. The builder receives only that condition's
  plan and common implementation rules. No manual creative enhancements.
- Preserve generated source before any repair; allow only documented technical
  or legibility repairs, using the same criteria for both conditions.

## Review criteria

Record evidence and limitations, not an opaque aesthetic score:

1. Fidelity: objective and facts remain correct; no invented requirements.
2. Visual explanation: important ideas are conveyed by visible relationships.
3. Progression: actions have causes/results and planned reading pauses.
4. Continuity: objects or questions connect when useful.
5. Executability: meaningful events can be implemented without designing them anew.
6. Proportionality: short/simple inputs are not expanded into unnecessary production.
7. Realization: inspect rendered states/transitions and whether the source plan
   survives implementation; distinguish planning improvements from rendering success.

## References informing the candidate

- ChatCut: https://github.com/ChatCut-Inc/agent-plugin/blob/main/codex/skills/create-motion-graphics/SKILL.md
- OpenMontage: https://github.com/calesthio/OpenMontage/blob/main/.agents/skills/motion-graphics/agents/director.md
- Digital Samba: https://github.com/digitalsamba/claude-code-video-toolkit/blob/main/.claude/commands/scene-review.md
- Semantic scene grouping: https://github.com/techdou/remotion-video/blob/main/references/storyboard-parser.md

The candidate is original guidance adapted to Yingya's existing two-checkpoint
contract. External tool-specific commands, fixed cadence rules, and additional
approval gates are not imported.

## Follow-up after the initial three plan pairs

The 24-second baseline already specified a coherent single-chart transaction.
To check whether this is a task-ceiling effect, add one paired 60-second grid
explainer planning case, before reviewing the rendered pair. Same model, effort,
and frozen baseline/candidate rules; common factual input includes the grid,
two local transactions, resources, costs, and failure regimes. This is an
exploratory follow-up, not part of the initially fixed three-case protocol.
It is plan-only and cannot establish full-minute video quality.
