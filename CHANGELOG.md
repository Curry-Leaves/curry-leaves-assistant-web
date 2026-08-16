# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Rename a recording from its title.** The Recordings detail header is now click-to-edit —
  Enter or blur saves, Escape reverts. Previously the only name field was buried in the
  "Notes & files" tab. A cleared name isn't saved, since the backend would substitute the
  placeholder that re-arms the auto-titler.
- **Tag recordings, during or after capture.** A Tags row in the recording context panel, which
  renders in both the live Capture view and the Recordings detail — so the same control covers
  mid-meeting and after-the-fact tagging. Suggestions come from tags already used elsewhere, so
  the vocabulary converges instead of forking into near-duplicates.
- **Live transcript reads as text or as a timeline.** A Text/Timeline toggle in the transcript
  header. Text is the existing flowing passage; Timeline stacks each transcribed chunk as its
  own row with the elapsed time it landed at, oldest first — for reading back what was said
  when rather than following the flow. The choice persists. Both views keep the same
  scroll-follows-newest behaviour, including releasing when you scroll up to read back.
- **Notes moved into the centre column while recording.** The running notes now sit directly
  beneath the pin composer that writes into them, instead of in the right-hand context panel —
  so what you type into and where it lands are next to each other. Pinning a note appends its
  timestamped line to the body live. The right panel drops its own Notes box during a recording
  (the Recordings detail keeps it), because both edited the same string and only one of them
  could stay in sync.
- **Mark the organizer of a meeting.** Each attendee chip carries a person icon that marks
  whose meeting it is; the organizer's chip is filled in. Clicking the current organizer unsets
  it. Removing that person as an attendee clears the role rather than leaving a stale name.
- **`@` mentions an attendee in notes.** Typing `@` in either the pin composer or the notes body
  offers this recording's attendees — arrow keys or Tab/Enter to pick, Escape to dismiss. It
  inserts the plain name, so notes still read as sentences to you and to the summarizer. Add
  someone as an attendee to make them mentionable.
- **Group the recordings list by tag.** A "Group by tag" toggle turns the list into collapsible
  per-tag groups, ordered most-used first with Untagged last. A recording files under its first
  tag, so it appears exactly once; the lead chip is highlighted in the editor and the others can
  be clicked to promote. Groups holding the selection — and all groups while searching — stay
  open. Sorting inside each group toggles newest/oldest, and both preferences persist.

## [1.3.2] - 2026-08-09

### Fixed

- **`npm install` no longer resolves an unnecessary dependency tree.** The package
  ships a pre-built `dist/` with every library already bundled in by Vite, but
  `package.json` still declared those libraries (React, Excalidraw, MDXEditor,
  mermaid, onnxruntime, …) as runtime `dependencies` — so installing the package
  pulled their entire transitive tree, which was slow and could fail to resolve
  (`ERESOLVE`) on React 19 peer ranges. They are now `devDependencies`, since
  nothing in the shipped bundle imports them at runtime. Installing the package
  now adds just the one package with no dependencies.

## [1.3.1] - 2026-08-09

### Changed

- **Smaller published bundle.** The decorative background PNGs (leaf art and the
  dashboard scenes) were recompressed to a 256-colour palette with no visible
  quality loss, cutting them from ~24 MB to ~6 MB. The published npm tarball
  drops from ~34 MB to ~15 MB, so `npm install` and every backend deployment
  pull far less.

## [1.3.0] - 2026-08-09

### Added

