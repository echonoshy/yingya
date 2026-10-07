# Yingya repository instructions

## Development service process management

- Do not use `systemd`, `systemctl`, user services, or transient systemd units
  to start, stop, restart, or supervise Yingya development services.
- Run development services in named `tmux` sessions so their environment,
  output, and lifecycle remain visible and controllable from the workspace.
- Before starting a service, use `tmux has-session` or `tmux list-sessions` to
  check whether its session already exists. Reuse or deliberately replace that
  specific session instead of starting a duplicate process.
- Start backend and frontend processes from the repository working directory
  and preserve the invoking shell's required environment, including proxy
  variables. Inspect logs with `tmux capture-pane`.
- When reporting service status, include the tmux session name and the listening
  port. Do not treat a systemd unit as the source of truth for this repository.

## Product version records

- Product versions use `major.minor.patch` and are recorded in `versions.json`;
  date-based deployment IDs remain separate. Follow `docs/VERSIONING.md`.
- Default routine product iterations to `patch` (for example,
  `0.4.1` → `0.4.2` → `0.4.3`), including small feature improvements.
  Frequent releases alone are not a reason to increment `minor` or `major`.
- Before publishing product changes, record the development changes with
  `npm run version:record -- patch --change "..."`, unless the current version
  record already covers this unpublished batch. Do not bump for every commit,
  rebuild, rollback, or documentation-only edit.
- Reserve `minor` for a substantial, cohesive feature release or an explicit
  user request. Record every release with a brief `--change`; titles and
  milestone summaries are unnecessary. The website shows only the latest 5
  patch releases (nonzero patch number), newest first, using their change text.
- Keep version records and user-facing update notes brief: one short Chinese
  sentence or a few concise bullets describing the main changes is enough.
  Public notes focus on important functional changes, not decorative adjustments.
  Frequent patch releases do not need long explanations, exhaustive change
  lists, or repeated implementation and deployment details.
- Run `npm run version:check`. Keep the version history, package manifest, and
  package lock in the same change; do not publish mismatched versions.

## Updating development and the live website

- The user-facing website is `https://yingya.art/app#/`. The Vite development
  server at port `8798` is a different frontend. HMR, a successful
  `npm run web:build`, or restarting `yingya-frontend` does **not** publish to
  `yingya.art`. Never tell the user to refresh the website based only on a
  development-server check.
- For requested product changes, include publishing and verifying the live
  website in the work unless the user explicitly limits the task to local
  development, review, or preparation. Report local-only work as local-only.
  Documentation-only changes do not require deployment.
- Before changing services, inspect `data/deployment/active.json`,
  `npm run release:status`, and the named tmux sessions. The deployed entry
  normally owns port `8797`; its API uses a dynamically assigned port.
  Do not start `yingya-backend` on that occupied port or replace the deployed
  entry with a development server. Use isolated data and a free port for a
  separate backend development instance.

### Frontend changes

- In development, React/CSS changes use Vite HMR in `yingya-frontend` on port
  `8798`. Restart that session with `npm run web:service:reload` only when
  configuration/dependency changes require it or HMR is demonstrably stale.
- Run `npm run typecheck`, `npm run web:build`, relevant frontend tests, and
  the visual checks required below before publishing.
- Production serves a release snapshot's `web-dist`, not the worktree's
  `web/` or `web-dist`. Publish a new immutable release and activate it using
  `scripts/release.py`; never overwrite the active release in place.
- A frontend-only release may reuse the active Rust binary after verifying
  that its backend source and build inputs are unchanged. Keep an independent
  release snapshot with the updated frontend source, built `web-dist`, and a
  `release.json` pointing to the new release paths. Reuse runtime dependencies
  only when their manifests/lockfiles match. If these checks cannot be made,
  use the full release build below.
- There is currently no dedicated frontend-only build command. The standard
  release build is the supported default. Even a release reusing the Rust
  binary currently switches the API gateway: it selects frontend resources
  through the release resource directory. Frontend and backend are packaged
  together, rather than independently deployed services.

### Backend or combined changes

- In an isolated development setup, Rust changes require recompilation and
  restarting the owned `yingya-backend` session with
  `npm run backend:service:restart`; they do not use Vite HMR.
- Run `npm run format:check`, `npm run lint:rust`, relevant Rust tests, and
  any affected frontend/API checks. Build a new Rust binary for backend
  changes; do not reuse a stale executable.
