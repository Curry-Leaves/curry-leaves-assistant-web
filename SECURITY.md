# Security Policy

## Supported versions

This is the React web UI for Curry Leaves. It ships as a static bundle that the
Python backend ([`curry-leaves-assistant`](https://github.com/Curry-Leaves/curry-leaves-assistant))
serves as-is. Security fixes are made against the latest published version on
[npm](https://www.npmjs.com/package/curry-leaves-assistant-web); older versions
are not patched.

| Version | Supported |
|---|---|
| Latest release | ✅ |
| Older releases | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report suspected vulnerabilities privately by one of:

- **GitHub Security Advisories** — use the
  ["Report a vulnerability"](https://github.com/Curry-Leaves/curry-leaves-assistant-web/security/advisories/new)
  button on this repository (preferred).
- **Email** — **curry_leaves_ai@yahoo.com**. Please include "SECURITY" in the
  subject line.

When reporting, please include:

- A description of the vulnerability and its impact.
- Steps to reproduce, or a proof of concept.
- The affected version and, if relevant, browser/OS.

## What to expect

- We aim to acknowledge your report within **7 days**.
- We will keep you informed as we investigate and work on a fix.
- Once a fix is released, we will credit you in the advisory unless you prefer to
  remain anonymous.

## Scope

This repository contains **frontend code only** — it talks to the backend over
HTTP/WebSocket at its origin. Vulnerabilities in backend behavior (API routes,
agents, transcription, storage, authentication) should be reported against the
[`curry-leaves-assistant`](https://github.com/Curry-Leaves/curry-leaves-assistant)
repository instead.
