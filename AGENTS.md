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
- Use Apple's product design principles as the visual and interaction reference:
  clear hierarchy, generous whitespace, precise typography, neutral layered
  surfaces, direct manipulation, and calm motion.
- Apple is a reference, not a template to copy. Preserve Yingya's own name,
  logo, Chinese product voice, video-production concepts, and original assets.
- Reuse the semantic design tokens in `web/src/styles.css`. Do not introduce
  one-off colors, radii, shadows, fonts, or motion timings when a token fits.
- The product is light-first. Use white for the working canvas, cool system gray
  for navigation and inspector surfaces, near-black for primary actions, and
  system blue only for focus, links, selection, and live status.
- Prefer alignment, spacing, typography, and hairline separators over decorative
  effects. Avoid dark-tech styling, purple glow, ambient grids, and ornamental
  Agent chrome.
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
