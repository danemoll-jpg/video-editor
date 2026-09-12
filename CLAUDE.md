# Project Context & Rules

## Tech Stack
React/TypeScript, **Electron**, and FFmpeg for video/audio processing.
Electron chosen over Tauri because a coding agent (not a human) is writing
this code, and Electron's larger ecosystem/training-data presence makes it
more reliably buildable than Tauri's Rust backend — see TODO.md for full
reasoning. No external API integration with Grok/Suno/ElevenLabs — the app
stores and displays prompts for manual copy/paste into those services, and
imports the resulting files.

## Code Style & Architecture
Not yet established — no code has been written. This is being built in
phases (see TODO.md's Next Steps for the full order: foundation → production
planning → prompt/asset lab → media management → video editor → export
tools → smarter assistance). Fill in real conventions here once Phase 1
code exists — module layout, state management approach, how project files
are structured on disk, etc.

## Commands
None yet.

## Where things stand
**Always check `TODO.md` for the current objective before starting work** —
this file should stay a short pointer back to TODO.md, not a duplicate.

Nothing has been built yet. This is **Dan Video Studio** — a personal
desktop app covering the full creative process (idea → script → scenes →
shots → AI prompts → generated assets → editing → export), not just a video
editor. Currently at **Phase 1 (foundation)**: projects, project files,
basic UI, asset storage. Tech stack is settled (React/TypeScript + Electron
+ FFmpeg) — nothing blocking Phase 1 from starting. See TODO.md for the full
phased roadmap and what's explicitly out of scope.