- Use the existing rolling release workflow from the repository directory
  with a new, unique release ID, preserving the invoking environment:

  ```bash
  yingya_release_id="$(date +%Y%m%d-%H%M%S)-update"
  npm run release:build -- "$yingya_release_id"
  npm run release:activate -- "$yingya_release_id"
  npm run release:status
  ```

- `release:build` snapshots the worktree, including uncommitted changes;
  inspect the diff first so unrelated work is not accidentally published.
  `release:activate` checks readiness, publishes hashed static assets,
  switches the nginx entry, and updates the worker release target. Existing
  workers drain before handing off; activation is not proof that every
  worker has already upgraded. Do not kill running video tasks to force an
  update. Release services run from their immutable snapshot directories
  under the existing tmux release manager.
- During the current pre-user rapid iteration phase, use `npm run release:prune`
  (dry run) then `npm run release:prune -- --apply` for obsolete snapshots. Retain
  the active/previous releases, registered worker and process references, shared
  dependency snapshots, and the latest 3 complete releases by default. Keep public
  hashed static assets. Never manually remove a live snapshot. For a compatible rollback,
  reactivate the previous release ID with `npm run release:activate -- ID`;
  first check data/schema compatibility if the update changed persistence.

### Verify the actual published result

- Fetch `https://yingya.art/app` after activation and verify its script/CSS
  filenames match the new release, then check those public assets load.
  A new build on disk or a healthy API alone is insufficient.
- Exercise the changed behavior using the public website's frontend in a
  browser. For frontend-only interaction checks, isolated API mocks are
  acceptable, but report that limitation; they do not verify live backend
  changes. Verify backend changes against the active API and relevant worker
  version as well, using controlled data.
- Inspect the active tmux logs and readiness. Report the public URL, release
  ID, relevant tmux session names/ports, checks performed, and any remaining
  limitations. If the public page still references old assets, investigate
  routing and cache headers before asking the user to clear browser storage.

## UI design source of truth

- Any work that creates or changes user-facing UI must read and follow
  [`docs/UI_DESIGN_STYLE.md`](docs/UI_DESIGN_STYLE.md) before implementation.
- Apply the project-adapted Anthropic frontend-design workflow in that document:
  identify the user's task, make a brief design plan, check it against the
  approved direction, implement, then inspect screenshots and interactions.
  Scale planning to the change; a small fix does not need a redesign proposal.
- The normative reference is the user-selected `frontend-design/SKILL.md` at
  Anthropic commit `dbdd79cebfae5891f5b0fab6f7773ea520d289a7`, linked in that
  document. Apply its task-first design, deliberate typography, restraint,
  actionable copy, and screenshot critique to every product surface, including
  account/admin pages, dialogs, and empty/error states. Use the document's
  coverage matrix; a homepage review alone is not a whole-product review.
- Treat Anthropic's guidance as design principles, not a request to copy its
  brand or replace Yingya's approved identity. Existing product requirements
  and the user's explicit choices take precedence over generic style advice.
- Use clear action labels consistently across controls and feedback. Empty
  and error states must explain the next useful action. Give decoration and
  motion a specific purpose, and scope CSS changes to their intended surface.
- Follow the user-approved 2026-09-29 print direction: ivory paper, navy ink,
  orange sprout identity, expressive editorial typography, and generous whitespace.
  The former landscape/ghost theme is archived, not an active UI option.
- Keep each screen focused. Do not accumulate stickers, thick frames, props,
  slogans, feature cards, or decorative technical chrome.
- Reuse the semantic design tokens in `web/src/styles.css` and the shared
  `web/src/print-studio.css` layouts. Keep body text and working controls legible.
- Use the original ghost identity recolored in navy at
  `web/public/brand/yingya-ghost-navy.svg`, as requested by the user on 2026-09-30. Preserve
  Yingya's Chinese product voice, user data, uploaded avatars, and customer media.
- Keep the prompt composer and current task state easy to find throughout an
  Agent run. Command output, debug data, and secondary controls use progressive
  disclosure.
- UI changes must remain usable at keyboard focus, narrow/mobile widths, and
  `prefers-reduced-motion`. Do not use color as the only status signal.
- Use Phosphor icons already present in the project. Do not use emoji as product
  interface icons or copy Apple's trademarks, product artwork, or proprietary
  system assets.
- Before handing off a UI change, run the relevant typecheck/build and visual UI
  checks, then review it against the checklist in the design-style document.

These rules apply to product UI, not to generated customer video compositions;
those follow the design contract inside their own project workspace.
