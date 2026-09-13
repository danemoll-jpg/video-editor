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

**Phase 4 — AI Assistant (2026-09-12).** All of Phase 4's described scope was
built — nothing deferred out of it. Added the `@anthropic-ai/sdk` npm
dependency (main process only); everything else follows the existing
architecture exactly.
- **Idea tab:** new per-project freeform text notes for premise/plot
  brainstorming, mirroring the Script tab's pattern exactly (textarea,
  explicit Save, "last saved" timestamp) — gives brainstorming a home
  before script writing starts. Lives in `idea/idea.json`, via two new
  `getIdea`/`saveIdea` methods on the existing `ProductionManager` (same
  trivial shape as `Script`, not a new manager — see that file's updated
  header comment) rather than `script/`, since it isn't part of the script
  itself. Renderer: `src/components/IdeaEditor.tsx`.
- **Settings screen:** new app-level (not per-project) screen, reached via
  an "⚙ Settings" button in the header (`src/components/Settings.tsx`,
  `src/App.tsx`). Holds a single Anthropic API key field — write-only from
  the renderer's perspective (`hasApiKey()` reports only whether one is
  set, never the key itself). New `electron/settingsManager.ts`
  (`SettingsManager` class) stores it under Electron's `app.getPath
  ('userData')/settings/anthropicKey.enc`, encrypted via `safeStorage`
  (OS-level encryption at rest) — not JSON, so this manager talks to `fs`
  directly rather than reusing `fsUtils.ts`'s JSON helpers (documented in
  its header). The decrypted key is only ever read by
  `aiAssistantManager.ts` inside the main process, per CLAUDE.md's "must
  never reach the renderer" rule.
- **AI Assistant chat panel** (`src/components/AiAssistantPanel.tsx`), one
  reusable component embedded in: the new Idea tab, the existing Script
  tab, and each Prompt Lab sub-tab (Grok/Suno/ElevenLabs — deliberately
  *not* the SFX library sub-tab, which isn't a prompt-writing context).
  Starts collapsed (a toggle labeled with its context, e.g. "🤖 Script
  Assistant") and loads its history lazily on first expand. Every assistant
  reply has an "Insert" button: Idea/Script append it to that tab's
  textarea; a Prompt Lab sub-tab sets/opens its "+ New Prompt" composer's
  prompt field with it, per CLAUDE.md's "drop the response into that tab's
  field" spec.
- New `electron/aiAssistantManager.ts` (`AiAssistantManager` class) owns
  the actual Anthropic API calls and conversation history, mirroring the
  other managers' shape: `requireProjectDir`/`touchProject` from
  `projectPaths.ts`, `readJsonFile`/`writeJsonFile` from `fsUtils.ts`.
  History is saved per project, per context (`idea`, `script`, `grok`,
  `suno`, `elevenlabs`) under each project's new `aiAssistant/` folder, one
  JSON file per context — consistent with the app's existing pattern of
  keeping history (Prompt Lab entries, SFX attribution) rather than losing
  it. Calls `claude-opus-5` with a per-context system prompt describing its
  role (idea brainstorming / script writing / Grok video-prompt writing /
  Suno music-prompt writing / ElevenLabs SFX-prompt writing); a failed call
  (no key configured, bad key, network error) throws a specific message and
  writes nothing to the conversation file, rather than saving a question
  with no answer.
- **Explicitly not in this phase, per its own scope:** no automatic
  pulling-in of other project context into any chat — a Prompt Lab
  assistant is never fed the script, and vice versa; only what the user
  actually types in that panel is sent to Anthropic. Smarter, history-aware
  assistance is Phase 8's job (below), which this phase's API plumbing sets
  up for.

  **Verification status:**
  - Confirmed working on this machine: `npm run typecheck` and
    `npm run build` both succeed (renderer + main process); the compiled
    `dist-electron/main.js` requires every new file cleanly.
  - Confirmed working on this machine: `npm start` launches a real window
    titled "Dan's Video Studio" (verified via the OS process list), same as
    every prior phase.
  - Confirmed working on this machine, via a scripted integration test run
    through the real Electron runtime (same pattern as every prior phase):
    `SettingsManager`'s `safeStorage` round-trip (set/has/get/clear a key),
    `ProductionManager`'s new `getIdea`/`saveIdea` (empty → saved → persists
    to disk), `AiAssistantManager.sendMessage` with no key configured
    (throws the expected error, writes nothing), and — genuinely hitting
    the real Anthropic API over the network with a deliberately invalid key
    — confirmed the auth failure is caught and surfaced as a clear message
    rather than a crash, at zero cost (an auth rejection isn't billed).
  - Confirmed working on this machine, via a scripted Playwright
    click-through against the real, built Electron window (same technique
    as Phase 3's UI verification, run by Claude rather than Dan's own
    hands, for the same reason as Phase 3's had): created a project;
    entered and saved Idea notes; expanded the Idea tab's AI Assistant
    panel and confirmed its empty state; sent a message with no API key
    configured and confirmed the exact error banner appears in the live
    UI; opened Settings, saved a (fake) key, confirmed the status flips to
    "configured," removed it, confirmed it flips back; confirmed the
    AI Assistant toggle is present on the Script tab and on the Grok, Suno,
    and ElevenLabs sub-tabs, and confirmed it is absent on the SFX Library
    sub-tab; seeded a fake assistant reply directly into a project's
    `aiAssistant/elevenlabs.json` on disk (to avoid a real paid API call)
    and confirmed clicking its "Insert" button correctly opened the
    ElevenLabs "+ New Prompt" form with that text in the prompt field.
  - **Not yet confirmed: an actual successful Anthropic API call (a real
    question, a real Claude reply) with a real key.** That's the one thing
    this session deliberately didn't exercise itself, since it costs real
    money on Dan's own key and wasn't going to spend it without him present
    — the error-path plumbing (no key / bad key) is confirmed for real
    end-to-end, but the full happy path (type a question, see a real reply,
    click Insert on a real reply) still needs Dan's own manual pass with
    his key entered in Settings. **Phase 4 stays the current objective**
    until that happens, per this project's normal confirm-then-advance
    pattern (see how Phases 1-3 were each marked complete only after Dan's
    own click-through) — Phase 5 below does not start yet.
  - **Still not done / not verified:** no automated test suite (same
    caveat as every phase so far). No way to clear/delete AI Assistant
    conversation history from the UI once started (not asked for; history
    just accumulates, same philosophy as Prompt Lab's history). No
    streaming of the assistant's reply (the chat waits for the full
    response) — fine for the short, focused replies this phase's prompts
    ask for; revisit if replies start running long enough to feel slow.

**Phase 5 — Media Management (2026-09-12), built** *(the AI Assistant pin
fix folded in alongside it, per Dan's call — see Current Objective below)*.
- **Media Library tab:** a new per-project tab, unified and searchable
  across every imported asset (video/image/audio/other), cross-referencing
  each one back to where it's actually used — a linked shot (Scenes &
  Shots), a linked Grok/Suno/ElevenLabs prompt entry or per-clip rating
  (Prompt Lab), or a linked SFX library entry (tags/license folded
  straight into the asset's card). A search box matches name, SFX tags/
  license, or any usage's label/detail (so "Scene 1" or a prompt's wording
  finds the right asset); a kind filter (All/Video/Image/Audio/Other) and
  an "Unused only" checkbox narrow the grid further — useful for spotting
  imported files nothing actually references yet. Also lists whatever's
  sitting in the project's `exports/` folder (empty until Phase 6/7 build
  actual export tools, but part of the same "everything this project has
  produced" picture).
- **Scope call:** the original ask named "generated assets" as its own
  category alongside video/images/music/SFX/exports. The existing data
  model has no separate "this was AI-generated" flag on an asset — an
  asset is just an asset, and what makes something "generated" is that a
  Grok/Suno/ElevenLabs prompt entry or rating links to it. Rather than add
  a new field nobody asked for, "generated" is represented by *how* an
  asset is used (a `promptEntry`/`promptRating` usage on its card) instead
  of a stored label — flagged here as a deliberate scope call, not an
  oversight.
- Architecture: new `electron/mediaLibraryManager.ts` (`MediaLibraryManager`
  class) is a read-only aggregator, not a new storage subsystem — it holds
  no JSON file of its own. It cross-references `ProjectManager`'s
  assets.json against `ProductionManager`'s shots.json, all three
  `PromptLabManager` kinds' prompt/rating history, and
  `SfxLibraryManager`'s sfxLibrary.json (all via each manager's existing
  public methods, constructor-injected), plus a plain `fs.readdir` of the
  project's `exports/` folder. `electron/main.ts` wires two new
  `ipcMain.handle` calls (`media:getLibrary`, `media:listExports`) to it,
  same pattern as every other manager. Renderer: `src/components/
  MediaLibrary.tsx` (search/filter/toolbar + the Exports section) and
  `MediaLibraryCard.tsx` (one asset's card), added as a new "Media Library"
  tab in `ProjectView.tsx`. To unlink an asset from something, you still go
  to the tab that owns that link (the shot, the prompt entry/rating, or
  the SFX entry) — this view is deliberately read-only cross-referencing,
  not a second place to edit those links.
- **AI Assistant pin fix, folded in:** `AiAssistantPanel` is now rendered
  as the very first element in the Idea tab, the Script tab, and each
  Prompt Lab sub-tab (`IdeaEditor.tsx`, `ScriptEditor.tsx`,
  `PromptLabPanel.tsx`), and its wrapper (`.ai-assistant` in
  `src/styles.css`) is now `position: sticky; top: 0` with a solid
  background and a z-index above the scrolling content — so it stays
  visible at the top of the screen while the rest of a long tab (a long
  script, a long prompt history) scrolls underneath it, rather than
  requiring a scroll down to find it. Unchanged: it's still absent from
  the SFX Library sub-tab, per Phase 4's original "not a prompt-writing
  context" call.

  **Verification status:**
  - Confirmed working on this machine: `npm run typecheck` and
    `npm run build` both succeed (renderer + main process).
  - Confirmed working on this machine, via a scripted integration test run
    through the real Electron runtime (same pattern as every prior phase):
    created a project, imported a video/audio/image asset, linked the
    video asset to a shot, to a new Grok prompt entry, and to that entry's
    clip rating, linked the audio asset to a new SFX library entry — then
    confirmed `MediaLibraryManager.getLibrary()` correctly reports all
    three usage types on the video asset, folds the SFX entry's tags/
    license into the audio asset, and reports the untouched image asset as
    having zero usages; confirmed `listExports()` reports empty for a
    fresh project and correctly picks up a file once one exists. Cleaned
    up (trashed) the test project afterward.
  - Confirmed working on this machine: `npm start` launches a real window
    titled "Dan's Video Studio" (verified via `Get-Process`/
    `MainWindowTitle`), same as every prior phase.
  - **CONFIRMED (2026-09-12), UI-level click-through — but driven by
    Claude via a scripted Playwright pass against the real, built Electron
    window, not Dan's own hands** (same technique and same reason as
    Phase 3/4's UI verification): created a project via the actual UI;
    imported three real files, mocking only the native OS file-picker
    dialog (Playwright can't drive that); added a scene and shot and
    linked the shot to the video asset via its dropdown; created a Grok
    prompt entry and rated a clip linked to the video asset; added an SFX
    library entry linked to the audio asset. Opened the new Media Library
    tab and confirmed: the video asset's card shows both its shot usage
    and its Grok rating usage; the audio asset's card shows its SFX usage
    plus the linked entry's tags and license; the untouched image asset
    shows "Not used anywhere yet"; the Exports section renders (empty).
    Confirmed the search box, the kind filter, and the "Unused only"
    checkbox each correctly narrow the grid to just the matching asset(s).
    Separately, on the Script tab: expanded the AI Assistant, filled the
    textarea with enough filler text to force scrolling, scrolled the
    tab's content, and confirmed via screenshot and a bounding-box check
    that the AI Assistant panel stayed pinned near the top of the screen
    instead of scrolling away with the text underneath it. The Idea tab
    and the Grok/Suno/ElevenLabs sub-tabs use the exact same
    `AiAssistantPanel` component and `.ai-assistant` CSS class, so this
    covers them by construction rather than being separately re-tested one
    by one. All test project folders this pass created were cleaned up
    afterward — confirmed none left behind this time (a prior phase's
    cleanup was blocked by sandbox permissions; this one wasn't).
  - **Not yet confirmed: Dan's own manual click-through in the live app.**
    Matching this project's established pattern (Phases 1-4 each stayed
    the current objective until Dan's own hands-on pass, not just
    Claude's scripted/automated ones), **Phase 5 stays the current
    objective** until Dan has clicked through the Media Library tab
    himself and confirmed the AI Assistant now stays pinned while
    scrolling, in his own usage — Phase 6 below does not start yet.
  - **Still not done / not verified:** no automated test suite (same
    caveat as every phase). No thumbnail/preview generation for video/
    image assets in the Media Library — out of scope for this phase
    (cross-referencing and search, not a media preview player); revisit
    if wanted later, likely alongside Phase 6's editor. The Exports
    section will stay empty until Phase 6/7 actually write files into
    `exports/` — this phase only added the listing, not export capability
    itself.

Current Objective (Focus Area)

**Phase 3 is now considered complete.** The SFX/ElevenLabs typing bug
(investigated above) turned out to be intermittent, not a real defect —
confirmed by Dan that it now works fine even via the exact repro steps that
previously failed. **DEFERRED to the backlog, not fixed and not decided
against** — see Technical Notes below for what to look at if it resurfaces
with a clearer pattern. Not worth spending more time on right now.

**Phase 4 — AI Assistant is now fully confirmed.** Dan tested the happy
path himself with his own Anthropic key entered in Settings: prompts
worked well. This closes the one item that was keeping Phase 4 open (see
Completed Tasks above for everything confirmed before this).

**Phase 5 — Media Management, built (2026-09-12), now pending
confirmation** *(originally Phase 4)*. The Media Library tab (unified,
searchable, cross-referenced back to the shots/prompts/SFX entries that
use each asset) and the folded-in AI Assistant pin fix are both built,
dev-tested, and UI-tested via Claude's own scripted Playwright pass — see
the Phase 5 entry under Completed Tasks above for the full write-up and
verification detail. **Still the current objective**, same as every prior
phase's pattern: it needs Dan's own click-through in the live app before
it's marked fully confirmed. Phase 6 below stays deferred until then.

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

Full phased roadmap, in order — Phase 5 (Media Management, above, now
current, with the AI Assistant UI fix folded in) is underway; each phase
below stays deferred until the prior one is functional:

1. **Phase 6 — Video Editor** *(originally Phase 5).* The actual editing
   layer: multiple video/audio tracks, trimming/splitting, rearranging
   clips, overlays/text/titles, fades/dissolves, volume control, green
   screen/chroma key, cropping/scaling/positioning, speed adjustment, basic
   transitions, MP4 export. Deliberately not a CapCut feature clone — scoped
   to what this workflow actually needs. Acknowledged as the largest,
   highest-effort phase.
2. **Phase 7 — Export Tools** *(originally Phase 6).* MP4, GIF,
   still-frame, and clip exports as first-class features (GIF maker: select
   part of a clip/timeline → choose dimensions/FPS/quality/looping — not
   buried in a submenu).
3. **Phase 8 — Smarter Assistance** *(originally Phase 7).* Use the
   accumulated Grok/Suno/SFX prompt history to recommend techniques based on
   what's actually worked before, rather than generating cold suggestions
   each time. Considered the most distinctive long-term feature of the
   whole project — and now directly builds on Phase 4's AI Assistant/API
   plumbing rather than needing its own from scratch.

**DECIDED: explicitly out of scope, indefinitely** (not "later," genuinely
declined) — cloud service, mobile app, social/collaboration features, a
CapCut-style template marketplace, hundreds of filters, built-in
Grok/Suno generation via API, and any "gigantic AI suite" scope expansion.

Technical Notes / Blockers

- **DEFERRED (backlog, not fixed, not decided against): intermittent
  SFX/ElevenLabs first-open typing bug.** Seen twice by Dan — text wouldn't
  enter a field the first time opening the "Add SFX" (or ElevenLabs "New
  Prompt") form right after launching the app; closing and reopening the
  form fixed it both times, without restarting the app. A full
  investigation (real Playwright-driven UI testing, not just checking the
  underlying manager code) could not reproduce it and found nothing wrong
  in `SfxLibraryPanel.tsx`/`PromptLabPanel.tsx` — correct `value`/`onChange`
  wiring, no stray `disabled`/`readOnly`, no blocking CSS, no state-reset
  effect. Confirmed to be genuinely intermittent, not a permanent defect —
  Dan confirmed it now works fine via the same repro steps that previously
  failed. **If it resurfaces:** the pattern (first-open-only, fixed by
  reopening, no restart needed) suggests a first-mount initialization race
  rather than broken input wiring — check anything that runs once on
  initial mount (an empty-dependency-array `useEffect`, a ref not yet
  attached, an autofocus call racing the DOM). Not worth chasing further
  without a more consistent repro.

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
