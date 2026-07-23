<p align="center">
  <img src="assets/logo.png" alt="Curry Leaves logo" width="128" height="128">
</p>

<h1 align="center">Curry Leaves — Web UI</h1>

<p align="center">The React front end for Curry Leaves — a static bundle the Python backend serves as-is.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/curry-leaves-assistant-web"><img src="https://img.shields.io/npm/v/curry-leaves-assistant-web.svg" alt="npm version"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT%20%2B%20Commons%20Clause-blue.svg" alt="license: MIT + Commons Clause"></a>
  <a href="https://react.dev"><img src="https://img.shields.io/badge/React-19-149eca.svg?logo=react&logoColor=white" alt="React 19"></a>
  <a href="https://vitejs.dev"><img src="https://img.shields.io/badge/Vite-5-646cff.svg?logo=vite&logoColor=white" alt="Vite 5"></a>
  <a href="https://github.com/Curry-Leaves/curry-leaves-assistant-web"><img src="https://img.shields.io/badge/github-repo-181717.svg?logo=github" alt="GitHub repo"></a>
</p>

<p align="center">
  <a href="#develop">Develop</a> ·
  <a href="#build">Build</a> ·
  <a href="#how-it-reaches-the-backend">How it ships</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="https://github.com/Curry-Leaves/curry-leaves-assistant">Backend</a>
</p>

---

The shared React web UI for [Curry Leaves](https://github.com/Curry-Leaves/curry-leaves-assistant),
a voice & meeting assistant. This repo builds to a static `dist/` bundle that is served, unchanged,
by the Python backend (`curry-leaves-assistant`) and packaged inside its pip wheel and Docker image.

There is **no backend code here** — this is a pure Vite + React + TypeScript app that talks to the
backend over HTTP/WebSocket at its origin.

## Related repos

| Repo | What it is |
|---|---|
| **curry-leaves-assistant-web** (here) | The React web UI — a static bundle |
| [`curry-leaves-assistant`](https://github.com/Curry-Leaves/curry-leaves-assistant) | FastAPI backend — serves this bundle, ships it in the pip wheel |
| [`curry-leaves-assistant-desktop`](https://github.com/Curry-Leaves/curry-leaves-assistant-desktop) | Electron shell — builds this UI and spawns the backend |

## Develop

You need a running backend to talk to. Start `curry-leaves-assistant` (it listens on
`127.0.0.1:5177` by default), then:

```bash
npm install
CL_BACKEND_URL=http://127.0.0.1:5177 npm run dev
```

Vite serves the UI at http://localhost:5173 with hot reload, proxying API/WS calls to
`CL_BACKEND_URL`. In production the UI is served same-origin by the backend, so it falls back to
`window.location.origin` and no env var is needed (see [`src/frontend/api/http.ts`](src/frontend/api/http.ts)).

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload (set `CL_BACKEND_URL`) |
| `npm run build` | Build the static bundle into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npx tsc --noEmit` | Type-check the whole app |

## Build

```bash
npm run build      # → dist/
```

`dist/` is the entire deliverable: static HTML/JS/CSS plus the onnxruntime-web `.wasm` runtime,
all resolved and fingerprinted by Vite.

## How it reaches the backend

The backend repo pins a version of this package and, during its build, unpacks this package's
`dist/` into `src/curry_leaves_assistant/webui/`:

```bash
# in curry-leaves-assistant (scripts/build_webui.sh)
npm pack curry-leaves-assistant-web@<version>
# → extract package/dist/ → src/curry_leaves_assistant/webui/
```

The backend's FastAPI app mounts that directory as an SPA. To ship a UI change: bump the version
here, `npm publish`, then bump the pin in the backend repo. See
[CONTRIBUTING.md](CONTRIBUTING.md#release--how-it-reaches-the-backend) for the full release flow.

## License

Source-available under the [MIT License with the Commons Clause](LICENSE) — every MIT freedom
except selling the software or hosting/support built substantially on it.