- **Drawings in notes.** *Insert → Drawing* in the note editor adds a freehand Excalidraw canvas —
  boxes, arrows, text and hand-drawn shapes — that renders inline wherever the note is shown, and
  can be sized and aligned from the block header. It runs fully offline: the canvas is bundled with
  its own fonts and makes no network request, and its library/export-to-link side doors are turned
  off. The scene is stored in the note as readable JSON in an ```` ```excalidraw ```` fence rather
  than as a binary attachment, so a drawing stays diffable and travels with the note. Images pasted
  into a drawing are deliberately dropped (with a notice) — Excalidraw would inline them as base64,
  which would put megabytes of binary in a markdown file; use the note's own image attachments
  instead. In read-only views the drawing renders as exported SVG through the existing sanitizer,
  so a note never mounts an editable canvas just to be read.
- **Drag-to-resize for drawings.** A drawing's bottom edge is a drag handle: pull it to size the
  canvas, with the live pixel height shown in the block header and a double-click to reset. The
  size is written to the note only when the drag ends, so resizing doesn't flood the note's
  history with one entry per pixel. Drawings also start taller (620px, up from 420px), since a
  canvas whose toolbar eats a third of its height isn't much use to draw in.
- **Full-screen drawing.** The **⛶** button in a drawing's header expands the canvas to the whole
  window for real work — the shape properties panel finally has room — and Esc or **⛶ Exit** puts
  it back at its stored size. Expanding restyles the block in place rather than reopening it in a
  dialog, so the same canvas stays mounted and the undo history, current tool and scroll position
  all survive the switch. Readers get the same reach: clicking a drawing in a saved note opens it
  full screen, scaled to the window, with Esc or a click outside to close.
- **A conversation panel for AI note editing.** The note editor's **✦ AI** button (next to
  Properties) opens a rail on the right where you ask for changes and *keep talking* — each
  follow-up carries the earlier turns to the model, so "now make it shorter" or "undo that
  last bit" knows what it refers to. Previously every AI edit was a one-shot bar at the bottom
  of the editor: it vanished once the edit landed, and a "Refine" re-ran from scratch with no
  memory of what you had already asked. Changes are still reviewed exactly as before, in the
  side-by-side diff with per-hunk accept/reject — the diff stops at the panel's edge so the
  conversation stays usable while a proposal is on screen, and each turn leaves a receipt in
  the thread ("Applied 2 changes", "Kept 1 of 3") so scrolling back shows what the AI actually
  did to the note. A proposal you close without deciding can be reopened from its receipt.
  Only the summary of each turn is sent back, not the rewritten note, so a long conversation
  doesn't put one full copy of the note in the prompt per turn.
- **Settings → Capture → Live Copilot.** A new section for the in-meeting copilot: an on/off
  switch (it now ships off, since each suggestion is a real assistant run against your AI
  provider) plus controls for how often it speaks up — how much new speech to hear before a
  suggestion, the gap between suggestions, how many cards at a time, and a per-recording cap.
- **A Live Copilot toggle on the recording screen.** The copilot rail carries a switch that
  overrides the app setting for that recording only, so a single meeting can have it on (or off)
  without changing the default. Each new recording starts from the app default again.
- **Per-provider on/off switches in Settings → AI providers.** Each connected provider card
  gained an enable switch, separate from Disconnect: turning one off parks it while keeping its
  credentials, and a card in that state shows "Connected · off" with an explanation. A disabled
  provider can't be set as the default, is excluded from the assistant and chat model pickers,
  and sorts below the working ones while staying visible so it can be switched back on.
  Reconnecting a provider — by key, OAuth, or through the setup wizard — switches it back on.
- **AI editing for tables, blocks and images.** Hover a table, a rich block (kanban, chart,
  calendar, …) or an image in the note editor and a **✦ AI** handle appears at its corner, with
  actions suited to that element — fill in missing cells, add a summary row, sort rows, add more
  items, write alt text — plus a free-text box. Previously AI only worked on prose: these
  constructs cannot be selected in a way the model can act on (a table's on-screen selection
  doesn't match its `| a | b |` source, and a rich block's content never enters the selection at
  all), so the edit had no way to land. The handle sends the element's markdown instead and
  replaces just that element, with the usual diff to review before anything is applied.
- **Resizable table columns and rows in notes.** Drag a column or row border in the note editor
  to size it; the sizes are remembered and the read view renders the table the same way. They
  are stored in a small `<!-- cl-table: … -->` comment above the table, because a markdown table
  row has nowhere to put a width — so the table itself stays plain markdown that any other
  editor can open, and a table you never resize is written exactly as before.

### Changed

- **Codex says up front that it needs your own OAuth client ID.** The backend no longer ships a
  built-in Codex client id, so the provider card and the setup wizard now read `codex.configured`
  from `/providers/status` and, when it's missing, explain what to set
  (`CURRY_LEAVES_CODEX_CLIENT_ID`) and disable the sign-in button — instead of letting the click
  through to a failure. They also point at the OpenAI API-key provider as the simpler route.
- **The Copilot client-ID override is easier to find.** The Copilot card now states that it signs
  in with the built-in Curry Leaves GitHub app and that supplying your own client ID lives under
  Advanced, rather than only explaining the override once that section is expanded.
- **Provider connectedness comes from the backend now.** The settings cards, the setup wizard,
  and the assistant form each re-derived "is this connected?" independently; they now read the
  `connected` / `enabled` fields the `/providers/catalog` response carries, so all three agree
  with each other and with what a real run would do. The AI-status banner grew a matching
  "Your AI provider is turned off" state.

### Fixed

- **Line breaks inside note table cells.** Pressing Enter in a table cell in the note editor
  only ever jumped to the next row, so there was no way to put a second line in a cell.
  **Shift+Enter** now inserts a line break (plain Enter still moves down a row, which keeps
  filling a column quick). The break is stored as a `<br />` — a markdown table row is a single
  line of source, so that is the only form that survives a save — and the note viewer renders
  it as a real break instead of showing the literal tag.

## [1.2.0] - 2026-07-28

### Added

- **Copilot connection: Advanced overrides.** The GitHub Copilot card gained an
  "Advanced" section with two optional fields: a **Client ID** override and a
  **custom Headers** editor (one `Name: value` per line). Leaving them blank uses
  the default Curry Leaves app and request identity. Supplying a client id and/or
  custom headers switches the connection to GitHub's token-exchange path, which can
  change which models GitHub returns — this is the user's choice and their
  responsibility under GitHub's terms. Both take effect on the next connect.

## [1.1.0] - 2026-07-27

### Added

- **Copilot model picker: Custom… free-text option.** The model dropdown now
  offers a "Custom…" entry that swaps to a free-text input, letting you enter a
  model id the models endpoint doesn't list yet (e.g. a preview or beta id).
  A picked model that isn't in the pulled catalog is treated as custom
  automatically, and a datalist still surfaces the known ids as suggestions.

## [1.0.3] - 2026-07-26

### Fixed

- **Chat page no longer scrolls the top bar off-screen.** Opening Ask AI
  auto-scrolled the message thread with `scrollIntoView`, which walked up to
  the document and shifted the whole fixed-height app up — clipping the top
  tab bar. The thread now scrolls its own container directly, leaving the app
  chrome pinned.

## [1.0.2] - 2026-07-26

### Fixed

- **Sidebar rail no longer clips its popovers.** The rail's `overflow-y-auto`
  forced horizontal clipping too, cutting off the hover tooltips and the theme
  quick-pick popover — which deliberately spill out to the right of the 48px
  rail — and painting them behind the main content. The rail never needs to
  scroll, so the scroller was removed.

## [1.0.1] - 2026-07-26

### Added

- **Setup Wizard: Knowledge and Voice steps.** The wizard now conditionally
  surfaces a Knowledge step (semantic search model downloads) and a Voice step
  (TTS model downloads and configuration) based on the user's selections.
- **Knowledge settings** section in the Settings screen for managing semantic
  search model downloads.
- **Voice / TTS model management** in the Wake Word settings, including model
  download and configuration.
- Inbox and Boards views on the Dashboard, a Save Skill modal in Ask AI, and
  vendored dashboard background assets.

### Changed

- Default light theme is now `sepia` instead of `paper`.
- Improved type definitions for knowledge and task management.

## [1.0.0] - 2026-07-23

Split out of [`curry-leaves-assistant`](https://github.com/Curry-Leaves/curry-leaves-assistant)
into its own repository, published as a standalone static bundle.

### Added

- **Standalone Vite + React + TypeScript web UI** for Curry Leaves. Builds to a
  static `dist/` served, unchanged, by the Python backend (pip wheel, Docker, and
  web mode) — the UI is now versioned and released independently of the backend.
- The app icon is vendored under `src/frontend/assets/`, removing the previous
  cross-repo dependency on the backend's `assets/` directory.

[1.3.2]: https://github.com/Curry-Leaves/curry-leaves-assistant-web/releases/tag/v1.3.2
[1.3.1]: https://github.com/Curry-Leaves/curry-leaves-assistant-web/releases/tag/v1.3.1
[1.3.0]: https://github.com/Curry-Leaves/curry-leaves-assistant-web/releases/tag/v1.3.0
[1.2.0]: https://github.com/Curry-Leaves/curry-leaves-assistant-web/releases/tag/v1.2.0
[1.1.0]: https://github.com/Curry-Leaves/curry-leaves-assistant-web/releases/tag/v1.1.0
[1.0.3]: https://github.com/Curry-Leaves/curry-leaves-assistant-web/releases/tag/v1.0.3
[1.0.2]: https://github.com/Curry-Leaves/curry-leaves-assistant-web/releases/tag/v1.0.2
[1.0.1]: https://github.com/Curry-Leaves/curry-leaves-assistant-web/releases/tag/v1.0.1
[1.0.0]: https://github.com/Curry-Leaves/curry-leaves-assistant-web/releases/tag/v1.0.0
