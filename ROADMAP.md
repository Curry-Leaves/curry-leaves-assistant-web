# Roadmap

This is a living document describing the direction of the **Curry Leaves web UI**.
It is not a commitment or a schedule — priorities shift, and items may be added,
reordered, or dropped. Backend and desktop work is tracked in their respective
repos ([`curry-leaves-assistant`](https://github.com/Curry-Leaves/curry-leaves-assistant),
[`curry-leaves-assistant-desktop`](https://github.com/Curry-Leaves/curry-leaves-assistant-desktop)).

For what has already shipped, see [CHANGELOG.md](CHANGELOG.md).

## Now

Work in progress or up next.

- Polish and accessibility passes across existing screens.
- Tighten the type coverage between the UI and the backend's API surface.

## Next

Planned, not yet started.

- Improved keyboard navigation and command-palette coverage.
- Better empty/error/loading states across screens.
- Reduce bundle size and audit the onnxruntime-web runtime footprint.

## Later

Ideas we like but haven't scoped.

- Theming improvements and user-configurable layouts.
- Offline-friendly behavior where the backend allows it.
- Broader test coverage for critical flows.

## Out of scope

- **Backend features** (API routes, agents, transcription, storage) — these live
  in [`curry-leaves-assistant`](https://github.com/Curry-Leaves/curry-leaves-assistant).
- **Desktop packaging** — see
  [`curry-leaves-assistant-desktop`](https://github.com/Curry-Leaves/curry-leaves-assistant-desktop).

## Suggesting changes

Have an idea? Open an issue describing the use case (see
[CONTRIBUTING.md](CONTRIBUTING.md)). We prefer to agree on approach before code.
