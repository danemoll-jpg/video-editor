Active Development Plan

Completed Tasks

**Phase 1 — Dan Video Studio foundation (2026-09-12).** Electron + React/
TypeScript app with:
- Project creation/management: create, list (sorted by last updated),
  open, delete (moves the project folder to the OS trash, not a permanent
  delete), and "open in file explorer" for the underlying folder.
- Automatically-organized project file structure: each project is a folder
  under `<Documents>/Dan Video Studio/Projects/<slug>-<shortId>/` with
  `project.json` (metadata), `assets.json` (asset index), `assets/
  {video,image,audio,other}/`, and empty `script/`/`exports/` placeholders
  for later phases. Imported files are stored under a generated id-based
  filename, never the original name, so manual versioned filenames
  (`final_v2_FINAL...`) are impossible by construction; the original name
  is kept in `assets.json` for display.
- Basic asset storage: native "Import Assets" file picker, automatic
  categorization by extension into video/image/audio/other, grouped display
  per project, per-asset delete (also trashes rather than permanently
  deletes).
- See [CLAUDE.md](CLAUDE.md)'s Code Style & Architecture section for the
  process split (main vs. renderer) and Commands section for how to run it.

  **Verification status:**
  - Confirmed working on this machine: `npm install`, `npm run typecheck`,
    and `npm run build` all succeed; `npm start` launches a real window
    titled "Dan Video Studio" (verified via the OS process list) and the
    app auto-creates its `Dan Video Studio/Projects` folder under the
    actual (OneDrive-redirected) Documents path on first run.
  - Confirmed working on this machine, but via a scripted integration test
    rather than clicking through the UI: create project → import a video
    file and an image file → files land on disk under the correct
    `assets/<kind>/` folder with generated names → delete one asset →
    delete the project (trashed) → project list count returns to zero.
    This exercises the exact same `ProjectManager` code the UI buttons
    call, run through the real Electron runtime.
  - **CONFIRMED on real device (2026-09-12), manual click-through by Dan:**
    created a project, imported files (video and image), deleted an asset,
    and deleted a project (trash) — all via the actual live UI, not the
    scripted integration test above. This closes the one item flagged as
    unverified when Phase 1 first shipped.
  - **Still not done / not verified:** no automated test suite
    (Vitest/Playwright etc.) was set up — the integration check above was a
    one-off script, not a committed test. No packaging/installer
    (electron-builder or similar) — out of scope for Phase 1, a personal
    dev-run app; revisit if Phase 6 (export tools) or actual distribution
    needs it. No window-state persistence, app icon, or CI.

**Desktop launcher (2026-09-12), on request.** A "Dan Video Studio" shortcut
on the Desktop double-click-launches the app with no terminal window —
[launch.vbs](launch.vbs) runs `npm start` hidden (so it always rebuilds and
reflects the latest code) and the shortcut points at it via `wscript.exe`,
using Electron's icon. `launch.vbs` is committed; the Desktop `.lnk` itself
is machine-specific and isn't (recreate it if this repo is cloned to another
machine). Verified working on this machine: double-clicking the shortcut
opens the real "Dan Video Studio" window with no stray console, and closes
cleanly.

**Phase 2 — Production planning (2026-09-12).** Scripts, scenes, and shots,
built on top of the Phase 1 project foundation, with per-shot status
tracking through Planned → Prompt Ready → Generated → Imported → Edited →
Complete. All of Phase 2's scope shipped — nothing deferred out of it.
- **Script:** one freeform text/markdown script per project, stored as
  `script/script.json`; a "Script" tab with a textarea, explicit Save
  (Ctrl/Cmd+S also saves), and a "last saved" timestamp.
