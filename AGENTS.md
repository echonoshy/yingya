# Yingya repository instructions

## Scope and references

- Follow the user's current request and this file. Read only the task-relevant
  references below; do not treat old chat plans, archived mockups, release notes,
  filenames, or third-party examples as current product requirements.
- [Documentation index](docs/README.md) defines each document's scope. Keep
  detailed rules in their owning document instead of copying them into multiple
  guides. Update an existing rule when behavior changes; do not append a
  conflicting, date-stamped override.
- Inspect `git status` and the relevant diff before editing. Preserve unrelated
  changes, including other ongoing work. Do not publish unrelated changes simply
  because they are present in the worktree.

| Task | Read before changing |
| --- | --- |
| Product UI | [Frozen UI baseline](docs/UI_DESIGN_STYLE.md); [typography](docs/TYPOGRAPHY.md) when changing fixed copy or fonts |
| Product behavior or video workflow | [Product scope](docs/PRODUCT_POSITIONING.md), [production workflow](docs/VIDEO_PRODUCTION_WORKFLOW.md) |
| Agent tools, skills or renderer | [Integrations](docs/INTEGRATIONS.md), [Remotion runtime](docs/REMOTION_RUNTIME.md), and the affected bundled skill/reference |
| Accounts, quotas or isolation | [User sandboxes](docs/USER_SANDBOX.md); [video sharing](docs/VIDEO_SHARING.md) for public media |
| Local services or setup | [Development](docs/DEVELOPMENT.md) and the affected service's operations guide |
| Versions or deployment | [Versioning](docs/VERSIONING.md), [rolling releases](docs/ROLLING_UPDATES.md) |
| Files, dependencies or cleanup | [Project structure](docs/PROJECT_STRUCTURE.md); verify code, process and release references |

## Frozen product UI

- The user froze the current design on 2026-10-07. Follow
  [the UI baseline](docs/UI_DESIGN_STYLE.md) for the website, login, workspace,
  account/admin pages, dialogs and public shares. Keep the current identity,
  palette, typography, layout hierarchy, controls and interaction vocabulary.
- Routine fixes and new functionality extend existing components and tokens.
  Do not introduce a new theme, font system, mascot, layout direction or visual
  redesign unless the user explicitly requests that change. Ordinary fixes
  within the baseline do not require another design-approval step.
- Use the UI baseline's role-based type scale, weight and spacing rules,
  including its scoped Feishu/Lark references. Keep Yingya's existing font
  families and brand. Verify computed styles and narrow-screen readability;
  external examples are not a reason to shrink controls or redesign pages.
- The pinned Anthropic reference linked in the UI document provides methods for
  task clarity, restraint and review. It does not authorize renewed style
  exploration or override the frozen baseline. Generic design skills, new
  upstream guidance and historical UI assets have the same boundary.
- Before implementation, identify the affected task, components and checks;
  small fixes need only a brief plan. Scope CSS to its owner and review real
  screenshots and interactions after UI changes. Preserve keyboard access,
  visible focus, narrow layouts, reduced motion, user drafts and task state.
- Keep Chinese labels clear and consistent; use existing Phosphor icons for
  product controls, not emoji or proprietary third-party product artwork.
  Preserve uploaded avatars and customer media. Follow the
  UI document's coverage matrix; a homepage check is not a whole-product check.
- This freeze applies to the product interface. Generated customer videos use
  their own approved design and project `DESIGN.md`; product styling must not
  become a mandatory video template.

## Development services

- Use named `tmux` sessions. Do not use `systemd`, `systemctl`, user services or
  transient units to manage Yingya development services.
- Before changing services, inspect `data/deployment/active.json` when present,
  `npm run release:status` for an initialized deployment, and `tmux list-sessions`
  or `tmux has-session`. Reuse or deliberately replace the specific owned
  session; do not start a duplicate.
- Run development processes from the repository root and preserve the invoking
  environment, including proxies and instance overrides. Inspect logs with
  `tmux capture-pane`. Report the actual session name and listening port.
- The deployed entry normally owns port 8797; its API uses a dynamic port.
  Keep this entry intact. A separate `yingya-backend` requires an available port
  and isolated data/runtime/cache paths. Rust changes require recompilation and
  `npm run backend:service:restart` with that instance's original overrides.
- `yingya-frontend` serves Vite on 8798. React/CSS changes use HMR; use
  `npm run web:service:reload` only for configuration/dependency changes or stale
  HMR. Its checked-in API proxy targets 8797, not an isolated backend.

