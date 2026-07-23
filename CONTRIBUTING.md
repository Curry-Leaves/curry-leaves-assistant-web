# Contributing to curry-leaves-assistant-web

Thanks for your interest in improving the **Curry Leaves** web UI — bug reports, features, and
docs are all welcome. This is the React frontend; it talks to the Python backend
([`curry-leaves-assistant`](https://github.com/Curry-Leaves/curry-leaves-assistant)) over
HTTP/WebSocket and ships as a static bundle that backend serves.

By participating, you agree to keep interactions respectful and constructive.

## Table of contents

- [Ways to contribute](#ways-to-contribute)
- [Development setup](#development-setup)
- [Project layout](#project-layout)
- [Pull request workflow](#pull-request-workflow)
- [Code conventions](#code-conventions)
- [Release & how it reaches the backend](#release--how-it-reaches-the-backend)
- [Commit messages](#commit-messages)
- [Reporting bugs](#reporting-bugs)
- [License](#license)

## Ways to contribute

- **Report a bug** — open an issue with a minimal reproduction (see [Reporting bugs](#reporting-bugs)).
- **Propose a feature** — open an issue describing the use case *before* writing code, so we can
  agree on the approach.
- **Improve docs** — the README and code comments count.

> Backend behavior (API routes, agents, transcription, storage) lives in the
> [`curry-leaves-assistant`](https://github.com/Curry-Leaves/curry-leaves-assistant) repo, and the
> Electron shell in
> [`curry-leaves-assistant-desktop`](https://github.com/Curry-Leaves/curry-leaves-assistant-desktop).
> Contribute UI changes here; API/backend changes there.

## Development setup

Requires **Node 20+**. You also need a running backend to talk to — start
`curry-leaves-assistant` (it listens on `127.0.0.1:5177` by default), then:

```bash
npm install
CL_BACKEND_URL=http://127.0.0.1:5177 npm run dev
```

Vite serves the UI at http://localhost:5173 with hot reload, proxying API/WS calls to
`CL_BACKEND_URL`. In production the UI is served same-origin by the backend, so it falls back to
`window.location.origin` and no env var is needed (see [`src/frontend/api/http.ts`](src/frontend/api/http.ts)).

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload (set `CL_BACKEND_URL`) |
| `npm run build` | Build the static bundle into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npx tsc --noEmit` | Type-check the whole app |

## Project layout

```
index.html                        Vite entry — loads src/frontend/frontend.tsx
vite.config.mts                   Vite + React SWC + Tailwind config
tsconfig.json                     strict TypeScript
src/frontend/
  frontend.tsx    App.tsx         entry + root component
  api/            one client module per backend router (http.ts owns the base URL)
  types/          one file per domain (mirrors the backend's layout)
  screens/<domain>/               one folder per screen
  components/  hooks/  workers/    shared UI, hooks, and the wake-word worker
  assets/                         app icon and other bundled static assets
```

## Pull request workflow

1. **Open an issue first** for anything non-trivial, so we can agree on scope and approach.
2. **Fork and branch** off `main`:
   ```bash
   git checkout -b feat/short-description   # or fix/… , docs/…
   ```
3. **Make the change.** Keep the diff focused on one concern.
4. **Verify it passes:**
   ```bash
   npx tsc --noEmit && npm run build
   ```
   For a change with a runtime surface, also drive the affected flow in the app against a running
   backend and confirm it behaves as intended.
5. **Update docs** (README, code comments) when behavior or a public surface changes, and add an
   entry under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
6. **Open a pull request** with a clear description of *what* changed and *why*. Link the issue.

## Code conventions

- **Keep TypeScript strict.** `npx tsc --noEmit` must stay green; avoid `any`.
- **Talk to the backend through `api/`.** One client module per backend router; the base URL is
  owned by [`src/frontend/api/http.ts`](src/frontend/api/http.ts) — don't hardcode origins elsewhere.
- **Match the surrounding style** — small, single-purpose modules; clear names; comments that
  explain *why*, not *what*. Prefer boring, direct solutions.
- **Add a screen** — a folder under `src/frontend/screens/<domain>/`, an `api/` client module for
  its backend router, and a tab in `App.tsx`.
- **Complete the change** — types, docs, and a CHANGELOG entry.

## Release & how it reaches the backend

The backend bundles a *published* version of this UI — it doesn't build from source. To ship a UI
change to users:

1. Bump the version in `package.json` and stamp `CHANGELOG.md`.
2. `npm publish` — `prepublishOnly` runs `npm run build`, and `"files": ["dist"]` ships the bundle.
3. In the backend repo, bump the pinned `CURRY_LEAVES_WEB_VERSION` (and the Dockerfile `WEB_VERSION`
   arg) to the new version.

To test an unpublished build end to end, point the backend's `scripts/build_webui.sh` at your local
checkout with `CURRY_LEAVES_WEB_DIR=/path/to/this/repo` (after `npm run build` here).

## Commit messages

Use short, imperative summaries. Conventional-commit prefixes are appreciated but not required:

```
feat: add a keyboard shortcut for the command palette
fix: don't drop the WebSocket token on reconnect
docs: clarify the dev-server backend URL
```

## Reporting bugs

Open an issue with:

- **What you did**, **what you expected**, and **what happened** (a screenshot helps for UI bugs).
- Your **browser** and **OS**, and the **backend version** you're running against.
- Anything relevant from the **browser console** / network tab.

## License

Source-available under the [MIT License with the Commons Clause](LICENSE) — every MIT freedom except
selling the software or hosting/support built substantially on it. By contributing, you agree your
contributions are licensed under the same terms.