- **Scenes:** ordered list per project (`script/scenes.json`) — add, rename/
  edit description, reorder (move up/down), delete (cascades to delete the
  scene's own shots). Collapsible cards in the "Scenes & Shots" tab.
- **Shots:** ordered list per scene (`script/shots.json`) — add, edit title/
  description, reorder within their scene, delete. Each shot carries an AI
  prompt text field with a "Copy Prompt" button (per CLAUDE.md's "Copy
  Prompt" plan — no Grok/Suno/ElevenLabs API calls), a status dropdown plus
  a one-click "advance to next status" button, and an optional link to one
  of the project's already-imported assets.
- Architecture: new `electron/productionManager.ts` (`ProductionManager`
  class) owns all script/scene/shot filesystem access, mirroring how
  `ProjectManager` owns projects/assets — `electron/main.ts` just wires
  `ipcMain.handle` calls to it, same as before. Extracted the project-
  folder-resolution and generic JSON read/write helpers both managers share
  into new `electron/projectPaths.ts` and `electron/fsUtils.ts` (pure
  refactor of Phase 1 code, no behavior change). Shot status's type/fixed
  sequence/labels live in `electron/shotStatus.ts`, which has zero Node
  imports so it's safe for the renderer to import directly (documented in
  that file and in `src/api.d.ts`) instead of duplicating the sequence.
  Renderer stays UI-only, calling `window.api.*` exactly like Phase 1's
  asset code.

  **Verification status:**
  - Confirmed working on this machine: `npm run typecheck` and
    `npm run build` both succeed (renderer + main process).
  - Confirmed working on this machine, but via a scripted integration test
    rather than clicking through the UI: create project → save a script →
    create two scenes → reorder them → create three shots across both
    scenes → drive a shot through the full Planned→Complete status
    sequence → reject an invalid status → set/clear a shot's linked asset →
    reorder shots within a scene → delete a shot (sibling order
    renormalizes) → delete a scene (cascades to delete its remaining shot,
    no orphans) → confirm the project's `updatedAt` advanced from all of
    this. This exercises the exact same `ProductionManager`/`ProjectManager`
    code the new UI calls, run through the real Electron runtime — same
    pattern as Phase 1's verification.
  - Confirmed working on this machine: `npm start` launches a real window
    (verified via the OS process list), same as Phase 1.
  - **Not yet done: manual click-through of the Phase 2 UI in the live
    app.** Unlike the scripted check above, nobody has actually clicked the
    new Script tab, Scenes & Shots tab, add/edit/reorder/delete buttons, the
    status dropdown/advance button, "Copy Prompt", or the linked-asset
    picker in the running app yet — only the underlying main-process logic
    has been exercised. Needs the same kind of pass Phase 1 got (see its
    entry above) before Phase 2 is considered fully done.
  - **Still not done / not verified:** no automated test suite was added
    (same as Phase 1 — the integration check above is a one-off script, not
    a committed test). No drag-to-reorder (scenes/shots use up/down buttons
    instead — not asked for, kept simple). No enforcement that a shot has a
    linked asset before it's marked Imported/Edited/Complete — linking is
    optional metadata, not a gate.

Current Objective (Focus Area)

**Manually verify Phase 2 in the live app.** Click through the Script and
Scenes & Shots tabs end-to-end (see the "not yet done" item directly above)
and confirm nothing was missed that the scripted check couldn't catch —
same closing step Phase 1 got. Once that's confirmed, Phase 3 (Prompt/Asset
Lab, below) becomes current.

Background & Key Decisions

DECIDED: adopted the full "Dan Video Studio" roadmap (see project summary,
originally scoped in a ChatGPT conversation) as the plan of record, in the
phased order given there. This **supersedes** the earlier, narrower
"Prompt/Continuity Tracker" plan as a standalone first build — that work
isn't lost, it's folded into Phase 3 (Grok Prompt Lab) below, expanded with
ratings, versioning, and reusable prompt "recipes."

**What Dan Video Studio is:** a personal desktop application covering the
whole creative process — Idea → Script → Scenes → Shots → AI Prompts →
Generated Assets → Editing → Final Video/GIF — not just a final-cut editor.
Grok, Suno, free SFX sources, and ElevenLabs stay external; the app
organizes, tracks, assembles, edits, and exports around them. No API
integration with those services initially — the app stores/generates
prompts with "Copy Prompt" buttons, and you import the resulting files
manually.