## Validation and product versions

- UI/frontend changes: run `npm run typecheck`, `npm run web:build`, relevant
  tests and the visual/interaction checks in the UI baseline. Run
  `npm run test:source` when changing module ownership or removing browser code;
  audit CSS, assets and dynamic/runtime references separately.
- Backend changes: run `npm run format:check`, `npm run lint:rust`, relevant Rust
  tests and affected frontend/API checks. Agent/runtime changes also need the
  relevant tool/skill tests; mocked UI checks do not validate live workers.
- Documentation-only changes: verify links, paths, command names and agreement
  with current code. They require neither a product version bump nor deployment.
  Do not run or claim a full product acceptance solely for prose edits.
- Product versions use `major.minor.patch` in `versions.json`, `package.json`
  and `package-lock.json`. Before publishing product changes, run
  `npm run version:record -- patch --change "..."` unless the current record
  already covers the unpublished batch, then run `npm run version:check`.
- Default routine iterations, including small features, to `patch`; reserve
  `minor`/`major` for a substantial cohesive release or an explicit user request.
  Do not bump per commit, rebuild or rollback. Keep public change text to one
  short Chinese sentence or a few functional bullets; no decorative detail or
  deployment diary. The website shows the latest 5 nonzero patch releases.

## Publishing and verification

- The user-facing workspace is `https://yingya.art/app#/`; the homepage is `/`.
  HMR, a local build or a Vite restart does not publish either public page.
- For requested product changes, include publishing and verifying the live site
  unless the user limits the task to local work, review or preparation. Report
  local-only work as such. Pure documentation/cleanup work does not authorize
  publishing other pending product changes.
- Production serves an immutable release's `web-dist`, not the worktree. Use
  the supported full build by default, from the repository directory:

  ```bash
  yingya_release_id="$(date +%Y%m%d-%H%M%S)-update"
  npm run release:build -- "$yingya_release_id"
  npm run release:activate -- "$yingya_release_id"
  npm run release:status
  ```

- `release:build` snapshots uncommitted changes too: inspect the full included
  diff first. Never overwrite an active release. The frontend-only reuse
  conditions are in [rolling releases](docs/ROLLING_UPDATES.md); no dedicated
  frontend-only build command currently exists. Backend changes require a new
  Rust binary. Reused dependencies must match their manifests/lockfiles.
- Activation checks readiness, publishes hashed assets, switches the entry and
  updates the worker target. Existing workers drain before handoff; activation
  does not prove every worker has upgraded. Do not kill running video tasks.
- After activation, fetch `https://yingya.art/app`, match its script/CSS names
  to the new release, and check those public assets load. Exercise changed
  behavior through the public frontend in a browser. Isolated API mocks are
  acceptable for frontend interactions only; disclose that limitation. Verify
  backend changes against the active API and relevant worker version using
  controlled data. Check active tmux logs and readiness.
- Report the public URL, release ID, relevant tmux sessions/ports, actual checks
  and remaining limitations. If old public assets remain, investigate routing
  and cache headers before asking the user to clear browser storage.
- For compatible rollback, activate the previous release ID. Check data/schema
  compatibility first. Clean obsolete snapshots with `npm run release:prune`
  (dry run), then `npm run release:prune -- --apply`; retain active/previous,
  registered worker/process references, shared dependencies and the latest 3
  complete releases by default. Keep public hashed assets; never manually
  remove a live snapshot.

## Repository and documentation hygiene

- `runtime/` is maintained source; `.runtime/` mixes credentials, models,
  environments and caches. `data/` contains persistent user and deployment
  state. An ignored, old or rebuildable path is not automatically disposable.
- Before deleting files, check source and runtime references, symlinks and
  running processes. Preserve uncommitted scratch-repository source, customer
  projects, credentials, voices and required release dependencies. Remove empty
  retired folders without adding placeholders.
- Retired UI material belongs in ignored `local-ui-archive/`, with its original
  path and archive manifest. It must not be needed by a fresh build or test.
  Remove obsolete instructions; keep only compatibility notes that still affect
  supported data or operations. Preserve asset provenance and licenses.
- Keep current rules in the documents listed above, historical changes in Git
  and `versions.json`, and one-off test evidence in temporary/ignored storage.
  When behavior changes, update its owning document and linked summaries in
  the same change; do not maintain a second competing design or operations guide.
