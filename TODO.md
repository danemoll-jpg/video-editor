Active Development Plan

Completed Tasks

**Phase 1 — Dan's Video Studio foundation (2026-09-12).** Electron + React/
TypeScript app with:
- Project creation/management: create, list (sorted by last updated),
  open, delete (moves the project folder to the OS trash, not a permanent
  delete), and "open in file explorer" for the underlying folder.
- Automatically-organized project file structure: each project is a folder
  under `<Documents>/Dan's Video Studio/Projects/<slug>-<shortId>/` with
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
    titled "Dan's Video Studio" (verified via the OS process list) and the
    app auto-creates its `Dan's Video Studio/Projects` folder under the
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

**Desktop launcher (2026-09-12), on request.** A "Dan's Video Studio" shortcut
on the Desktop double-click-launches the app with no terminal window —
[launch.vbs](launch.vbs) runs `npm start` hidden (so it always rebuilds and
reflects the latest code) and the shortcut points at it via `wscript.exe`,
using Electron's icon. `launch.vbs` is committed; the Desktop `.lnk` itself
is machine-specific and isn't (recreate it if this repo is cloned to another
machine). Verified working on this machine: double-clicking the shortcut
opens the real "Dan's Video Studio" window with no stray console, and closes
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
  - **CONFIRMED on real device (2026-09-12), manual click-through by Dan:**
    the Script tab, Scenes & Shots tab (add/edit/reorder/delete scenes and
    shots, cascade delete), the status dropdown and advance button,
    "Copy Prompt," and the linked-asset picker were all clicked through in
    the live app and worked as expected. Closes the one item flagged as
    unverified when Phase 2 first shipped.
  - **Still not done / not verified:** no automated test suite was added
    (same as Phase 1 — the integration check above is a one-off script, not
    a committed test). No drag-to-reorder (scenes/shots use up/down buttons
    instead — not asked for, kept simple). No enforcement that a shot has a
    linked asset before it's marked Imported/Edited/Complete — linking is
    optional metadata, not a gate.

**Phase 3 — Prompt/Asset Lab (2026-09-12).** All four subsystems built
together in one round, as resolved below. New `electron/promptLabManager.ts`
(`PromptLabManager` class) owns the three prompt-history subsystems — Grok,
Suno, and ElevenLabs share one manager, parameterized by `kind`, rather than
tripling near-identical code, per CLAUDE.md's architecture. The SFX
*library* is a different shape (tagged assets, not prompt history) and gets
its own `electron/sfxLibraryManager.ts`. Both store their data in each
project's new `promptlab/` folder and reuse `projectPaths.ts`/`fsUtils.ts`
like every other manager; `fsUtils.writeJsonFile` now `mkdir`s its target
folder first so this works for projects created before Phase 3 existed, not
just new ones. Rating dimensions, lab labels, and the Suno-only lyrics field
live in `electron/promptLabTypes.ts` (no Node imports, same
renderer-safe-import pattern as `shotStatus.ts`). Renderer: a new "Prompt
Lab" tab in each project, with a sub-tab per subsystem
(`src/components/PromptLab.tsx`, `PromptLabPanel.tsx`, `SfxLibraryPanel.tsx`,
plus `PromptEntryCard.tsx`/`RecipeCard.tsx`/`VersionCompare.tsx`/
`StarRating.tsx`).

Reporting each subsystem separately, as asked:

1. **Grok Prompt Lab — built, nothing deferred.** Full prompt history
   (newest first), per-clip ratings across all five requested dimensions
   (character consistency, motion, camera behavior, prompt obedience,
   visual quality) on a 1-5 star scale, version comparison (entries link to
   a parent version; pick any two from the history list to see them
   side-by-side with average scores), and promotion of an entry's wording
   into a named, reusable recipe that can be reused as the starting point
   for a new entry.
2. **Suno Music Lab — built, nothing deferred.** Same pattern as Grok:
   prompt + lyrics + freeform settings history, per-clip ratings (melody,
   vocals & lyrics fit, production quality, prompt obedience, overall
   vibe), version comparison, reusable Music Recipes. The only structural
   difference from Grok is the extra lyrics field and its own rating
   dimensions — same manager, same UI components.
