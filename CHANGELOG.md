# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-23

Split out of [`curry-leaves-assistant`](https://github.com/Curry-Leaves/curry-leaves-assistant)
into its own repository, published as a standalone static bundle.

### Added

- **Standalone Vite + React + TypeScript web UI** for Curry Leaves. Builds to a
  static `dist/` served, unchanged, by the Python backend (pip wheel, Docker, and
  web mode) — the UI is now versioned and released independently of the backend.
- The app icon is vendored under `src/frontend/assets/`, removing the previous
  cross-repo dependency on the backend's `assets/` directory.

[1.0.0]: https://github.com/Curry-Leaves/curry-leaves-assistant-web/releases/tag/v1.0.0
