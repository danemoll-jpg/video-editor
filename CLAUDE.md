# Project Context & Rules

## Tech Stack
React/TypeScript, **Electron**, and FFmpeg for video/audio processing.
Electron chosen over Tauri because a coding agent (not a human) is writing
this code, and Electron's larger ecosystem/training-data presence makes it
more reliably buildable than Tauri's Rust backend — see TODO.md for full
reasoning. No external API integration with Grok/Suno/ElevenLabs — the app
stores and displays prompts for manual copy/paste into those services, and
imports the resulting files. **Exception, Phase 4:** direct Anthropic API
calls for the in-app AI Assistant (idea/plot/script/prompt help) — see
TODO.md's Completed Tasks. Called from the main process only; the API key
(entered in Settings, stored via `safeStorage`) must never reach the
renderer.

## Code Style & Architecture
- **Process split:** `electron/` is the main process (TypeScript, compiled to
  CommonJS via its own `electron/tsconfig.json` into `dist-electron/`).
  `src/` is the renderer (React + TypeScript, built with Vite into `dist/`).
  `electron/preload.ts` is the only bridge between them — it exposes a
  `window.api` object via `contextBridge`; `contextIsolation` is on and
  `nodeIntegration` is off, so the renderer never touches Node/fs directly.
- **Business logic lives in the main process.** `electron/projectManager.ts`
  (`ProjectManager` class) owns projects/assets filesystem access;
  `electron/productionManager.ts` (`ProductionManager` class) owns
  script/scenes/shots the same way; `electron/promptLabManager.ts`
  (`PromptLabManager` class) owns the Grok/Suno/ElevenLabs prompt-history
  subsystems (one manager, parameterized by `kind`, rather than tripling
  near-identical code — see its file header); `electron/sfxLibraryManager.ts`
  (`SfxLibraryManager` class) owns the SFX library, a different shape
  (tagged licensed assets, not prompt history) so it's a separate manager;
  `electron/mediaLibraryManager.ts` (`MediaLibraryManager` class) is a
  read-only Phase 5 aggregator with no JSON file of its own — it just
  cross-references the other four managers' data (which asset is linked
  from which shot/prompt-entry/rating/SFX-entry) into one searchable view,
  plus a plain listing of the `exports/` folder. All four storage managers
  share project-folder resolution and generic JSON read/write helpers from
  `electron/projectPaths.ts` and `electron/fsUtils.ts` rather than
  duplicating them. `electron/main.ts` just wires `ipcMain.handle`
  calls to whichever manager owns that data. The renderer only ever calls
  `window.api.*` methods (typed in `src/api.d.ts`, which mirrors the
  preload's shape) and renders what comes back — no fs/path logic in
  `src/`. The one deliberate exception: `electron/shotStatus.ts` (the fixed
  shot-status sequence and labels) and `electron/promptLabTypes.ts` (rating
  dimensions and lab labels) have no Node/Electron imports, so the renderer
  imports them directly instead of duplicating that data — see each file's
  header comment.
- **State management:** plain React `useState`/`useEffect` per component,
  no global store yet. `src/App.tsx` holds the one piece of cross-component
  state (which project is open) and passes it down. Reassess if/when a later
  phase needs shared state across more views.
- **Project files on disk** — see `ProjectManager`'s, `ProductionManager`'s,
  `PromptLabManager`'s, and `SfxLibraryManager`'s file header comments for
  the authoritative layout, but in short: each project is a folder under
  `<Documents>/Dan's Video Studio/Projects/<slug>-<shortId>/` holding
  `project.json` (metadata), `assets.json` (asset index),
  `assets/{video,image,audio,other}/` (actual files, stored under generated
  ids — never the original filename — so there's no manual versioning like
  `final_v2_FINAL.mp4`; the original name is preserved in `assets.json` for
  display only), `script/script.json`+`scenes.json`+`shots.json` (the
  Phase 2 script/scenes/shots data), and `promptlab/` (the Phase 3 Grok/
  Suno/ElevenLabs prompt histories + recipes, one JSON file pair per lab,
  plus `sfxLibrary.json` for the SFX library). `exports/` is still an empty
  placeholder, for Phase 6.
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

This is **Dan's Video Studio** — a personal desktop app covering the full
creative process (idea → script → scenes → shots → AI prompts → generated
assets → editing → export), not just a video editor. **Phase 1
(foundation)**, **Phase 2 (production planning — scripts, scenes, shots,
and per-shot status tracking)**, **Phase 3 (Prompt/Asset Lab — Grok Prompt
Lab, Suno Music Lab, SFX library, and ElevenLabs SFX prompt history)**, and
**Phase 4 (AI Assistant — idea/plot/script/prompt help, in-app via the
Anthropic API)** are all built and fully confirmed, including manual
click-through and a real successful API call by Dan with his own key — see
TODO.md's Completed Tasks. A SFX-library/ElevenLabs text-input bug found
during Phase 3 verification turned out to be intermittent, not a real
defect, and is deferred to the backlog (see TODO.md's Technical Notes)
rather than blocking anything. Current objective is **Phase 5 (Media
Management)** — a unified, searchable Media Library tab cross-referencing
every asset back to the shots/prompts/SFX entries that use it, with the
small AI Assistant UI fix (pin its toggle/panel to stay visible at the top
of the screen) folded into this phase's work rather than done separately.
Both pieces are now **built and verified by Claude** (typecheck/build, a
manager-level integration test, and a scripted Playwright click-through
against the real app — see TODO.md's Completed Tasks) but **not yet
confirmed by Dan's own hands**, so Phase 5 stays the current objective
until that happens, per this project's normal confirm-then-advance
pattern.
