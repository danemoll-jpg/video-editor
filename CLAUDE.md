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
- **Process split:** `electron/` is the main process (TypeScript, compiled to
  CommonJS via its own `electron/tsconfig.json` into `dist-electron/`).
  `src/` is the renderer (React + TypeScript, built with Vite into `dist/`).
  `electron/preload.ts` is the only bridge between them — it exposes a
  `window.api` object via `contextBridge`; `contextIsolation` is on and
  `nodeIntegration` is off, so the renderer never touches Node/fs directly.
- **Business logic lives in the main process.** `electron/projectManager.ts`
  (`ProjectManager` class) owns all filesystem access — creating/listing/
  deleting projects, importing/deleting assets. `electron/main.ts` just wires
  `ipcMain.handle` calls to it. The renderer only ever calls `window.api.*`
  methods (typed in `src/api.d.ts`, which mirrors the preload's shape) and
  renders what comes back — no fs/path logic in `src/`.
- **State management:** plain React `useState`/`useEffect` per component,
  no global store yet. `src/App.tsx` holds the one piece of cross-component
  state (which project is open) and passes it down. Reassess if/when a later
  phase needs shared state across more views.
- **Project files on disk** — see `ProjectManager`'s file header comment for
  the authoritative layout, but in short: each project is a folder under
  `<Documents>/Dan Video Studio/Projects/<slug>-<shortId>/` holding
  `project.json` (metadata), `assets.json` (asset index), and
  `assets/{video,image,audio,other}/` (actual files, stored under generated
  ids — never the original filename — so there's no manual versioning like
  `final_v2_FINAL.mp4`; the original name is preserved in `assets.json` for
  display only). `script/` and `exports/` are empty placeholders for later
  phases.
- **Styling:** one plain `src/styles.css` with CSS custom properties for the
  (currently dark-only) theme, plain class names — no CSS-in-JS or utility
  framework. Revisit if the UI grows past Phase 1's few screens.

## Commands
- `npm install` — install dependencies (first time; also re-approve native
  postinstall scripts if npm blocks them: `npm approve-scripts electron esbuild`).
- `npm run dev` — run renderer (Vite dev server) and Electron together with
  hot reload of the renderer.
- `npm run build` — build renderer (`dist/`) and main process (`dist-electron/`).
- `npm start` — build then launch the built app (production-like run).
- `npm run typecheck` — type-check both the renderer and main-process
  TypeScript projects without emitting.

## Where things stand
**Always check `TODO.md` for the current objective before starting work** —
this file should stay a short pointer back to TODO.md, not a duplicate.

This is **Dan Video Studio** — a personal desktop app covering the full
creative process (idea → script → scenes → shots → AI prompts → generated
assets → editing → export), not just a video editor. **Phase 1 (foundation)
is built**: project creation/management, an automatically-organized project
file structure, and basic asset import/storage — see TODO.md's Completed
Tasks for exactly what shipped and its verification status. Now at
**Phase 2 (production planning)** — see TODO.md's Current Objective.