3. **SFX library — built, nothing deferred.** Tagged entries (name, tags,
   source URL, license, attribution text) that optionally link to an
   already-imported audio asset from Phase 1's asset system, rather than
   duplicating file storage — import the SFX file via the existing Assets
   tab, then add/link a library entry with its license and attribution
   here. Deliberately has no ratings/recipes (out of scope for a licensed
   asset library, not history to version).
4. **ElevenLabs SFX prompt history — built, nothing deferred**, including
   recipes: same history/ratings pattern as Grok and Suno (realism, timing/
   sync, audio quality, prompt obedience) plus promotion to reusable
   recipes. The original ask described recipes explicitly for Grok and
   Suno and only "same history/ratings pattern" for ElevenLabs; recipes
   were extended here too since the shared manager provides them for free
   and leaving ElevenLabs without them would be an arbitrary gap — flagged
   as a small scope addition beyond the literal request. **DECIDED: keep
   it** (confirmed with Dan, 2026-09-12).

  **Verification status (all four subsystems):**
  - Confirmed working on this machine: `npm run typecheck` and
    `npm run build` both succeed (renderer + main process).
  - Confirmed working on this machine, but via a scripted integration test
    rather than clicking through the UI: created a project, then for all
    three prompt labs — created an entry, added multiple per-clip ratings,
    confirmed out-of-range/unknown-dimension scores get clamped/dropped
    rather than corrupting data, created a second version linked to the
    first via `parentId`, promoted a version to a recipe, renamed the
    recipe, deleted a rating, deleted the original (parent) entry and
    confirmed the child's `parentId` cleared instead of cascading, and
    confirmed empty prompt text is rejected — then confirmed the three
    labs' histories and recipes stay isolated from each other. Separately
    for the SFX library: created two entries, confirmed name-sorted
    ordering, updated one, deleted it, and confirmed an empty name is
    rejected. Finally confirmed the project's `updatedAt` advanced from all
    of this. Same pattern as Phase 1/2's verification — exercises the real
    `PromptLabManager`/`SfxLibraryManager`/`ProjectManager` code the new UI
    calls, through the real Electron runtime.
  - Confirmed working on this machine: `npm start` launches a real window
    (verified via the OS process list), same as Phase 1/2.
  - **CONFIRMED (2026-09-12), UI-level click-through — but driven by Claude
    via automation, not Dan's own hands (see Current Objective's root-cause
    note for why: the bug report below didn't reproduce, so this session
    used a scripted Playwright driver against the real, built Electron
    window instead of asking Dan to redo the manual pass on the spot).**
    Built the app for real (`npm run build`) and drove the actual live
    window — clicking real buttons, typing via synthesized keyboard events,
    reading back the rendered DOM and screenshots, exactly what a human
    click-through exercises, as opposed to Phase 1-3's earlier
    manager-level scripted checks above. Covered, all in the live UI:
    creating a Grok entry, "New Version From This" to create a second,
    `parentId`-linked entry, selecting both via their checkboxes to open
    the Version Compare view (confirmed the two-column side-by-side view
    rendered with prompts and average ratings), rating a clip (clicked
    actual stars, confirmed 4/5 filled and the entry's average-rating
    star/number updated), Promote to Recipe → Show Recipes → Rename →
    "Use as New Entry" (confirmed the new-entry form came back pre-filled
    with the recipe's prompt text) — all on Grok, whose UI is identical to
    Suno/ElevenLabs (same `PromptLabPanel` component). Then, per-subsystem:
    Suno's Lyrics field is present and round-trips text correctly (Grok/
    ElevenLabs correctly have no Lyrics field); ElevenLabs' rating form
    shows exactly its four dimensions (Realism, Timing/Sync, Audio Quality,
    Prompt Obedience) and a 5-star rating saved correctly; SFX library:
    imported an audio asset via the Assets tab (mocked the native file
    picker to hand back a dummy `.wav` since Playwright can't drive an OS
    file dialog), created an SFX entry, linked it to that asset via the
    "Linked audio asset" dropdown, confirmed the entry card shows
    "🔊 test-sfx.wav", and confirmed its Edit form pre-fills correctly.
    **Not separately re-verified via this pass** (lower risk, no code
    changed there since Phase 2/3 shipped): Scenes & Shots and Script tabs.
  - **Still not done / not verified:** no automated test suite (same
    caveat as every phase so far). No drag-to-reorder or manual re-sorting
    of history (it's a chronological log, not a manually-ordered list, by
    design). Version comparison is exactly two entries side-by-side, not an
    n-way or textual diff. No enforcement that a rated clip's linked asset
    actually exists/matches — same "optional metadata, not a gate"
    philosophy as Phase 2's shot linking.