**RESOLVED — Tauri vs. Electron: Electron.** Reasoning: this is being built
by a coding agent rather than hand-written, and Electron's ecosystem is far
larger and better-represented in AI training data, so an agent will write
and debug it more reliably than Tauri's Rust backend. Tauri's main
advantages (smaller app size, lower memory) matter for apps distributed to
many users, not a personal app running on one machine, so they don't
outweigh that. FFmpeg integration is unaffected by this choice either way —
both frameworks just shell out to FFmpeg as an external tool.

**Confirmed:** this is a real local desktop app (React/TypeScript +
Electron + FFmpeg), not a browser-based tool — it needs to be built via
Claude Code working directly in the `video-editor` repo, not through
Claude.ai chat.

Next Steps (Do Not Start Yet)

Full phased roadmap, in order — Phase 2 above just shipped (pending manual
verification, see Current Objective) and Phase 3 is next; each phase after
that stays deferred until the prior one is functional:

1. **Phase 3 — Prompt/Asset Lab.** Grok Prompt Lab (full prompt history,
   per-clip ratings across character consistency/motion/camera
   behavior/prompt obedience/visual quality, version comparison, and
   promotion of successful wording into reusable "recipes" — this is where
   the original Prompt/Continuity Tracker plan lives now, expanded); Suno
   Music Lab (same pattern — prompt/lyrics/settings history, ratings,
   version comparison, reusable Music Recipes); SFX library (tagged, licensed
   free-source assets with attribution tracking); ElevenLabs SFX prompt
   history (same history/ratings pattern as Grok and Suno).
2. **Phase 4 — Media Management.** Unified searchable library across video
   clips, images, music, SFX, generated assets, and exports, tied back to
   the projects/scenes/shots where each was used.
3. **Phase 5 — Video Editor.** The actual editing layer: multiple
   video/audio tracks, trimming/splitting, rearranging clips,
   overlays/text/titles, fades/dissolves, volume control, green
   screen/chroma key, cropping/scaling/positioning, speed adjustment, basic
   transitions, MP4 export. Deliberately not a CapCut feature clone — scoped
   to what this workflow actually needs. Acknowledged as the largest,
   highest-effort phase.
4. **Phase 6 — Export Tools.** MP4, GIF, still-frame, and clip exports as
   first-class features (GIF maker: select part of a clip/timeline → choose
   dimensions/FPS/quality/looping — not buried in a submenu).
5. **Phase 7 — Smarter Assistance.** Use the accumulated Grok/Suno/SFX
   prompt history to recommend techniques based on what's actually worked
   before, rather than generating cold suggestions each time. Considered the
   most distinctive long-term feature of the whole project.

**DECIDED: explicitly out of scope, indefinitely** (not "later," genuinely
declined) — cloud service, mobile app, social/collaboration features, a
CapCut-style template marketplace, hundreds of filters, built-in
Grok/Suno generation via API, and any "gigantic AI suite" scope expansion.

Technical Notes / Blockers

- Repo location: `C:\Users\danmo\video-editor`
- Tech stack: React/TypeScript + Electron + FFmpeg for video processing.
- Because this is a real desktop app needing a local dev environment, build
  work should happen via Claude Code directly in the repo, not via
  Claude.ai chat exporting/importing files — that manual round-trip was the
  original source of friction this setup is meant to avoid.
- Cost expectation set at the planning stage: an early, rough version is
  realistically tens-to-hundreds of dollars in AI/tool usage; a polished
  version could run into the hundreds or thousands, but there's no need to
  commit to that upfront — build incrementally, phase by phase.
- See companion `collaboration-process-notes.md` for general working habits
  (numbered multi-item batches, explicit per-item status, resolve open
  questions rather than letting them drift, distinguish deferred vs.
  decided-against, etc.) — apply those here as this project moves forward.