Current Objective (Focus Area)

**Investigated the SFX/ElevenLabs typing bug (2026-09-12) — could not
reproduce it in the current code.** This needs Dan to look again before
it's closed out; recorded here so the next session doesn't re-litigate the
same ground.

What was done, not just asserted: built the app for real (`npm run
build`), then drove the actual live Electron window — not the manager
functions, the real rendered UI — with a scripted Playwright `_electron`
driver (`playwright-core`, installed with `--no-save`, not a project
dependency), clicking real buttons and sending real synthesized keyboard
events. Checked, across both the production build (`npm start`'s path)
and the dev build (`npm run dev`'s path, Vite + React StrictMode):
  - Typing into every field of both the SFX "+ Add SFX" form and the
    ElevenLabs "+ New Prompt" form (Name/Tags/Source URL/License/
    Attribution/Notes for SFX; Prompt/Settings/Notes/Tags for ElevenLabs),
    both with and without an explicit focus step, both scrolled-into-view
    and not.
  - The stronger check, because reading an `<input>`'s raw DOM `.value`
    after typing can look fine even when a form's React state is broken
    (an uncontrolled DOM node happily displays whatever was typed even if
    `onChange` never ran — the tell is that a controlled input like these
    then snaps back empty on the next re-render): typed a name/prompt,
    confirmed the Save button's `disabled` state actually lifted (it's
    driven by `!form.name.trim()`/`!form.promptText.trim()`, i.e. React
    state, not the DOM), clicked Save, and confirmed the saved entry
    — read back from the re-rendered list after the round-trip through
    the IPC call and disk — showed the exact typed text.
  - Console/page errors during all of the above: none.

Every one of those passed, for both forms, in both builds. Root cause,
therefore: **not identified, because the bug did not reproduce.** The
code as committed (`SfxLibraryPanel.tsx`, `PromptLabPanel.tsx` — the same
component Grok/Suno/ElevenLabs all share) wires every field's `value`/
`onChange` to the matching state key correctly; no stray `disabled`/
`readOnly`, no CSS blocking pointer events, no global keydown handler, no
polling/effect that resets form state unexpectedly. This directly
contradicts TODO's prior note that ElevenLabs uses "a different sub-tab
component than Grok/Suno" — it doesn't; it's the same `PromptLabPanel`
parameterized by `kind`, which is exactly why a bug isolated to
ElevenLabs-but-not-Grok/Suno is hard to explain from the code as it
stands. That hypothesis was wrong; flagging it so nobody chases it again.

**Before treating this as fixed, ask Dan for a tighter repro**: which
exact field, does the Save/Add button also stay disabled (vs. the text
itself just not appearing), what window size, any non-US keyboard layout
or IME active, and whether it still happens on a fresh `npm start`. Until
then this stays open rather than closed on a guess.

Separately, the rest of the "manually verify Phase 3 in the live app"
pass (the part that wasn't blocked on the bug above) **was completed this
session** — see Phase 3's verification status above for exactly what was
clicked through (version comparison, ratings, recipe promotion/rename/
reuse, SFX-to-asset linking, Suno's lyrics field, ElevenLabs' rating
dimensions) and the caveat that it was Claude driving the UI, not Dan.
Phase 4 (Media Management, below) becomes current once Dan confirms either
that the typing bug isn't reproducible for him either, or gives a repro
this session can act on.

Background & Key Decisions

**RESOLVED — built all four Phase 3 subsystems together** (2026-09-12),
rather than splitting into sub-phases, per the prior decision below.

DECIDED: adopted the full "Dan's Video Studio" roadmap (see project summary,
originally scoped in a ChatGPT conversation) as the plan of record, in the
phased order given there. This **supersedes** the earlier, narrower
"Prompt/Continuity Tracker" plan as a standalone first build — that work
isn't lost, it's folded into Phase 3 (Grok Prompt Lab) below, expanded with
ratings, versioning, and reusable prompt "recipes."

**What Dan's Video Studio is:** a personal desktop application covering the
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

Full phased roadmap, in order — Phase 3 above just shipped (pending manual
verification, see Current Objective) and Phase 4 is next; each phase below
stays deferred until the prior one is functional:

1. **Phase 4 — Media Management.** Unified searchable library across video
   clips, images, music, SFX, generated assets, and exports, tied back to
   the projects/scenes/shots where each was used.
2. **Phase 5 — Video Editor.** The actual editing layer: multiple
   video/audio tracks, trimming/splitting, rearranging clips,
   overlays/text/titles, fades/dissolves, volume control, green
   screen/chroma key, cropping/scaling/positioning, speed adjustment, basic
   transitions, MP4 export. Deliberately not a CapCut feature clone — scoped
   to what this workflow actually needs. Acknowledged as the largest,
   highest-effort phase.
3. **Phase 6 — Export Tools.** MP4, GIF, still-frame, and clip exports as
   first-class features (GIF maker: select part of a clip/timeline → choose
   dimensions/FPS/quality/looping — not buried in a submenu).
4. **Phase 7 — Smarter Assistance.** Use the accumulated Grok/Suno/SFX
   prompt history to recommend techniques based on what's actually worked
   before, rather than generating cold suggestions each time. Considered the
   most distinctive long-term feature of the whole project.

**DECIDED: explicitly out of scope, indefinitely** (not "later," genuinely
declined) — cloud service, mobile app, social/collaboration features, a
CapCut-style template marketplace, hundreds of filters, built-in
Grok/Suno generation via API, and any "gigantic AI suite" scope expansion.

Technical Notes / Blockers

- **Leftover test project folders from this session's UI verification
  (2026-09-12).** The Playwright-driven click-through above created several
  real projects under `Documents/Dan's Video Studio/Projects/` (named
  `verification-pass-*`, `field-test-*`, `console-test-*`, `dev-mode-test-*`,
  `input-bug-test-*`, `submit-test-*`) to have something to click through.
  This session's sandbox permissions blocked cleaning them up (deleting
  outside the repo was refused), so they're still sitting there — harmless
  test data, safe to delete via the app's own "Delete Project" (trash) or
  directly, whenever it's convenient.
- **Correction, now actually applied (2026-09-12).** This file previously
  claimed the app was renamed "Dan Video Studio" → "Dan's Video Studio,"
  including the on-disk folder path, and verified via a live window title —
  but that rename had only ever been made to this file's prose, not the
  source (found while starting Phase 3, flagged, left unfixed pending a
  decision). On request, it's now actually applied: `electron/main.ts`'s
  window title, `electron/projectPaths.ts`'s `<Documents>/...` folder name,
  `index.html`'s `<title>`, `src/App.tsx`'s header,
  `src/components/ProjectList.tsx`'s empty-state copy, `package.json`'s
  description, and `launch.vbs`'s comment all say "Dan's Video Studio" now.
  Checked the real (OneDrive-redirected) `Documents/Dan Video Studio/`
  folder first — it held only an empty `Projects/` subfolder, no actual
  project data, so no migration was needed; left that old empty folder in
  place rather than deleting it (harmless, and deleting things nobody asked
  to delete isn't free). **Confirmed on this machine:** `npm run
  typecheck`/`npm run build` pass; the Phase 3 integration script (see
  above) re-run cleanly against the new path, creating its test project
  under `Documents/Dan's Video Studio/Projects/`; `npm start` launches a
  real window titled "Dan's Video Studio" (verified via
  `Get-Process`/`MainWindowTitle`, same check as Phase 1's launcher
  verification).
- `electron/fsUtils.ts`'s `writeJsonFile` now `mkdir`s its target folder
  (recursive, idempotent) before writing, added for Phase 3 so
  `promptLabManager.ts`/`sfxLibraryManager.ts` can write into a project's
  `promptlab/` folder whether or not that folder already existed — no
  behavior change for existing callers, since their folders were already
  created at project-creation time.
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
