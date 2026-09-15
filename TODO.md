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
- **Scope call, confirmed (2026-09-12):** the original ask named "generated assets" as its own
  category alongside video/images/music/SFX/exports. The existing data
  model has no separate "this was AI-generated" flag on an asset — an
  asset is just an asset, and what makes something "generated" is that a
  Grok/Suno/ElevenLabs prompt entry or rating links to it. Rather than add
  a new field nobody asked for, "generated" is represented by *how* an
  asset is used (a `promptEntry`/`promptRating` usage on its card) instead
  of a stored label. **DECIDED: keep it this way** — Dan doesn't have a
  strong preference either way, so no separate flag is being added.
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

**Phase 5 continued — the three gaps Dan's click-through surfaced (2026-09-12),
built.** Reporting each of the three separately, as asked — none rolled up
into one "done" statement:

1. **Asset-linking on Grok/Suno prompt entries — built, nothing deferred.**
   The data model (`PromptEntry.linkedAssetId`) and the manager/IPC layer
   already supported this from Phase 3; the gap was entirely in the UI, which
   never exposed a control for it. Fixed once in the shared
   `PromptLabPanel.tsx`/`PromptEntryCard.tsx` (used identically by both Grok
   and Suno, per the shared-component architecture), so it's one fix
   covering both labs, not two: the "+ New Prompt" form gained a "Linked
   asset" dropdown, and each entry's expanded/edit view now shows and can
   change its linked asset the same way a shot's linked asset already
   worked. (ElevenLabs isn't a separate prompt-lab kind anymore as of item 2
   below, but its entries get this for free too, being part of the same
   unified SFX system now.)
2. **SFX library + ElevenLabs merged into one unified SFX system — built,
   nothing deferred, including the data migration.** New shape in
   `electron/sfxLibraryManager.ts` (still that file/class — this is an
   evolution of the existing SFX-library manager, not a new subsystem):
   every `SfxEntry` has a `source` (`licensed` or `elevenlabs`) and,
   regardless of source, the same generic "Prompt / search term" field
   (`promptText` — labeled generically in the UI, not as an AI-only
   concept), version history (`parentId` chain + "New Version From This"),
   per-clip ratings (the old ElevenLabs Lab's four dimensions — realism,
   timing/sync, audio quality, prompt obedience — now scoreable on a
   free/licensed download too), and recipe-promotion. License/attribution/
   source-URL fields stay meaningful mainly for `licensed` entries and the
   generation-settings field mainly for `elevenlabs` ones, shown
   conditionally in the form/card but present on every entry rather than a
   split shape. New `electron/sfxTypes.ts` (source labels + rating
   dimensions, zero Node imports, same renderer-safe pattern as
   `promptLabTypes.ts`). Renderer: old `SfxLibraryPanel.tsx` replaced by
   `SfxPanel.tsx` (+ new `SfxEntryCard.tsx`), reusing `RecipeCard.tsx` and
   `VersionCompare.tsx` (both generalized to a structural shape so Grok/Suno
   and the unified SFX system share them rather than duplicating). The old
   "ElevenLabs SFX Lab" sub-tab under Prompt Lab is gone; Prompt Lab's
   sub-tabs are now Grok / Suno / SFX. `PromptLabKind` narrowed to
   `'grok' | 'suno'` — ElevenLabs is a `source` value in the SFX system now,
   not a prompt-lab kind (its own AI Assistant context, `'elevenlabs'`,
   stays independent of that type so the SFX panel keeps its assistant).
   **Data migration**, run automatically the first time a project's SFX data
   is touched after this change (`SfxLibraryManager.ensureMigrated`): reads
   the old `promptlab/sfxLibrary.json` and `elevenlabsPrompts.json`/
   `elevenlabsRecipes.json` if present, converts each into the unified
   shape (licensed entries keep their name/tags/license/attribution/linked
   asset; ElevenLabs entries keep their prompt text/settings/notes/tags/
   ratings/version chain), and writes the result to the new
   `sfxEntries.json`/`sfxRecipes.json` — nothing is reset or discarded, and
   the old files are left in place afterward (unread from then on) rather
   than deleted. Ordering changed from the old library's alphabetical-by-
   name to newest-first, matching every other prompt-lab list, since the
   merge makes this a versioned history now rather than a flat tagged list.
3. **Shots link multiple SFX; scenes link multiple songs — built, nothing
   deferred, neither capped at one.** `Shot` gained `linkedSfxIds: string[]`
   (ids into the unified SFX system) as a field separate from its existing
   `linkedAssetId`, which stays exactly as it was — the shot's one primary
   generated-clip link. `Scene` gained `linkedSongAssetIds: string[]` (ids
   into the project's audio assets) — scenes previously had no asset-linking
   at all. Both are plain checkbox lists in `ShotCard.tsx`/`SceneCard.tsx`
   (new `.checkbox-list` styling), toggling membership in the array via the
   existing `updateShot`/`updateScene` IPC calls (widened to accept the new
   fields). Reading a scene/shot written before this change defaults the
   new field to `[]` (`normalizeScene`/`normalizeShot` in
   `productionManager.ts`) rather than throwing on the missing key.
   `MediaLibraryManager` was extended to cross-reference both new link types
   too (a `sceneSong` usage on the linked song asset, a `shotSfx` usage on
   the asset behind a shot-linked SFX entry) — otherwise Phase 5's Media
   Library would have grown a second "can't see where this is used" gap,
   which was the whole complaint that opened this round.

  **Verification status (all three items):**
  - Confirmed working on this machine: `npm run typecheck` and
    `npm run build` both succeed (renderer + main process).
  - Confirmed working on this machine, via a scripted integration test run
    through the real Electron runtime (same pattern as every prior phase):
    created a project; seeded legacy `sfxLibrary.json`/`elevenlabsPrompts.json`/
    `elevenlabsRecipes.json` files by hand to simulate a pre-merge project,
    then confirmed the migration produces exactly the expected two unified
    entries with every field mapped correctly (source, license, prompt
    text, the migrated rating, the migrated recipe) and doesn't re-run or
    duplicate on a second read; created new licensed and ElevenLabs-sourced
    SFX entries and confirmed ratings, recipe-promotion, and version
    history (parentId chain, including parentId clearing on delete) all
    work on a licensed entry, not just an ElevenLabs one; created a scene
    and shot and confirmed both can link two songs/two SFX respectively (not
    capped at one) while the shot's separate primary-clip link kept working
    independently; hand-wrote a legacy scene/shot missing the new fields
    and confirmed reading them back defaults to `[]` instead of throwing;
    confirmed `MediaLibraryManager.getLibrary()` surfaces both new usage
    types correctly. Also exercised the Grok prompt-entry asset-linking
    manager calls (create/update/clear a `linkedAssetId`) directly. Cleaned
    up (trashed) the test project afterward.
  - **CONFIRMED (2026-09-12), UI-level click-through — but driven by Claude
    via a scripted Playwright pass against the real, built Electron window,
    not Dan's own hands** (same technique and same reason as every prior
    phase's UI verification): created a project via the actual UI, imported
    a video asset, a song audio asset, and an SFX audio asset (mocking only
    the native file-picker dialog). On Prompt Lab → Grok: opened "+ New
    Prompt," confirmed the new "Linked asset" dropdown is present, linked
    the new entry to the video asset, and confirmed the saved entry's
    expanded view shows that linked asset. On the new SFX tab: confirmed
    the tab's copy reflects the unified system; created a licensed entry
    (name, "Prompt / search term," license, linked audio asset) and a
    separate ElevenLabs-sourced entry in the same list, confirmed the
    ElevenLabs entry shows its source label; rated a clip and promoted a
    recipe on the *licensed* entry specifically, confirming ratings/recipes
    aren't ElevenLabs-only. On Scenes & Shots: added a scene, checked a
    "Linked songs" checkbox (confirmed it lands on `checked` once the
    async round-trip settles — an SFX-panel-style controlled checkbox has a
    brief window where a bare Playwright `.check()` assertion samples it
    mid-round-trip and misreads that as a bug; re-verified with an explicit
    settle delay, which is what a human clicking it would experience as a
    normal, instant-feeling toggle); added a shot, checked a "Linked SFX"
    checkbox for it the same way, and confirmed its separate "Linked asset"
    (primary clip) dropdown still works independently. Opened Media Library
    and confirmed the linked song asset shows a "Scene 1" usage and the
    linked SFX's underlying audio asset shows a "Shot 1" usage. All 20
    assertions in this pass succeeded; the four throwaway test project
    folders it created were cleaned up (moved to the Recycle Bin)
    afterward.
  - **Not yet confirmed: Dan's own manual click-through in the live app.**
    Same pattern as every prior phase and as Phase 5's first round above:
    **Phase 5 stays the current objective** until Dan has clicked through
    all three of these himself — Phase 6 does not start yet.
  - **Still not done / not verified:** no automated test suite (same
    caveat as every phase). The unified SFX system's rating dimensions
    weren't reconsidered for whether they all make sense on a plain
    downloaded sound (e.g. "prompt obedience" reads oddly for something
    that wasn't generated from a prompt) — kept as-is since nothing asked
    for different dimensions per source, and splitting them would be a
    bigger, un-asked-for change; revisit if it bothers Dan in practice.

**Phase 6 — Video Editor (2026-09-13), built.** The actual editing layer,
built on top of a new `editor/timeline.json` per project. All items in the
phase's original scope were built — reporting each piece separately, as this
project's habit is, rather than one rolled-up "done":

1. **Timeline data model & engine (main process) — built, nothing deferred.**
   New `electron/editorManager.ts` (`EditorManager` class) owns the Phase 6
   data the same way every other manager owns its slice: multiple video/
   audio/overlay tracks (each type keeps its own contiguous `order`), clips
   with a timeline position/duration, source trim (`inPoint`/`outPoint`,
   pre-speed source seconds — a media clip's on-timeline `duration` is
   always *derived* from `(outPoint-inPoint)/speed`, not independently
   settable, so it can never drift out of sync with the trim/speed that
   produced it), speed, volume, fade in/out, a crop rect (source pixels,
   applied before scale/position), a position/scale `transform`, an optional
   chroma key, and a `transitionOut` describing how a clip blends into
   whatever immediately follows it on the same track. A clip is either
   `kind: 'media'` (pointing at a project asset) or `kind: 'text'` (a title/
   overlay with no source file). Adding a media clip probes the real file
   via a new `electron/mediaProbe.ts` (FFprobe) for its actual duration/
   native width/height, and a new clip's `transform` defaults to an aspect-
   ratio-preserving "contain" fit into the project canvas rather than a
   distorting stretch. New `electron/editorTypes.ts` (zero Node imports,
   same renderer-safe-import pattern as `shotStatus.ts`) holds the shared
   shape plus the fixed transition-type list/labels and font list.
2. **Media playback for the renderer — built, nothing deferred.** The
   renderer previously never played any media at all (every earlier phase
   only ever showed metadata about an asset). New `electron/mediaProtocol.ts`
   registers a privileged, CORS-enabled `media://` protocol (via
   `protocol.handle`, forwarding the request's `Range` header into
   `net.fetch` against the real file so `<video>`/`<audio>` seeking works)
   so the preview can safely draw video frames onto a `<canvas>` without the
   canvas being "tainted" the way a plain `file://` source risks.
3. **Timeline editing UI — built, nothing deferred.** New `src/components/
   Timeline.tsx`: tracks grouped by type (Video/Audio/Overlay), a time
   ruler with a click-to-seek playhead, add/rename/mute/hide/delete per
   track, and clips as draggable/trimmable blocks — drag a clip's body to
   move it in time (and onto another track of the same type), drag its left/
   right edge to trim (shows a live preview while dragging, persists once on
   mouse-up rather than on every pixel of movement). A "Split at Playhead"
   button on the selected clip (`splitClip`) cuts it into two, correctly
   carrying over trim math and moving the original `transitionOut` onto the
   new tail half (the head half resets to no transition, since a transition
   describes a clip's tail).
4. **Preview player — built, with one documented simplification.** New
   `src/components/PreviewPlayer.tsx`: a single `<canvas>` compositor that
   draws every visible frame — video tracks bottom-to-top by order, then
   overlay/text tracks on top of all of them — applying each clip's crop/
   scale/position, opacity fade envelope, and (best-effort) chroma key via
   per-pixel canvas processing, plus text rendering for title clips. Actual
   playback (Play/Pause, scrubbing, per-clip volume with fades, track mute)
   works against pooled `<video>`/`<audio>`/`<img>` elements fed by the new
   `media://` protocol. **Documented simplification:** the preview shows a
   transition as a hard cut to the later clip rather than an actual
   crossfade/wipe — real blending only happens in the authoritative FFmpeg
   export (item 6). Chroma-key pixel processing is wrapped in a try/catch
   for the (browser-dependent) case where the canvas is considered tainted;
   if so, that one clip just previews unkeyed while still exporting keyed
   correctly.
5. **Clip Inspector (properties panel) — built, nothing deferred.** New
   `src/components/ClipInspector.tsx`: trim in/out, speed, volume, "include
   this clip's audio," fade in/out, crop, position/scale, chroma key
   (enable/color/similarity/blend), the transition into the next clip
   (type + duration), and — for title clips — content/font/size/color/
   align/background box. Every field writes back through the same
   `updateClip` call the drag interactions use.
6. **Basic transitions — built, nothing deferred, from the curated set
   asked for.** Cross Dissolve, Fade to Black, Wipe Left, Wipe Right, and
   Dissolve — implemented by detecting adjacent same-track clips where the
   next clip's start overlaps the previous one's tail by exactly the
   transition's duration, and folding them together with FFmpeg's `xfade`
   (video) / `acrossfade` (audio) before placing the combined unit on the
   timeline — chains of 3+ transitioned clips fold left-to-right
   automatically.
7. **MP4 export — built, nothing deferred.** New `electron/
   videoExportManager.ts` builds one real FFmpeg `filter_complex` from the
   whole timeline (every visual clip becomes its own full-canvas RGBA layer
   with crop/scale/position/chroma-key/fade baked in, time-shifted and
   layered via `overlay` with `enable='between(t,start,end)'`; every audio-
   bearing clip similarly trimmed/speed-adjusted (`atempo`, chained for
   ratios outside FFmpeg's 0.5–2.0 single-stage range)/volumed/faded, delayed
   to its position, and mixed via `amix`) and runs it via the bundled
   FFmpeg binary (new `ffmpeg-static`/`ffprobe-static` dependencies —
   Dan needs no system FFmpeg install), reporting live progress back to the
   renderer over an IPC event parsed from FFmpeg's `-progress pipe:1`
   output. Writes into the project's `exports/` folder — which Phase 5's
   Media Library already lists generically, so the exported file shows up
   there with no extra work. New `src/components/ExportDialog.tsx` for the
   filename/progress/result UI, reached via an "⬇ Export MP4" button.
   Title/overlay text renders via FFmpeg's `drawtext` filter using
   fontconfig family names (the bundled FFmpeg build has fontconfig
   compiled in), not embedded font files.
- **Explicitly not implemented this round (present in the data model for
  forward-compatibility, but not wired up):** clip `rotation` — the
  `Transform` type has always carried it, but no UI exposes it and the
  export/preview both hard-code it to 0. Not asked for by name in the
  original scope list ("cropping/scaling/positioning") and adding it
  correctly (canvas size changes under rotation, needs its own crop/pad
  math) was a meaningfully bigger, separate piece of work — flagged rather
  than silently dropped.
- **Out of scope for this phase, per the roadmap:** GIF/still-frame export
  (that's Phase 7 — Export Tools, per TODO.md's Next Steps).

  **Verification status:**
  - Confirmed working on this machine: `npm run typecheck` and
    `npm run build` both succeed (renderer + main process).
  - Confirmed working on this machine: `npm start` launches a real window
    titled "Dan's Video Studio," same as every prior phase.
  - Confirmed working on this machine, via a scripted integration test run
    through the real Electron runtime (same pattern as every prior phase,
    exercising the exact `EditorManager`/`VideoExportManager` code the UI
    calls): built a real timeline — two video tracks (one plain, one with a
    1.5×-speed chroma-keyed clip and an explicit `transform`), an overlay
    track (an image logo clip plus a title text clip), an audio track (a
    song clip with volume/fades), and a Cross Dissolve transition between
    two clips on the main video track — then split a clip and confirmed the
    resulting two clips' trim math was exactly correct, confirmed a
    `media://` URL is produced for playback, and ran a real export. FFprobe
    on the resulting file confirmed: a real playable MP4 at the project's
    exact configured resolution (1920×1080) with both a video and an audio
    stream, at the exact expected total duration. This is the same class of
    check as every prior phase's manager-level verification, but additionally
    confirms FFmpeg itself accepts the generated filter graph and produces
    correct real output, not just that the TypeScript compiles.
  - **CONFIRMED (2026-09-13), UI-level click-through — driven by Claude via
    a scripted Playwright pass against the real, built Electron window, not
    Dan's own hands (same technique and same reason as every prior phase's
    UI verification):** created a project via the actual UI; seeded a video
    asset directly on disk with a hand-written `assets.json` entry (the same
    "mock the native file picker" workaround used since Phase 3, since
    Playwright can't drive an OS file dialog). Opened the new "Editor" tab;
    added a second video track and an overlay track via their toolbar
    buttons; added the seeded clip to Video 1 via the add-clip bar; clicked
    the clip and confirmed the Clip Inspector opened with all expected
    sections including Chroma Key; enabled chroma key and set volume to 0.5,
    then did a full page reload and reopened the project — both changes were
    still there, confirming real persistence, not just local UI state. Added
    a title text clip on the overlay track. Clicked "Export MP4," ran a real
    export from the UI's Export dialog, and confirmed the resulting file
    actually exists on disk at the path the dialog reported. Separately,
    drag interactions specifically: **moving** a clip by dragging its body
    was confirmed working end-to-end (position change visible immediately,
    and persisted correctly after a reload) using real OS-level simulated
    mouse input. **Trimming** a clip by dragging its edge handle could not
    be got to register via that same OS-level simulated mouse input in this
    session's setup — an 8px-wide target apparently fell outside where the
    externally-attached Playwright session's coordinate mapping landed,
    while the much wider clip body (used for moving) was forgiving enough
    to absorb the same offset; dispatching the equivalent real DOM mouse
    events directly (bypassing OS-level input simulation) confirmed the
    trim itself is correctly wired end-to-end (duration went from 5s to
    exactly the expected 3.75s and persisted to disk) — so this reads as a
    quirk of this session's test harness rather than an app defect, but it
    means the drag-to-trim *gesture* specifically wasn't confirmed via the
    most realistic simulated-mouse technique, unlike drag-to-move. Worth
    Dan double-checking his own trim-by-dragging feel during his pass. All
    test project folders this pass created were cleaned up afterward.
  - **Not yet confirmed: Dan's own manual click-through in the live app.**
    Same pattern as every prior phase: **Phase 6 stays the current
    objective** until Dan has clicked through the Editor tab himself —
    building a small real timeline, trimming/splitting/rearranging clips,
    adding a title, trying chroma key on a real green-screen clip if he has
    one, and exporting a real MP4 — Phase 7 does not start yet.
  - **Still not done / not verified:** no automated test suite (same
    caveat as every phase). No keyboard shortcuts, no snapping/magnetism
    between clips while dragging, no multi-select, no undo/redo — all
    reasonable follow-ups if the plain-mouse-drag/one-at-a-time editing
    feels limiting in practice, none asked for by name. No waveform preview
    on audio clips or thumbnail frames on video clips in the timeline (clips
    render as plain labeled color blocks) — a nice-to-have, not asked for.
    Rotation is unimplemented, per the note above. The preview's transition
    hard-cut and best-effort chroma key are documented simplifications, per
    item 4 above, not defects — the export is the authoritative renderer for
    both. No packaging/installer changes were needed for the bundled FFmpeg
    binaries since the app still isn't packaged (same as every prior
    phase's note on this).

**Phase 6 continued — the nine remaining scope items (2026-09-13), built.**
Reporting each separately, as this project's habit is — none rolled up into
one "done" statement. (The tenth item, a text-overlay flow fix, stayed
withdrawn — see Current Objective below, no code change there.)

1. **Extract audio from an imported video asset into a new standalone audio
   asset — built, nothing deferred.** A new "🎵 Extract Audio" button on
   each video asset's card in the Assets tab runs FFmpeg's `-vn` (via a new,
   single-purpose `electron/audioExtractor.ts`, re-encoding to AAC so the
   output plays correctly regardless of the source's original audio codec)
   and adds the result to `assets/audio/` and `assets.json` exactly like any
   imported file — `ProjectManager.extractAudioAsset`, wired through a new
   `assets:extractAudio` IPC call. From there it's usable anywhere an audio
   asset can be: linked to a shot, a scene's songs, an SFX entry, or dragged
   onto an editor audio track. Rejects cleanly (no partial file left behind)
   if the source isn't a video or has no audio track. Deliberately only
   added to the Assets tab, not also duplicated into the Media Library —
   that view is deliberately read-only cross-referencing per Phase 5's
   design, and Assets already has per-asset actions (Delete) as its natural
   home for a new one.
2. **Extract a timeline clip's audio onto its own independent audio-track
   clip — built, nothing deferred.** A new "🎵 Extract Audio to Track"
   context-menu action (see item 8) on any media clip — `EditorManager.
   extractClipAudio` — creates a new clip on an audio track (reusing an
   existing audio track with a free time slot, or adding a new one) at the
   same `startTime`, carrying over the source clip's current `inPoint`/
   `outPoint`/`speed`/`volume` so the two start in sync, then turns the
   source clip's `includeAudio` off so the sound isn't doubled. Notably
   needed **no new audio file on disk** — unlike item 1, the export's audio
   chain already reads directly from whichever asset a clip points to
   regardless of what kind of track it's sitting on, so the new clip just
   references the same video asset directly.
3. **BUG — chroma key breaks on export — investigated, one real gap closed,
   but Dan's exact original repro could not be reproduced this round.**
   Actually diagnosed rather than guessed: built a battery of real-pipeline
   tests (not just FFprobe stream checks) — two stacked video tracks, a
   letterboxed/pillarboxed non-16:9 source with real pad borders, an overlay
   track, 1.5× speed with fades, a Cross Dissolve transition between two
   keyed clips, and realistic noisy/compressed footage with a moving
   subject — each run through the real `VideoExportManager`/bundled FFmpeg
   binary end-to-end, then actually decoding real frames back out and
   reading pixel values (not just confirming the filter graph compiles),
   which is exactly the rigor last round's verification skipped. Every one
   of those scenarios composited correctly on this machine's exact bundled
   FFmpeg build (6.1.1-essentials, gyan.dev) — none reproduced Dan's
   reported opaque-black symptom. That said, the original diagnosis's core
   suspicion — the FFmpeg `overlay` filter's default output format
   (`format=yuv420`) is not alpha-carrying, so relying on its *default*
   behavior for alpha correctness is implementation/version-defined rather
   than guaranteed — is real and worth closing regardless of whether it was
   provably *this* bug: `videoExportManager.ts`'s per-clip compositing loop
   now explicitly passes `overlay=format=auto` and re-asserts
   `format=yuva420p` after every overlay stage, so the running composite
   stays alpha-safe end-to-end rather than depending on a specific FFmpeg
   build's internal defaults. Also fixed in passing (a real, separate gap
   found by code inspection, not a guess): `chromaKey.similarity`/`blend`
   had zero validation anywhere — a value outside FFmpeg's accepted 1e-5..1
   /0..1 ranges would fail the whole export; both the Clip Inspector's
   fields (min/max) and `EditorManager.updateClip` (server-side clamp, the
   layer that actually matters) now guard against that. **This is
   deliberately not marked fully resolved** — see Technical Notes below for
   what Dan should capture if it resurfaces, since a synthetic repro
   couldn't reproduce it and his real footage/project is the one thing this
   round didn't have access to.
5. **Library relocation in Settings, with a real data migration — built,
   nothing deferred.** New Settings → "Library Location" section shows the
   current path and a "Move Library…" button; picking a folder moves
   *every* existing project's real files there (`fs.rename`, falling back
   to a recursive copy-then-delete-the-original when the destination is on
   a different drive and a plain rename can't work) — new `electron/
   libraryLocation.ts` (the small preference file recording the chosen
   location, under Electron's userData folder) and `electron/
   libraryRelocationManager.ts` (the actual move). `projectPaths.ts`'s
   `projectsRoot()` is now async and reads that preference, so every
   existing manager picks up the new location transparently with no other
   code changes needed.
6. **Export destination choice — built, nothing deferred.** The Export
   dialog now has a "Save to" choice: the project's own `exports/` folder
   (default — keeps showing up in Media Library) or "Choose a different
   folder" (a real OS folder picker via a new `editor:chooseExportDestination`
   IPC call), disabling the Export button until a folder is actually picked
   in that mode. `VideoExportManager.exportMp4` takes an optional
   `destinationDir` and writes there instead of the project's `exports/`
   when given one.
7. **Direct-manipulation editing on the Preview Player — built, nothing
   deferred, addition not replacement.** A plain absolutely-positioned DOM
   box now overlays the selected clip's on-canvas position/size on top of
   the `<canvas>` (in `PreviewPlayer.tsx`) whenever that clip is the active
   one at the current playhead: dragging the box's body moves the clip
   (`transform.x/y`); dragging one of its four corner handles adjusts
   `crop` instead — the on-screen box stays put and the handle changes
   *which part of the source* fills it (a crop-tool model), rather than
   also resizing the box itself. The Clip Inspector's numeric X/Y/Crop
   fields still work exactly as before on the same underlying data — this
   is a mouse-driven addition, not a new source of truth. **Caught and
   fixed during this round's own UI testing** (not by Dan): the corner
   handles were initially unclickable because `.preview-player`'s
   `overflow: hidden` clipped them right where they sit, at the box's
   edges — removed that rule (harmless; the canvas already fits exactly via
   its own sizing rules, nothing needed clipping) once real Playwright
   mouse-drag testing against the actual handles caught it, rather than
   shipping it the way item 3 shipped broken last round.
8. **Right-click context menu on a clip — built, nothing deferred.**
   Right-clicking any clip on the timeline opens a small menu — Split at
   Playhead (disabled when the playhead isn't inside the clip, same rule as
   the Inspector's Split button), Duplicate (new `EditorManager.
   duplicateClip`, placing the copy immediately after the original on the
   same track with its own transition reset to none), Extract Audio to
   Track (media clips only — item 2), and Delete.
9. **Reverse and mirror clip properties — built, nothing deferred, both
   preview and export support.** Two new per-clip boolean fields
   (`Clip.reverse`/`Clip.mirror`, media clips only) with checkboxes in the
   Clip Inspector. Export: `reverse` inserts FFmpeg's `reverse`/`areverse`
   right after the clip's own trim (which is exactly why trim happens
   first — buffering a shorter, already-trimmed clip rather than the whole
   source); `mirror` inserts `hflip` after scaling. Preview: `mirror` is a
   real, correct live preview (a canvas transform flip within the clip's
   own box); `reverse` has **no live preview equivalent** and is a
   documented simplification, same spirit as this file's existing
   transition/chroma-key preview simplifications — there's no way to play
   an HTML5 `<video>` backwards smoothly (negative `playbackRate` isn't
   supported by browsers), so a reversed clip still previews forward while
   exporting correctly reversed.
10. **Playhead drag-precision improvements — built, using the recommended
    default.** The timeline already had zoom controls (a px/second slider)
    from Phase 6's original ship; new this round: the ruler now supports
    drag-to-scrub (not just click-to-seek), and a small floating tooltip
    with the exact time follows the cursor while dragging the playhead *or*
    a clip's trim handle, disappearing the instant the drag ends — so
    landing on an exact time no longer depends on pixel-perfect mouse
    accuracy at whatever zoom level happens to be active.

  **Verification status (all nine items):**
  - Confirmed working on this machine: `npm run typecheck` and
    `npm run build` both succeed (renderer + main process); `npm start`
    launches a real window without error, same as every prior phase.
  - Confirmed working on this machine, via a scripted integration test run
    through the real Electron runtime (same pattern as every prior phase),
    covering items 1, 2, 5, 6, 8, and 9 end-to-end against the real
    `ProjectManager`/`EditorManager`/`VideoExportManager`/
    `LibraryRelocationManager` code and the real bundled FFmpeg binary — 23
    assertions, all passing: extracting a video asset's audio produced a
    real audio-only file (FFprobe-confirmed no video stream); extracting a
    timeline clip's audio correctly created a synced audio-track clip,
    turned off the source clip's own audio, and the resulting export still
    had a real audio stream; a custom export destination correctly wrote
    the file there instead of the project's `exports/` folder;
    `duplicateClip` placed a correct copy; **reverse and mirror were
    verified with actual decoded pixel data**, not just that the export
    succeeded — an asymmetric red-then-green test clip exported reversed
    showed green early and red late (confirming genuine frame-order
    reversal, not a no-op), and an asymmetric red/blue split-screen clip
    exported mirrored showed blue on the left and red on the right; library
    relocation was tested against a fully synthetic fake "old library"
    built entirely under a scratch folder (never touching the real
    Documents-based library) — confirmed the migrated file lands at the
    new location, the old location is genuinely gone (a real move, not a
    copy left behind), a second relocate-to-the-same-place is a safe no-op,
    and the real preference is always restored to the default afterward
    (wrapped in try/finally) regardless of outcome. **A real near-miss
    during this pass, worth recording:** an earlier draft of this same test
    ran `relocateLibrary` directly against the real default location to set
    up its fixture, which — combined with this machine's OneDrive-redirected
    Documents folder holding a locked file — triggered the copy-then-delete
    fallback path and threw partway through deleting the original, before
    the test's own cleanup could run. The real library folder was found
    fully intact afterward (a `rename`, not a delete, is tried first, and
    Node's `fs.rm` here never got past the one locked leftover test folder
    from a *previous* session), but the test was still rewritten to build
    an entirely synthetic fixture under the scratchpad instead, precisely
    so a test of a destructive-by-design feature can never again touch
    real user data even in a failure path — noted here rather than quietly
    fixed and forgotten, since it's exactly the kind of thing this file's
    "distinguish deferred vs. decided-against" habit exists to surface.
  - **CONFIRMED (2026-09-13), UI-level click-through — driven by Claude via
    a real Playwright session controlling the actual built Electron window
    (`playwright`'s `_electron` launcher, same class of technique as every
    prior phase's UI verification, not Dan's own hands):** created a
    project via the real UI; seeded a video asset with a real audio track
    directly on disk (mocking only the native file-picker dialog, same
    long-standing technique). On the Assets tab: confirmed the new Extract
    Audio button appears on the video asset's card, clicked it, and
    confirmed a real new audio asset appeared. On the Editor tab: added the
    seeded clip; checked Reverse and Mirror in the Inspector, reloaded the
    whole app, reopened the project, and confirmed both were still checked
    (real persistence); dragged the new preview overlay box on the
    `<canvas>` and confirmed the Inspector's X field changed to match;
    enabled Crop and dragged its bottom-right handle, confirming Crop W
    changed (this is the exact interaction that caught the `overflow:
    hidden` clipping bug above — it failed the first time this was run,
    confirmed fixed on the second); dragged the ruler and confirmed the
    live time tooltip appears mid-drag and disappears on release;
    right-clicked a clip and confirmed the context menu shows all four
    actions, that Duplicate actually added a clip, and that Extract Audio
    to Track added a real clip on an audio track while switching the
    original clip's "include audio" off. On the Export dialog: confirmed
    the destination choice renders and that Export is correctly disabled
    until a custom folder is chosen (didn't click "Browse…" itself, since
    that opens a real OS dialog Playwright can't drive — the underlying
    `exportMp4(destinationDir)` behavior is what the scripted test above
    covers instead). On Settings: confirmed the new Library Location
    section shows the current (default) path and a Move Library button
    (didn't click it, same OS-dialog reason — the actual migration logic is
    what the scripted test covers). 24 of 24 assertions passed. The test
    project this pass created was cleaned up afterward; confirmed no
    leftover folders from this session remain in the real library.
  - **Not yet confirmed: Dan's own manual click-through in the live app** —
    same pattern as every prior phase and as Phase 6's original round:
    Phase 6 stays the current objective until Dan has clicked through all
    nine of these himself (see Current Objective below for what that should
    cover, especially item 3's chroma key, where his own real footage is
    the one thing this round couldn't test against) — Phase 7 does not
    start yet.
  - **Still not done / not verified:** no automated test suite (same
    caveat as every phase). Library relocation has no progress indicator
    for a large library — it's a single awaited IPC call, so the Settings
    UI just shows "Moving…" until it resolves; fine for a personal library,
    revisit if it ever feels too opaque for a very large one. No undo for a
    library relocation once it completes (the OS-trash-based reversibility
    every other destructive action in this app has doesn't apply here,
    since the whole point is moving the *live* data — mitigated by it being
    a real `rename`/copy, never a delete-without-a-copy-first, so the data
    itself is never at risk, just not one-click-undoable). The reverse/
    mirror preview simplification (reverse doesn't preview backwards) is
    documented above, not a defect.

**Phase 6 continued — Dan's first-pass findings, addressed (2026-09-13).**
Reporting each of the three separately, as asked:

1. **Library relocation (item 5) — real data recovered, real root cause
   found and fixed by actual disk inspection, not guesswork.** What actually
   happened, confirmed by inspecting Dan's real machine directly (not
   speculation): the old `relocateLibrary` moved the *entire* library in one
   shot (one whole-tree `fs.rename`, falling back on failure to one
   whole-tree `copyRecursive` + one whole-tree `fs.rm(recursive, force)`).
   When that `fs.rm` hit a locked file inside the stray `dev-mode-test-...`
   project's `promptlab` folder and threw, Node's recursive delete had
   already unlinked files belonging to *other, unrelated, real* projects
   before the throw surfaced — every single file in every project folder at
   the default location was gone (confirmed: 0 files anywhere under
   `Documents/Dan's Video Studio/Projects`, just empty directory shells),
   even though the persisted location preference itself was never written
   (it correctly never got that far) — so the app kept pointing at the
   now‑hollowed‑out default location, which is why the project list broke.
   **The real data wasn't lost, though:** a fully intact copy had already
   been written moments earlier by `copyRecursive`, *before* the destructive
   delete ran, sitting safely at the folder Dan picked as the move's
   destination (`C:\Users\danmo\DansVideoEditor\Dan's Video Studio`) —
   including his two real projects, "sfh" and "teafa" (which even had a real
   exported MP4, `teafa-export.mp4`, still in its `exports/` folder). Fixed,
   with Dan's confirmation before touching anything:
   - The app's library-location preference now points at that intact
     `DansVideoEditor` copy.
   - "teafa"'s `project.json`/`assets.json` (also caught by the same
     deletion, since the bug wasn't selective) were reconstructed directly
     from what's actually still on disk there — same ids the timeline/SFX
     data already reference (verified: every `assetId` in `teafa`'s
     `editor/timeline.json` matches an entry in the rebuilt `assets.json`),
     so nothing is guessed, just re-indexed. "sfh"'s metadata had survived
     intact and needed no repair.
   - The 7 folders matching this app's own documented Playwright-test-
     residue naming pattern (`dev-mode-test-*`, `field-test-*`,
     `input-bug-test-*`, `submit-test-*`, `verification-pass-*`) plus 2
     small empty, unlabeled folders ("efdfdf", "sgsgd") were deleted from
     both the old default location and the `DansVideoEditor` copy, with
     Dan's explicit go-ahead. Dan's real project list is now exactly "sfh"
     and "teafa" — nothing else.
   - **Root cause fixed in `electron/libraryRelocationManager.ts`,
     rewritten:** relocation is no longer one all-or-nothing bulk operation.
     Every project now moves individually (`fs.rename` per project, falling
     back to copy *for that one project only* on cross-device failure,
     verified by comparing file count/total bytes before/after). The
     persisted location preference switches **only** once every single
     project has been verified fully present at the new location — never
     before, and never partially. Any failure anywhere in that phase
     triggers a full rollback (renaming back what was moved via rename,
     deleting the destination's partial copy for anything done via copy)
     that restores the old location to exactly what it was, leaving the
     preference untouched — a problem with one project (however it's
     caused) can now never again put any other project's data at risk.
     Verified against a synthetic fixture (never touching real data, per
     this file's own standing safety lesson on testing this exact feature):
     simulating the *exact* original failure (an `EPERM` partway through a
     copy-fallback) confirmed the whole operation throws cleanly, both real
     projects' files stay completely untouched at the old location, the new
     location's partial copy is fully cleaned up, and the preference never
     moves; removing the simulated bad project and retrying then confirmed a
     full, verified, successful move with the preference correctly
     switching only at the end. Cleanup of old per-project folders after a
     successful cross-device move is now best-effort and non-fatal per
     project (surfaced to Settings as a `cleanupWarnings` list on the
     result) rather than one failure aborting/corrupting the whole
     operation.
2. **Chroma key on export (item 3) — temporary diagnostic logging added,
   not yet root-caused.** Per this project's own habit — get real data
   before guessing again — `electron/videoExportManager.ts` now writes a
   diagnostics log on **every** export attempt (success or failure, since
   the symptom is a wrong-looking result, not an FFmpeg error) to a fixed
   `exports/export-diagnostics.log` inside the project's own folder
   (regardless of a custom per-export destination), and mirrors it to the
   console for whenever the app's run from a visible terminal. It captures,
   per clip involved: track type, chroma-key color/similarity/blend,
   crop/transform, speed/reverse/mirror/trim, transition info, and (via a
   new `probeMediaDiagnostics` in `electron/mediaProbe.ts`) the underlying
   file's real FFprobe'd resolution, video codec, pixel format, and audio
   codec — plus the complete generated `filter_complex` string and the full
   FFmpeg argument list. Explicitly marked temporary/removable once the bug
   is actually closed out, not permanent instrumentation. **Next step:**
   Dan reproduces the failure on his real project (his real "teafa" project,
   now restored, may well be the exact one — worth trying first); the
   resulting `export-diagnostics.log` is what actually points at the fix
   from here, rather than another synthetic guess.
3. **Reverse/mirror timeline badge (small follow-up) — built.** A clip on
   the timeline now shows a small ⏪ badge when Reverse is on and a ⇋ badge
   when Mirror is on (`Timeline.tsx`), each with a tooltip — Reverse's
   explicitly notes that live preview still plays forward, since that's a
   documented limitation (browsers can't play HTML5 `<video>` backwards),
   not a bug the badge is hiding. Closes the "does nothing" confusion from
   Dan's first pass; exporting a reversed clip to confirm real reversal in
   the output file (which Dan hadn't yet done) is still worth doing, now
   that the setting is visibly confirmable in the editor itself.

  **Verification status:**
  - Confirmed working on this machine: `npm run typecheck` and
    `npm run build` both succeed (renderer + main process).
  - Item 1's rewritten relocation logic was verified against a synthetic
    fixture built entirely under the scratchpad (see above) — both the
    failure/rollback path and the full-success path were exercised and
    matched expectations exactly. It was **not** re-run against a live
    "Move Library" click in the real UI this round (Dan's actual project
    data was still being recovered/repaired at the same time as the code
    fix, and this project's own safety lesson from last round is explicit
    about not testing this feature against real data) — worth Dan doing
    one real, low-stakes "Move Library" click himself now that his library
    is back to just "sfh"/"teafa," to confirm the fix in the live app, not
    just against the synthetic fixture.
  - Item 2's diagnostic logging was added but deliberately **not**
    exercised against Dan's real repro this round (that needs his real
    project and his real reproduction steps) — it's confirmed to compile
    and to wire in correctly, not confirmed to actually surface the bug yet.
  - Item 3's badge was added but not yet clicked through in the live app by
    either Dan or a scripted UI pass this round.
  - **Not yet confirmed: Dan's own manual click-through of all three of
    these** — same pattern as every prior round. Phase 6 stays the current
    objective.

**Phase 6 continued — real reverse live-preview proxy (2026-09-13), built.**
The one item decided but not yet built as of the previous round — see this
section's "New (2026-09-13)" entry a few paragraphs below — is now built.
When a media clip's `reverse` is turned on, `EditorManager` (new "Reverse
live-preview proxies" section in `electron/editorManager.ts`) kicks off a
background FFmpeg render of just that clip's *currently-trimmed* range,
reversed, into a small cached proxy file at `editor/proxies/<clipId>-<id>.mp4`
inside the project — the actual FFmpeg invocation lives in a new,
single-purpose `electron/reverseProxyManager.ts` (same small-file pattern as
`audioExtractor.ts`): input-side `-ss`/`-to` trims to just the clip's range
before FFmpeg decodes anything, then `reverse`/`areverse` plus the same
`atempo` chain the export uses for speed, scaled down to a 960px-wide
preview-quality encode (the export remains the authoritative, full-quality
renderer regardless of whether a preview proxy exists or matches — this is
purely a preview aid). A new `Clip.reverseProxy` field (`ReverseProxyState`
in `editorTypes.ts`) tracks `pending`/`ready`/`error` plus the exact
trim/speed it was rendered for, so a later trim change is detected as stale
and regenerates automatically — the stale file is deleted, not left behind.
`PreviewPlayer.tsx` plays that proxy (forward — which is what makes it look
reversed) instead of the real asset whenever one is `ready`, with a "⏳
Generating reversed preview…"/"⚠ failed" banner over the canvas otherwise;
the Clip Inspector and the timeline clip badge (previously just a plain
"Reverse is on" badge, per the badge-only round before this one) now reflect
proxy status specifically. Cleanup: turning `reverse` off, deleting the
clip, or deleting the whole track all delete that clip's proxy file;
duplicating a reversed clip or extracting its audio to a new track clip both
get their own independently-rendered proxy rather than sharing the
original's file, so one's deletion can never break the other's. Deleting the
whole *project* needs no special-case code — the project folder (including
`editor/proxies/`) is trashed as one unit, per `ProjectManager.deleteProject`'s
existing behavior. An app restart mid-render is self-healing: a clip found
stuck on `pending` with nothing actually in flight (the in-memory render
promise is gone after a restart) is automatically re-kicked off the next
time its project's timeline is read. Mirror needed no changes, as already
decided — its live preview was already correct via a CSS flip.

  **Verification status:**
  - Confirmed working on this machine: `npm run typecheck` and
    `npm run build` both succeed (renderer + main process); `npm start`
    launches a real window without error, same as every prior phase.
  - Confirmed working on this machine, via a scripted integration test run
    through the real Electron runtime (same pattern as every prior phase) —
    but this one additionally decodes and checks real pixel colors, not
    just that FFmpeg's exit code was 0, the same rigor this file's
    chroma-key diagnostic work called for and Phase 6's original
    reverse/mirror *export* check used. Built a synthetic 4-second source
    clip (0–2s solid red, 2–4s solid blue, plus a tone) specifically so a
    genuinely-reversed render is pixel-distinguishable from a no-op. 29
    assertions, all passing: turning Reverse on immediately reports
    `pending` in that same `updateClip` call's own response (not just on a
    later refetch); the proxy reaches `ready` with a real, non-empty file on
    disk; decoding the proxy's first and last frames confirmed genuine
    frame-order reversal (starts blue, ends red — the source's
    tail-then-head, not its original head-then-tail); `getReverseProxyMediaUrl`
    returns a real `media://` URL; trimming a reversed clip immediately
    re-marked its proxy `pending`, the regenerated file got a fresh path,
    the old (now-stale) file was actually deleted from disk, and the new one
    was verified to still start on the correct (now-narrower) reversed
    content; turning `reverse` back off cleared `reverseProxy` and deleted
    the file; duplicating a reversed clip produced a second,
    independently-rendered proxy file (not sharing the original's), and
    deleting the duplicate removed only its own file, leaving the original's
    untouched; a reversed image clip short-circuited to `ready` with no file
    rendered at all (reverse is a no-op on a still frame). This test runs
    fully isolated from Dan's real library — it points `libraryLocation.ts`'s
    preference at a synthetic scratch folder before doing anything else, per
    this file's own standing lesson from the library-relocation incident
    about never letting a test touch real project data — and confirmed
    afterward that only Dan's real "sfh" and "teafa" project folders exist
    in the real library; nothing test-related leaked in.
  - **Not yet confirmed: a live UI click-through (scripted or Dan's own) of
    the actual Editor tab.** This round's verification exercised
    `EditorManager`/`reverseProxyManager.ts` directly (and, via code
    inspection, `PreviewPlayer.tsx`'s/`Timeline.tsx`'s/`ClipInspector.tsx`'s
    proxy-aware logic), but — unlike most earlier Phase 6 items' first
    verification pass — didn't drive the real rendered UI with a scripted
    Playwright session this round. Same as every other still-open Phase 6
    item: **Phase 6 stays the current objective** until Dan has clicked
    through this himself (turn Reverse on for a real clip, watch the
    "Generating…" state, confirm the live preview actually plays backwards
    once it's ready) — see Current Objective below.
  - **Still not done / not verified:** no automated test suite (same
    caveat as every phase — the check above is a one-off script, not a
    committed test). No progress percentage on the "Generating…" state
    (FFmpeg's own `-progress` piping, used by the real MP4 export, wasn't
    wired up here — a preview-proxy render is short enough on a trimmed
    range that a bare spinner-style message was judged good enough; revisit
    if a very long reversed clip makes that feel slow). The app-restart-mid-
    render recovery path (see above) wasn't actually exercised by killing
    the process mid-render in this pass — only reasoned through and covered
    by code inspection, not a real repro.

Current Objective (Focus Area)

**Both scene/shot outline generator fixes CONFIRMED by Dan (2026-09-14),
working as expected.** Item 1 (verbatim script-detail preservation) and
item 2 (shot → Grok prompt: composed request lands unsent in the AI
Assistant composer for review, response auto-inserts into the prompt
field once Dan sends it, Idea notes pulled in as style/rules context) are
both closed. This was the last item blocking progress — **Phase 7 (Export
Tools) is now current.**

**Phase 7 — Export Tools.** MP4, GIF, still-frame, and clip exports as
first-class features (GIF maker: select part of a clip/timeline → choose
dimensions/FPS/quality/looping — not buried in a submenu). Builds on
Phase 6's existing FFmpeg plumbing (`videoRuntime.ts`, `videoExportManager.ts`)
rather than needing new infrastructure.

1. **Preserve structured script detail verbatim instead of summarizing it
   away.** **CONFIRMED by Dan (2026-09-14), working.** Dan's real script
   format is rich and already shot-structured — e.g. `**S17 | 0:55–0:58 |
   FULL** 🎵 *"Making distance disappear."* Wide of the shared couch. Abi
   is very slightly translucent... *Motion: static, gentle.* **COMP
   NOTE:** Abi layer at 88% opacity, feathered edge.` — and the generated
   shots now carry that detail through. Closed.
2. **REVISED AGAIN (2026-09-14) — one more change to item 2's design
   before it's handed off, so the coding agent builds the right thing the
   first time.** Dan reconsidered the auto-send behavior below before it
   was built: he wants a review step before anything actually goes to the
   API, "just to make sure nothing was missed or forgotten."
   - **Final design:** on first click for an unlinked shot, assemble the
     draft-request text (shot's title/description including fix 1's
     preserved verbatim detail, plus the project's Idea notes as
     style/rules context — see below) and **place it directly into the AI
     Assistant's message composer, unsent.** Expand/focus the panel so Dan
     sees it sitting there ready to review or edit — do NOT call the
     Anthropic API automatically. Dan reviews (and can freely edit) the
     composed request, then sends it himself, the normal way, whenever
     he's satisfied with it.
   - **Once Dan sends it and a real response comes back, auto-insert that
     response directly into the entry's prompt text field** (the same
     effect as clicking "Insert," done for him) — confirmed explicitly:
     yes, still auto-insert, only the *request* needed a human review step,
     not the result.
   - This replaces the earlier "automatically send an initial AI Assistant
     request... no typing required" design below, which is now superseded
     — kept as the original record, not deleted, but not what to build.
   - **DECIDED (2026-09-14), same round: pull in the project's Idea notes
     as style/rules context for this composed request.** Dan: the
     project's established style/visual rules ("the bible") should already
     inform a drafted Grok prompt, not be something he has to re-explain
     each time. V1 of this: prepend the project's Idea tab notes (if any
     exist — proceed normally with none, don't block or error) as context
     within the composed (still-unsent) request text. Bigger ideas raised
     in the same breath (pulling in Grok recipes, prior successful prompt
     patterns, etc.) are NOT part of this fix — Idea notes only, for now;
     revisit the richer version separately later if wanted.
   - **Scope boundary, unchanged:** this only applies to the *first* click
     on an unlinked shot. Once linked, clicking still just navigates to the
     existing entry (already correct) — never re-triggers a fresh
     auto-draft on top of whatever Dan may have since edited manually.
   - The shot's older standalone `promptText`/Copy-Prompt field question
     from the original scope is still explicitly not being addressed here.

  **BUILT (2026-09-14), both items — not yet confirmed by Dan's own hands,
  per this project's normal pattern.** Reporting each separately, as asked:

  1. **Verbatim script-detail preservation — built.** `aiAssistantManager.ts`'s
     `SCENE_OUTLINE_SYSTEM_PROMPT` gained an explicit "IMPORTANT — preserve
     structured script detail verbatim" section: it names the four detail
     categories to copy through unchanged (timestamps/time ranges; quoted or
     music-marked lyric lines; explicit shot/scene codes; clearly-marked
     notes like "COMP NOTE:"/"Motion:"), includes Dan's exact example
     verbatim as the illustration, and explicitly says a generic paraphrase
     is wrong if the source specifies that level of detail — fold it in
     alongside the plain-language summary, don't replace it. The constant is
     now exported (like `parseGeneratedOutline` already was) purely so a
     scripted check can assert its actual content without a paid API call.
     No change to the JSON shape, `parseGeneratedOutline`, or
     `applyGeneratedOutline` — this is a prompt-wording-only fix, downstream
     handling already passes whatever text comes back through unmodified.
  2. **"✨ Draft Grok Prompt" shot → Prompt Lab entry link — built, matches
     the described scope exactly.** New `Shot.linkedGrokEntryId: string |
     null` field (`productionManager.ts`, defaults to `null` for shots
     created before this — via `normalizeShot`, same pattern as
     `linkedSfxIds`), plumbed through `updateShot`'s updates type in
     `main.ts`/`preload.ts`/`src/api.d.ts` exactly like the existing
     `linkedAssetId`/`linkedSfxIds` fields. A new button on `ShotCard.tsx`
     (in the shot's always-visible row, not gated behind expanding it) reads
     "✨ Draft Grok Prompt" when unlinked or "✨ Open Grok Prompt" once
     linked, disabled while the click is in flight. The actual create-or-
     navigate logic lives in `SceneList.tsx` (which already owns `shots`
     state and `window.api` access): unlinked → `createPromptEntry(...,
     'grok', { promptText: seed })` where `seed` joins the shot's title and
     description (so fix 1's preserved detail carries straight through, per
     the original ask), then `updateShot(..., { linkedGrokEntryId })`;
     either way, a new `onOpenGrokEntry(entryId)` callback bubbles up to
     `ProjectView.tsx`, which sets a `promptLabFocusEntryId` and switches the
     tab to Prompt Lab. Landing there: `PromptLab.tsx` passes the focus id
     through to `PromptLabPanel.tsx` (Grok is already its default sub-tab,
     so no extra tab-forcing logic was needed), which passes a new
     `autoOpen` prop to `AiAssistantPanel.tsx` (starts the panel expanded
     and focuses its composer textarea, instead of the normal
     collapsed-by-default state) and a new `autoExpand` prop to the matching
     `PromptEntryCard.tsx` (starts that one card expanded and scrolls it
     into view). `promptLabFocusEntryId` is cleared whenever the user
     navigates away from the Prompt Lab tab, so a later *manual* revisit
     doesn't re-trigger the auto-expand/scroll from a stale earlier
     navigation. No duplicate on a second click: the button checks
     `shot.linkedGrokEntryId` first and only ever navigates in that case.
     Deliberately untouched, per the original scope: the shot's older
     standalone `promptText`/Copy-Prompt field and button.
  - **Verification status (both items):** `npm run typecheck` and
    `npm run build` both succeed. Confirmed working on this machine, via a
    scripted check run through the real Electron runtime (same pattern as
    every prior phase, exercising the real compiled code, not a
    reimplementation of it): asserted `SCENE_OUTLINE_SYSTEM_PROMPT`'s actual
    string content contains Dan's exact example verbatim plus each of the
    four detail-category callouts and the word "verbatim" itself — no real
    Anthropic call made, same "don't spend Dan's money to test something
    that doesn't need it" discipline as every prior phase's system-prompt/
    parsing verification, and consistent with this feature's own original
    verification (which also couldn't exercise a real model call); confirmed
    `parseGeneratedOutline` still passes a fixture containing that exact
    verbatim text through completely unmodified (nothing downstream
    re-summarizes it). Separately, created a real throwaway project/scene/
    shot through the real `ProductionManager`/`PromptLabManager` and drove
    the actual "draft" logic end-to-end: a fresh shot starts with
    `linkedGrokEntryId: null`; drafting creates exactly one Grok entry
    seeded with the shot's title and description (including the verbatim
    detail) and links it; a second simulated click reuses the same id
    without creating a second entry; and a hand-edited legacy shot file
    missing `linkedGrokEntryId` entirely normalizes to `null` on read
    instead of throwing. Also confirmed via a scripted Playwright pass
    against the real, built Electron window (same technique as every prior
    phase's UI verification — an isolated `--user-data-dir` *and*, this
    round, a pre-seeded `libraryLocation.json` pointing at a throwaway temp
    folder instead of the real Documents-based library, since
    `--user-data-dir` alone isolates Electron's settings but not
    `app.getPath('documents')` — exactly the kind of real-library collision
    a prior round's dry runs were first caught hitting, avoided here by
    construction instead of by luck): created a project via the real UI;
    added a scene and a shot, set the shot's description to Dan's exact
    example text via the real Save Details flow; confirmed the "✨ Draft
    Grok Prompt" button is present before any entry is linked; clicked it
    and confirmed the app navigated to Prompt Lab with the Grok sub-tab
    active, the AI Assistant panel already expanded with its composer
    textarea actually focused (`document.activeElement`, not just visible),
    and the new entry's card already expanded and scrolled into view,
    showing both the shot's title and the verbatim preserved detail
    ("0:55-0:58", "COMP NOTE:", the quoted lyric) inside its prompt text;
    went back to Scenes & Shots and confirmed the button now reads "✨ Open
    Grok Prompt" (the create-new label is gone); clicked it again and
    confirmed there is still exactly one Grok entry — no duplicate; deleted
    the throwaway project and confirmed it no longer appears in the project
    list. The throwaway userData/library temp folders were removed
    afterward; confirmed via direct disk inspection that Dan's real
    `OneDrive/Documents/Dan's Video Studio/Projects` folder still holds only
    his real "teafa" project, untouched by any of this.
  - **Not yet confirmed: an actual real-model generation run using item 1's
    updated prompt** (same reasoning as this feature's original rollout —
    that costs real money on Dan's key and needs his real Settings profile).
    The prompt-content assertion above confirms the instruction is actually
    being sent; whether Claude's real replies reliably honor it on Dan's
    actual, messier scripts (not just the one worked example) still needs
    Dan's own pass: regenerate an outline from a script using his real
    shot-code/timestamp/lyric/comp-note shorthand and confirm the generated
    shot descriptions keep that detail recognizable rather than summarizing
    it away. For item 2, Dan's own click-through of the button in his real
    project (not just this session's throwaway one) is still the
    confirmation this project's pattern requires before considering either
    item closed.
  - **Still not done / not verified:** no automated test suite (same
    caveat as every phase). The seeded Grok entry's starting prompt is the
    shot's raw title+description text, not yet reshaped into
    video-generation-prompt phrasing (camera/motion/style language) — the
    AI Assistant is there to help with exactly that once the entry is open,
    per the original scope, so this isn't a gap, just worth noting it's a
    starting point, not a finished prompt. No UI surfaces the reverse
    direction (jumping from a Grok Prompt Lab entry back to the shot that
    drafted it) — not asked for.

**Item 2, REVISED AGAIN — RESOLVED (2026-09-14), built and verified, matches
the "REVISED AGAIN" final design above exactly, not the earlier "auto-send"
design it superseded.** On first click for an unlinked shot, the flow now
stops well short of ever calling the Anthropic API automatically:
- `SceneList.handleDraftGrokPrompt` still creates and links a Grok Prompt
  Lab entry exactly as before (seeded with the shot's title/description, so
  the entry always holds a real, non-empty starting value — required, since
  empty prompt text is rejected). New this round: it also fetches the
  project's Idea notes (`window.api.getIdea`) and, if any exist, prepends
  them as labeled style/rules context ahead of a "Draft a Grok
  video-generation prompt for this shot:" instruction wrapping the same
  seed; if Idea notes are empty, it proceeds with just the instruction +
  seed, no error/block. That assembled text is written straight into the
  Grok AI Assistant's persisted, not-yet-sent composer draft via the
  existing `window.api.saveAiDraft(projectId, 'grok', draftRequest)` call —
  the exact same file `AiAssistantPanel` already reads on expand, so no new
  IPC surface was needed for this half. **No Anthropic call happens in this
  function at all.**
- Navigation (`onOpenGrokEntry`) now carries a second `armAutoInsert`
  boolean — true only for a just-created entry on this fresh draft, false
  for a plain re-navigate to an already-linked entry. `ProjectView` holds it
  as new `promptLabAutoInsertEntryId` state (mirroring how
  `promptLabFocusEntryId` already worked), threaded down through
  `PromptLab` → `PromptLabPanel` → a new `onAutoInsert` prop on
  `AiAssistantPanel`, cleared the same way as the focus id whenever the user
  leaves the Prompt Lab tab.
- **The actual auto-insert mechanism, in `AiAssistantPanel.tsx`:** a new
  `awaitingAutoInsertReply` bit of state initializes to `true` only when
  this panel mounted with an `onAutoInsert` target (i.e., only on the
  landing from a fresh draft, never on an ordinary AI Assistant visit).
  Dan's `handleSend` — completely unchanged in every other respect, so
  editing the drafted text before sending, or not sending at all, both work
  exactly like using the AI Assistant normally — now checks that bit right
  after a send actually succeeds: if armed, it hands the just-returned
  reply straight to `onAutoInsert` (which `PromptLabPanel` wires to
  `updatePromptEntry(..., { promptText: reply })` on the specific linked
  entry — the *same effect* as clicking that message's own "Insert" button,
  just automatic) and then disarms itself, so a second, unrelated message
  sent later in the same panel visit behaves like completely normal AI
  Assistant usage and does *not* re-overwrite the entry. The manual
  "Insert" button on every reply still works exactly as before, unrelated
  to any of this.
- **Scope boundary confirmed in code, not just by convention:** the whole
  Idea-notes-fetch/draft-request/arm-auto-insert path lives inside
  `handleDraftGrokPrompt`'s `if (!entryId)` branch — a click on an
  already-linked shot never re-enters it, so it can never re-draft over
  edits Dan has since made to the entry himself.
- **Verification status:** `npm run typecheck` and `npm run build` both
  succeed. Two scripted Playwright passes against the real, built Electron
  window (same isolated-`--user-data-dir`-plus-pre-seeded-`libraryLocation
  .json` technique as this feature's original rollout, so neither could
  collide with Dan's real profile/library):
  1. **Request side (real, no mocking, no cost):** created a project via
     the real UI; saved real Idea notes ("House style: warm handheld 16mm
     look..."); added a scene and a shot, saved a shot description
     containing timestamp/shot-code/COMP-NOTE-style detail (fix 1's
     territory). Clicked "✨ Draft Grok Prompt" and confirmed, all in the
     live UI: navigation landed on Prompt Lab → Grok with the AI Assistant
     panel expanded and its composer **actually focused**
     (`document.activeElement`, not just visible); the composer's text
     contained the Idea notes verbatim, the shot's title, and its verbatim-
     preserved detail, wrapped in the drafting instruction; **zero messages
     appeared in the thread and no error banner rendered** despite this
     isolated profile having no API key configured — direct proof nothing
     was auto-sent; exactly one Grok entry existed, correctly seeded and
     linked. Navigated back to Scenes & Shots, confirmed the button now
     reads "✨ Open Grok Prompt," clicked it again, and confirmed there was
     still exactly one entry (no duplicate) and the composer still held the
     same drafted text (no re-draft on the second, navigate-only click).
  2. **Response side (the auto-insert itself):** since exercising this for
     real means an actual paid Anthropic call, this pass used the same
     "don't spend Dan's money to test something that doesn't need a real
     model" discipline every prior phase's error-path testing used, but
     applied to a *successful* reply instead of an error: a **temporary,
     git-ignored, never-committed** in-place patch to the compiled
     `dist-electron/aiAssistantManager.js` (backed up first, restored
     immediately after — confirmed via `git status` showing only the
     intended source-file changes and zero leftover patch markers in the
     rebuilt output) swapped the real `client.messages.create(...)` call for
     a fixed canned string, with everything else — the IPC plumbing, the
     renderer, `AiAssistantPanel`'s send/insert logic, `PromptLabPanel`'s
     wiring — genuinely real and unmodified. Against that patched build:
     created a project/scene/shot, clicked "Draft Grok Prompt," confirmed
     the entry's prompt field still held the placeholder seed (not yet the
     reply), clicked the real "Send" button on the pre-filled composer text,
     and confirmed: the canned reply appeared in the thread; the linked
     entry's prompt text field was automatically overwritten with that
     exact reply text (not appended, not left as the old seed) with **no
     manual "Insert" click**; then sent a second, unrelated message in the
     same panel visit and confirmed the entry's prompt text stayed exactly
     the first reply — the arm-once behavior held, so a routine follow-up
     question doesn't clobber the entry again. Full clean rebuild from
     unmodified source afterward, confirmed via `npm run build` and a
     content-grep of the rebuilt file (zero occurrences of the patch's test
     markers). Both passes' throwaway projects/temp profiles were deleted
     afterward; confirmed via direct disk inspection that Dan's real
     library still holds only his real "teafa" project.
- **Not yet confirmed: Dan's own hands-on pass with his real Anthropic key
  entered in Settings** — same standing requirement as every real-model-call
  feature in this project (Phase 4's original rollout, the outline
  generator). The scripted passes above prove the *mechanism* end-to-end
  (real request assembly and placement, real no-auto-send guarantee, real
  auto-insert wiring against a real send/reply round trip through the real
  IPC/renderer stack) — what they can't prove is whether a real Claude reply
  to this drafted request is actually a good, ready-to-paste Grok prompt in
  practice. Dan's own pass: pick a real shot on a real project, click
  "Draft Grok Prompt," review/edit the pre-filled request if he wants to,
  send it, and confirm the real reply that lands in the entry's prompt
  field is something he'd actually want to paste into Grok.

**URGENT, PRIORITY (2026-09-14): real data loss on a real project — this
is next, now that the chroma-key preview-accuracy work below is done.**
Dan lost both an AI Assistant conversation (a genuinely good idea, per
him) and typed Idea notes, all at once, by switching tabs without saving —
on real project work, not test data. Confirmed directly with Dan: he never
saved, and never realized he needed to.
- **AI Assistant conversation history must persist automatically, with no
  manual save step at all.** This was originally specced (Phase 4) to save
  "per project, per context" — losing a whole conversation like this means
  that's not actually holding up reliably in practice, which makes this a
  real regression to fix, not new scope. Persist each message as it's
  sent/received, not batched or dependent on any explicit action.
- **Idea and Script notes need real autosave (debounced, e.g. save
  shortly after typing pauses), not just the current explicit Save
  button/Ctrl+S.** Dan's own words: "I can't have to remember to save
  before switching tabs" — the fix is removing the need to remember, not
  a better warning. Apply to both tabs, since both currently share the
  identical explicit-save-only design and the identical risk.
- Verify by actually reproducing Dan's scenario: type into Idea notes
  and/or chat with the AI Assistant, switch tabs without manually saving,
  switch back, confirm nothing is lost.

  **RESOLVED (2026-09-14), built and verified.** Root cause, actually
  investigated rather than guessed — and it turned out to be a single
  mechanism hitting two places, not two unrelated bugs:
  - **The already-*sent* side of the AI Assistant conversation was never
    actually broken.** `aiAssistantManager.sendMessage` (main process) has
    always written both the user's message and the assistant's reply to
    `aiAssistant/<context>.json` immediately, before returning to the
    renderer — genuinely no manual-save step, and that write happens in the
    main process independent of whatever the renderer/React tree is doing,
    so it isn't affected by a tab switch. Confirmed by code inspection and
    by this round's own verification (seeded a fake sent exchange on disk
    and confirmed it survives switching tabs, below).
  - **The real cause, for both symptoms Dan reported:** `ProjectView.tsx`
    renders each tab's content conditionally (`{tab === 'idea' && <IdeaEditor
    .../>}`), so switching tabs fully *unmounts* the previous tab's
    component tree — destroying whatever was only sitting in that
    component's local React state. For Idea/Script notes, that's the
    typed-but-unsaved textarea content (`IdeaEditor.tsx`/`ScriptEditor.tsx`'s
    own `draft` state) — exactly the explicit-Save-button design working
    exactly as specced, which was the actual problem. For the AI Assistant,
    the equivalent local state is `AiAssistantPanel.tsx`'s composer
    `draft` — the message-in-progress the user hadn't clicked Send on yet.
    That's almost certainly the "genuinely good idea" Dan lost: not a
    previously-sent-and-answered exchange (which was always safe on disk),
    but a message he was composing when he switched tabs, which had never
    been sent yet and so had nothing durable behind it at all.
  - **What was built:** new `src/useAutosave.ts` — a small shared hook used
    by `IdeaEditor.tsx`, `ScriptEditor.tsx`, and `AiAssistantPanel.tsx`.
    It debounce-saves ~1.2s after typing pauses (the "save shortly after
    typing pauses" ask), but the debounce alone doesn't fix Dan's exact
    repro (type, then switch tabs *immediately* — well under 1.2s): its
    second effect flushes the latest value immediately on unmount if a save
    was still pending, which is exactly when a tab switch happens. The
    flush calls straight into the same `window.api.saveIdea`/`saveScript`/
    (new) `saveAiDraft` IPC calls, which keep running in the main process
    and write to disk regardless of whether the renderer component that
    triggered them is still around by the time they finish — the same
    already-solid mechanism the sent-message path relied on. The explicit
    Save button and Ctrl+S still work on Idea/Script (now redundant, not
    load-bearing); the toolbar text now reads "Unsaved changes — saving
    automatically…" while a save is pending. For the AI Assistant, the
    composer's draft is persisted to a new sibling file per context
    (`aiAssistant/<context>.draft.json` in `aiAssistantManager.ts` — kept
    separate from the existing `AiMessage[]` conversation file so that
    format didn't need to change), loaded back in when the panel is
    re-expanded, and cleared immediately once the draft is actually sent.
  - **Verification status:** `npm run typecheck` and `npm run build` both
    succeed. Reproduced Dan's exact scenario via a scripted Playwright pass
    against the real, built Electron app (same technique as every prior
    phase's UI verification — run in a throwaway, isolated `--user-data-dir`
    this time specifically so a test run can never collide with or risk
    Dan's real, possibly-already-open app profile/library, after this
    round's own dry runs were first caught landing in the wrong
    place by exactly that kind of collision): typed into Idea notes, switched
    to the Script tab within ~150ms (no wait for the debounce), switched
    back — text intact; confirmed it actually reached disk (not just
    still-live memory) by fully reloading the app and re-opening the
    project. Repeated for Script notes. Typed an unsent message into the
    Idea tab's AI Assistant composer, switched tabs within ~150ms, switched
    back, re-expanded the panel — the draft text was restored; confirmed
    that also reached disk via a full reload. Separately seeded a fake
    *sent* exchange directly into a test project's `aiAssistant/idea.json`
    (avoiding a real paid Anthropic call, same technique as Phase 3/4/5's
    verification) and confirmed it still displays correctly after switching
    tabs away and back — the sent-message path, unaffected by any of this
    round's changes. All assertions passed; the throwaway test project was
    deleted (trashed) afterward. **CONFIRMED by Dan (2026-09-14), his own
    hands-on testing.** Closed.

**NEW, PRIORITY (2026-09-14), jumps ahead of Phase 7 per Dan's call:
AI-generated scene/shot outline from the script.** Gestured at in the
original ChatGPT-authored plan ("AI assistance could help break scenes
into appropriately sized shots") but never built — Phase 2 shipped
manual-only. Now natural to build since Phase 4's AI Assistant already has
real API access wired up.
- A "Generate Scenes & Shots" action on the Script tab, using the
  project's existing script text as input to a real Anthropic API call
  (same plumbing/API key as the rest of the AI Assistant — real per-use
  cost, already accepted).
- **Generates both scenes and a first-pass shot breakdown within each
  scene** (not scenes-only) — per Dan's explicit choice. Shots get a
  title/description like manually-created ones; **do not** auto-populate
  a shot's Grok prompt field from this — that's a separate, more detailed
  step that belongs in the Prompt Lab, not this outline pass. Generated
  shots default to "Planned" status, same as manually-created ones.
- **If the project already has scenes, ask before replacing** — per Dan's
  explicit choice, not a silent default either way. Offer both real
  choices: add the newly generated scenes on top of the existing set, or
  replace the existing set entirely (with the existing set's own data
  actually gone if replace is chosen — be genuinely careful here, per
  this project's repeated lesson about destructive operations on real
  project data; trash/back up the replaced scenes rather than a bare
  overwrite, if that's easy to do consistent with how deletes already work
  elsewhere in the app).
- Once created, generated scenes/shots are just regular scenes/shots —
  editable/reorderable/deletable through the existing Scenes & Shots tab
  UI like any other, no special "AI-generated" marker needed.

  **BUILT (2026-09-14), all of the above scope — not yet confirmed by Dan's
  own hands, per this project's normal pattern.** A "✨ Generate Scenes &
  Shots" button sits in the Script tab's toolbar (disabled until there's
  script text), opening a new `GenerateOutlineDialog.tsx`. The work split
  the same way the rest of the app splits: `aiAssistantManager.ts` gained
  `generateSceneOutline(projectId, scriptText)`, a one-shot structured-
  generation call (not a saved chat turn — nothing here touches any
  `aiAssistant/<context>.json` conversation file) with its own system
  prompt instructing the model to return *only* a JSON array of
  `{ title, description, shots: [{ title, description }] }`, parsed and
  validated by a new `parseGeneratedOutline` (strips an accidental markdown
  fence, throws a clear error on invalid/empty JSON, coerces malformed
  fields rather than crashing on them). `productionManager.ts` gained
  `applyGeneratedOutline(projectId, generated, mode)`, which actually
  creates the `Scene`/`Shot` records — generated shots default to
  `'planned'` status and otherwise come out identical in shape to a
  manually-created scene/shot (empty `promptText`, no linked asset/SFX/
  songs), so nothing downstream needs to know they were AI-generated.
  These two calls are deliberately separate manager methods, wired together
  only in `main.ts`'s IPC handler — the Anthropic call and the actual data
  write are two different responsibilities, same split as everywhere else
  in this app.
  - **Ask-before-replacing, built as asked, not a silent default either
    way.** `GenerateOutlineDialog` checks `listScenes`/`listShots` as soon
    as it opens; if the project already has scenes it shows the real
    existing count and two explicit choices — "Add Alongside Existing" or
    "Replace Existing" — instead of guessing. Nothing is sent to Anthropic
    until the user picks one (so canceling costs nothing).
  - **Replace doesn't bare-overwrite.** `applyGeneratedOutline` snapshots
    the current `scenes.json`/`shots.json` into a new, timestamped
    `script/backups/<timestamp>/` folder inside the project *before*
    writing the new outline over them — recoverable via "Open Folder," not
    silently gone — consistent in spirit with how asset/project deletes
    already use the OS trash elsewhere in the app, adapted to a JSON-array
    data shape where `shell.trashItem` (which operates on real files) isn't
    a direct fit. No backup folder is created when there was nothing to
    back up (a fresh project with zero existing scenes).
  - **Verification status:** `npm run typecheck` and `npm run build` both
    succeed. Confirmed working on this machine, via a scripted integration
    test run through the real Electron runtime (same pattern as every
    prior phase): `parseGeneratedOutline` against hand-written model-
    response fixtures (a fenced valid array, invalid JSON, a non-array, an
    empty array, malformed fields) — all behave correctly, including the
    fenced-JSON case since a real model reply isn't guaranteed to skip
    markdown despite being asked to; `generateSceneOutline`'s two guard
    clauses (empty script text, no API key configured) against a fake
    `SettingsManager` stand-in, confirming *no real network call is made*
    for either — genuinely the same "don't spend Dan's money to test an
    error path" discipline Phase 4's verification used; then
    `applyGeneratedOutline` against a real test project through the real
    `ProductionManager`: add-mode on a fresh project (correct scene/shot
    counts, contiguous order, Planned status, no stray links), add-mode
    layered on top of a manually-created scene (existing data untouched,
    order stays a clean 0..n-1 permutation), and replace-mode — confirmed
    the live files hold only the new outline *and* that the backup folder
    exists with the exact pre-replace scene/shot counts, including the
    specific manually-added scene surviving inside it — plus confirmed no
    backup folder is created when replacing on a project with nothing to
    back up. Also confirmed via a scripted Playwright pass against the
    real, built Electron window (same technique as every prior phase's UI
    verification, an isolated `--user-data-dir` so it can't collide with
    Dan's real profile): created a project via the real UI; the Generate
    button is disabled with an empty script and enables once script text
    exists; opening the dialog on a scene-free project shows the plain
    "ready to generate" screen; clicking Generate with no API key
    configured (this isolated profile has none, regardless of Dan's real
    key in his actual profile) shows the exact real
    "No Anthropic API key configured" error banner in the live UI, not a
    generic failure; manually added a real scene via the Scenes & Shots
    tab, reopened the dialog, and confirmed it correctly detected the
    existing scene, showed the right count, and offered both the "Add
    Alongside Existing" and "Replace Existing" choices with the backup
    explanation text; confirmed Cancel closes the dialog without touching
    any data. All throwaway test projects (both the manager-level pass's
    and the UI pass's) were cleaned up (trashed) afterward — confirmed via
    a fresh `listProjects()` call that none were left behind.
  - **Deliberately not exercised this round, same reasoning as Phase 4's
    original verification:** an actual successful Anthropic call (real
    script in, real generated scenes/shots out) — that costs real money on
    Dan's key and needs his real Settings profile, not the isolated test
    profile the scripted UI pass used. The JSON-parsing/validation logic
    itself *is* covered above, directly, against hand-written fixtures
    shaped like a real model response — what's *not* covered is whether
    Claude's actual replies reliably match that shape/quality in practice.
    Dan's own pass should write or reuse a real script, click "Generate
    Scenes & Shots," try both "no existing scenes" and "existing scenes"
    paths (the latter needs a real scene created first), confirm the
    generated scenes/shots read sensibly and land correctly in the Scenes &
    Shots tab, and — for Replace specifically — confirm the backed-up
    `script/backups/<timestamp>/` folder is really there afterward.
  - **Still not done / not verified:** no automated test suite (same
    caveat as every phase). No way to preview/edit the generated outline
    before it's applied — Generate commits straight to scenes/shots, and
    any cleanup happens afterward in the normal Scenes & Shots UI; not
    asked for, and Replace's backup gives a safety net if a generation
    comes out badly. No limit on script length sent to the API — a very
    long script could hit context/output-token limits or produce a
    truncated/invalid JSON response; `parseGeneratedOutline` fails loudly
    rather than silently in that case (per the validation above), but
    there's no upfront length warning.

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

**Phase 5 — Media Management is now fully confirmed.** Dan clicked through
all three scope-expansion items himself: linking a Grok/Suno entry to an
asset, the unified SFX tab (licensed and ElevenLabs-sourced entries side
by side, both ratable), and multi-linking SFX on a shot / multiple songs
on a scene. Everything worked. This closes Phase 5 — see Completed Tasks
above for the full built/verified record across both rounds.

**Phase 6 — Video Editor is built, not yet confirmed — still the current
objective.** Every item in the original scope — multiple video/audio
tracks, trimming/splitting, rearranging clips, overlays/text/titles, fades/
dissolves, volume control, green screen/chroma key, cropping/scaling/
positioning, speed adjustment, basic transitions, MP4 export — was built
this round (2026-09-13) and dev-tested (a scripted engine-level test through
the real Electron runtime that produced and FFprobe-verified a real MP4,
plus a Claude-driven Playwright UI click-through of the actual built app —
see Completed Tasks above for the full record and the one open question it
surfaced about the trim-drag gesture specifically). **Phase 7 does not
start** until Dan has clicked through the Editor tab himself, per this
project's normal confirm-then-advance pattern.

**Update (2026-09-13): all nine numbered items below are now built** — see
"Phase 6 continued" in Completed Tasks above for the full per-item record.
Item 4 stays withdrawn (a misunderstanding, not a real gap — see its own
entry below). Item 3 (chroma key on export) got real diagnostic work and one
concrete hardening fix, but **could not be confirmed fixed** against Dan's
own original repro this round — see that item's Completed Tasks entry and
the note in Technical Notes below for what to capture if it resurfaces.
**Phase 6 still stays the current objective** until Dan has clicked through
all nine himself, per this project's normal pattern — the list below is kept
as the original record of what was asked for, not rewritten.

**Dan's own manual click-through (2026-09-13), first pass — mixed
results, reported per item:**
- **Items 6, 7, 8, 10: confirmed working by Dan.** Export destination
  choice, direct-manipulation preview editing, the right-click context
  menu, and playhead drag precision all work as intended.
- **Items 1 & 2: clarified, no change needed.** Dan initially expected
  audio extraction to also remove/mute the audio from the *original* video
  (both the standalone-asset version and the timeline version) rather than
  just add a separate audio-only copy alongside it. On reflection he
  doesn't need that — confirmed fine as built. (Note: item 2, the
  timeline-clip version, *does* already turn the source clip's own audio
  off automatically, per its original design — only item 1, the
  Assets-tab version, leaves the source video's audio untouched, which is
  the part Dan was reacting to and has now said is fine as-is.)
- **Item 9 (reverse/mirror): reverse is actually working, just confusing —
  not a bug, a missing affordance.** Dan expected checking "Reverse" to
  visibly change the editor's live preview; per this file's own
  documentation of the feature, that was never going to happen (browsers
  can't play HTML5 `<video>` backwards) — but nothing in the UI told him
  that, so it read as "does nothing." **New, small follow-up:** add a
  visible badge/icon on a clip in the timeline when Reverse or Mirror is
  checked, so the setting is confirmed without needing to export first.
  Dan hasn't yet tried actually exporting that clip to confirm real
  reversal in the output file — worth doing once the badge is in, so both
  get confirmed together. **RESOLVED (2026-09-13): badge built** — see
  "Phase 6 continued — Dan's first-pass findings, addressed" above.
- **Item 3 (chroma key on export): ROOT CAUSE CONFIRMED (2026-09-14) — see
  the dated update at the end of this item's writeup below for the
  breakthrough** (tested directly against Dan's real source clip and real
  project, not another synthetic reconstruction). Kept below in its
  original, same-day chronological order, starting from that day's first
  lead: **REAL DIAGNOSTIC DATA IN HAND** — first actual lead on this
  bug, after two rounds of synthetic tests that couldn't reproduce it. Dan supplied a real
  `export-diagnostics.log` plus two screenshots (editor preview vs. the
  exported file played in Windows Media Player) from a throwaway test
  project (no real data). **The symptom itself is different from the
  original report** — not solid black this time, but the opposite
  direction: the chroma-keyed green renders fully vivid/saturated in the
  live editor preview, and much lighter/washed-out (not gone, not solid —
  faded) in the exported file.
  - **The critical detail the log reveals: this clip has BOTH `chromaKey.
    enabled=true` AND `reverse=true` set together.** Every previous test of
    chroma key was reverse-off, and every previous test of reverse was
    chroma-key-off — this specific combination may never have actually been
    exercised before, on either the live-preview or export side.
  - **Leading hypothesis, not yet confirmed by code inspection:** when
    `reverse` is on, the live preview plays the separately-rendered reverse
    proxy (`reverseProxyManager.ts`, built last round) instead of the
    original asset. Per that feature's own description, the proxy is
    generated with only `reverse`/`areverse`/`atempo` — no chroma-key baked
    in. If `PreviewPlayer.tsx` then plays that proxy directly rather than
    still routing it through whatever real-time chroma-key compositing
    normally applies to non-reversed clips, the editor would show the raw,
    unkeyed source exactly as Dan described — fully vivid green, completely
    unprocessed. The actual FFmpeg export, meanwhile, likely *is* applying
    `chromakey` correctly per the generated `filter_complex` — but this
    clip's specific settings (`similarity=0.2`, `blend=0.1`, fairly
    conservative values) may only partially fade near-matching pixels
    rather than cleanly remove them, which would produce exactly "lighter,
    not gone" rather than either a clean key or no key at all.
  - **RESOLVED, this part (2026-09-14): reverse is NOT the cause.** Dan
    re-tested the exact same clip and chroma-key settings with reverse
    turned off — still the same washed-out result. This is the original
    bug on its own, confirmed independent of reverse; the two-separate-
    things framing above was worth checking but (a) is ruled out.
  - **Filter-ORDER lead — TESTED (2026-09-14), NOT confirmed, NOT applied.**
    The theory: chroma key is applied **after** scaling —
    `crop=688:435:0:29,scale=1601:1080,chromakey=...` — so a >2x upscale of
    real (compressed, noisy) footage happens before the key; upscale
    interpolation could shift green pixels slightly off `#31a05b`, and with
    `similarity=0.2`/`blend=0.1` that could produce a hazy, wide-area
    partial removal instead of a clean cut. Tested directly, per Dan's
    request, with real pixel-level verification (not just "the filter graph
    compiles") — not applied to `videoExportManager.ts`, since it did not
    hold up:
    - Built two real, compressed (libx264, CRF 18) synthetic clips through
      the bundled FFmpeg — one a flat green field with per-pixel noise, one
      with a realistic uneven-lighting vignette plus a real non-green
      foreground subject (closer to an actual green screen's lighting
      falloff, since a flat noisy field turned out to give upscale
      interpolation nothing to blend across) — then ran each through both
      the current order (`crop, scale, chromakey`) and the proposed order
      (`crop, chromakey, scale`) using the exact real color/similarity/blend
      values from Dan's log (`0x31a05b`/`0.2`/`0.1`).
    - Measured three ways: mean brightness and non-black-pixel % of the
      result composited over black (matching the real export's compositing
      model), plus a more sensitive direct read of the per-clip chain's raw
      **alpha channel** before compositing (a "hazy, partially keyed" pixel
      shows as a mid-range alpha value even where compositing over black
      would visually hide it). All three: **no measurable improvement from
      reordering** — differences were within noise (a fraction of a percent)
      and one measure (partial-alpha area) was marginally *worse* with the
      reorder, not better.
    - **Why the theory likely doesn't hold, worked out from the test:**
      bilinear/linear scaling of a smooth spatial gradient — which is what
      real, gradual green-screen lighting variance actually looks like —
      reproduces that gradient almost exactly; there's very little for
      "interpolation shifts the color" to act on except at sharp,
      high-contrast edges, and even there the effect is confined to a
      handful of edge pixels, not a wide area. That's consistent with the
      measured result but doesn't match Dan's reported symptom (washed-out
      across a broad area), which is the mismatch that makes this lead a
      dead end rather than a confirmed fix.
    - **A second, real reason not to apply this reorder even though it's
      "more correct on paper":** converting to straight (non-premultiplied)
      RGBA and then scaling *after* a partial chroma key — RGB channels are
      black in fully-transparent regions — is a known way to introduce dark
      edge fringing at partially-transparent boundaries that the current
      (scale-then-key) order doesn't have. Reordering without a demonstrated
      benefit would be trading an unconfirmed fix for a real new artifact
      risk. **Verdict: not applied — reported, not forced to look
      resolved, per the explicit ask.**
    - **Side-check while here (2026-09-14):** since "washed out" is also the
      textbook symptom of a limited/full color-RANGE mismatch (a completely
      different, simpler cause, unrelated to chroma key or scale order at
      all), did one isolated test: pushed a known solid color through the
      exact same `format=rgba → pad → format=yuva420p → format=yuv420p`
      chain the real export uses (chromakey removed, to isolate this from
      the filter-order question) and confirmed it round-trips the color
      correctly (within ±3, on a synthetic uncompressed source) — no
      evidence of a range bug in the app's own conversion chain. **Not
      conclusive** — a real captured/encoded source file carrying explicit
      range metadata could still behave differently on decode than a
      synthetic `lavfi color=` source does; this was a quick sanity check,
      not a full test of that hypothesis.
    - **No code changed this round.** `videoExportManager.ts`'s filter order
      is unchanged from the previous round's hardening fix (`overlay=
      format=auto` + re-asserted `format=yuva420p`).
    - **What's actually needed next:** two rounds of synthetic recreation
      (this one and the original battery of tests) have both failed to
      reproduce Dan's exact symptom. The remaining productive path is
      probably testing against Dan's *actual source file* (not just the
      diagnostics log/screenshots) run through the real export pipeline
      directly, rather than a third round of synthetic guessing.
  - Full log excerpts (both reverse-on and reverse-off versions, real
    filter_complex, FFprobe details, full FFmpeg args) available — see this
    round's chat history / Dan's two uploaded `export-diagnostics.log`
    files for the exact values if the version handed to the coding agent
    needs re-supplying.
  - **ROOT CAUSE CONFIRMED (2026-09-14) — reproduced for real, against Dan's
    actual source clip, actual project, and actual exported file.** Not
    another synthetic guess: this used the literal file at
    `assets\video\0befbb2c-dcaf-4ba3-8d20-fc1767bf1d1e.mp4` in Dan's real
    `just-a-test-fbcdb697` project, his exact settings (chromaKey
    `color=#31a05b similarity=0.2 blend=0.1`, crop `688x435` at `0,29`,
    scale to `1601x1080`), and — since both were still sitting in his
    Downloads folder — his own actual already-exported output file
    (`just a test-export_not reveresed.mp4`, the reverse-off run from the
    2026-09-14 diagnostics log above), not a re-generated stand-in.
    - **Why the first two rounds and this round's own first attempt all
      missed it: the symptom only shows up composited against a bright/busy
      background, not a flat black one.** Dan's real timeline (read
      directly from `editor/timeline.json`, not guessed) has a *second*
      clip — a colorful desert/pyramid background image on "Video 1"
      (`chromaKey.enabled=false`) sitting *underneath* the green-screen
      clip on "Video 2". Simulating the export against a plain black
      canvas (this round's own first pass, and almost certainly both prior
      synthetic batteries) produced what looked like a clean key — because
      a dark, partially-erased subject composited over black is nearly
      invisible. Re-run against Dan's *actual* background image, frame-by-
      frame decoding of the real exported MP4 shows it plainly: a pale,
      translucent ghost of Obi-Wan's head/hair/ear hovering over the
      pyramids — exactly "lighter/washed-out, not gone, not solid" as
      reported. (Screenshot captured this round for the record; not
      reproduced here as it's Dan's personal footage.)
    - **What's actually being erased, pixel-verified:** decoding the real
      per-clip RGBA alpha channel (before compositing, at 6 timestamps
      spanning the whole clip) shows the head/hair region is never fully
      opaque anywhere in the clip — 0% full-opacity coverage in a
      representative head-area box at every sampled frame, with large
      chunks (up to ~80% at some frames) fully erased (alpha=0), not just
      softened at the edges. This is FFmpeg's real `chromakey` filter
      keying out real, visibly non-green skin/hair/beard pixels (sampled
      RGB values like `(245,178,151)` — plain tan skin — and `(149,56,31)`
      — plain brown hair), not a thin anti-aliasing fringe.
    - **Confirmed by a direct similarity sweep on this exact real clip**
      (0.05/0.1/0.15/0.2/0.3, blend held at 0.1): the head-region's
      fully-opaque coverage drops from 92.7% (similarity=0.05) → 54.4%
      (0.1) → 1.8% (0.15) → **0.0% at Dan's actual 0.2** → 0.0% (0.3) —
      while the green background itself isn't even fully removed (only
      ~51–52% transparent) until similarity climbs past ~0.15. For this
      specific shot there is no similarity/blend value that both fully
      clears the green screen *and* leaves the actor intact — likely real,
      shot-specific green-screen lighting/color variance (and H.264
      compression) putting parts of the actor's actual coloring closer to
      the key color, in FFmpeg's real color-distance metric, than
      similarity=0.2 leaves room for. 0.2 is comfortably inside the app's
      allowed 0.01–1 range and doesn't look like an extreme value in the
      Clip Inspector's UI, but it's already well past the point where this
      footage's key starts eating the subject rather than just the
      background.
    - **Why this is invisible in the live preview, also pixel-verified, not
      guessed:** `PreviewPlayer.tsx`'s chroma-key implementation is a
      *different algorithm* from FFmpeg's real `chromakey` filter — plain
      RGB Euclidean distance to the key color with a hard cutoff (`similarity
      * 441.7`, either fully opaque or fully transparent, `blend` isn't
      used at all), versus FFmpeg's real YUV-chroma-plane-based graduated
      key. Running the preview's exact formula against the same real frame:
      at similarity=0.2 its threshold is 88.3 (out of a 0–441.7 RGB-distance
      scale), and the real head/hair pixels sit at RGB distances of
      ~150–210 from the key color — comfortably outside that threshold, so
      the preview leaves roughly 80% of the head fully untouched (matching
      Dan's "fully vivid/saturated" description) while the same nominal
      setting, run through FFmpeg's real metric, leaves 0% of it intact.
      **The two renderers don't just differ in fidelity — for this clip's
      settings they disagree about which pixels count as "close to the key
      color" at all,** so nothing in the live preview could have warned Dan
      that 0.2 was already destroying his subject on export.
    - **Filter order re-confirmed ruled out, this time on the real file:**
      re-ran the crop→chromakey→scale reorder (last round's tested-and-
      rejected theory) directly against this clip — the head-region mean
      alpha is statistically identical either order (34.2 vs 33.6 out of
      255); reordering doesn't touch this bug.
    - **Reverse:** already ruled out by Dan directly, unaffected by any of
      the above.
    - **Not applied this round, per the explicit ask to report rather than
      force a fix:** no changes to `videoExportManager.ts` or
      `PreviewPlayer.tsx`. This is a real, now-confirmed, two-part finding
      rather than a one-line patch: (1) this specific clip's green screen
      doesn't have a similarity/blend value that cleanly separates
      background from subject at all, and (2) independent of this clip,
      the live preview's simplified chroma-key algorithm cannot be trusted
      to show what FFmpeg's real chromakey will actually do, for *any* clip
      — a value that looks safe while tuning in the editor can silently
      destroy the subject on export. Fixing (2) means giving the preview a
      real graduated, YUV-chroma-based key (or otherwise reconciling it
      with FFmpeg's actual algorithm) rather than patching numbers, which
      is a meaningfully bigger, separate change — flagged for a dedicated
      round rather than attempted piecemeal here. Fixing (1) for this
      specific shot is a footage/lighting problem more than a code one
      (better lighting, spill suppression, or a lower similarity with
      accepted incomplete background removal), not something the app can
      fix in the abstract.
      **UPDATE (2026-09-14, later the same day): fixing (2) is now RESOLVED,
      built** — see this section's "New, DECIDED" entry below for the full
      build/verification writeup (`src/chromaKey.ts`, a real graduated
      YUV-chroma-based key, pixel-verified against real FFmpeg output).

**New, DECIDED (2026-09-14): scope and build the live-preview accuracy fix
now, not backlogged.** The live preview's chroma-key rendering must match
FFmpeg's real `chromakey` filter, not the current simplified
RGB-Euclidean-distance hard cutoff. Requirements:
- Study FFmpeg's actual `chromakey` filter implementation (its real
  YUV-chroma-plane-based distance formula and how `similarity`/`blend`
  produce a graduated alpha) rather than approximating from description —
  get the real math right, not a closer guess.
- Reimplement that algorithm in the preview's canvas-based compositing
  (not a background FFmpeg proxy render like the reverse-preview feature
  used — chroma key is tuned interactively via sliders, and a render
  round-trip per adjustment would be too slow for that workflow; this
  needs to stay real-time in JS/canvas).
- Use `blend` for real graduated partial-alpha, not just a hard cutoff —
  the current preview ignores `blend` entirely.
- **Verify correctness the same rigorous way item 3's root cause was
  found:** pixel-level comparison of the new preview algorithm's output
  against real FFmpeg `chromakey` output, on the same real frames, not
  just "looks similar." Test against Dan's actual problem clip specifically
  (it's a known real-world case where the two algorithms disagreed sharply)
  as well as a cleaner synthetic case.
- Goal: once this ships, a similarity/blend setting that looks safe in the
  live preview should reliably mean it's actually safe on export — closing
  the exact trust gap that let this whole bug hide for three rounds.

  **RESOLVED (2026-09-14), built.** New `src/chromaKey.ts` — a standalone,
  dependency-free module (`applyChromaKey(buffer, settings)`, operating on a
  plain `{width,height,data}` RGBA pixel buffer so it needs no real DOM
  `ImageData` and is directly unit-testable from Node) implementing FFmpeg's
  real `chromakey` filter algorithm, studied from `libavfilter/
  vf_chromakey.c` directly rather than approximated from the filter's
  documentation: distance is measured in YUV **chroma** (U/V) space only
  (never luma, never plain RGB) using the same BT.601 full-range RGB->YUV
  coefficients FFmpeg's own `RGB_TO_U`/`RGB_TO_V` macros use for the key
  color; each pixel's distance is averaged over a 3x3 neighborhood (a
  separable box blur in the implementation, for real-time performance, not
  a naive 9-sample-per-pixel loop); and `similarity`/`blend` produce a real
  graduated alpha (linear ramp between fully transparent and fully opaque)
  instead of the old hard RGB-Euclidean-distance cutoff, which ignored
  `blend` entirely. `PreviewPlayer.tsx`'s `drawClipVisual` now calls this
  instead of its old inline formula — one call-site change, no change to
  the canvas-tainted fallback behavior around it.
  - **A real methodology trap worth recording, not just the result:**
    partway through, a from-scratch empirical calibration against this
    app's own bundled `ffmpeg-static` binary (using synthetic flat-color
    test patches at controlled, known distances from the key color)
    disagreed with the literal transcribed source formula by a consistent
    ~5.7x scale factor — a serious enough discrepancy that the constant was
    changed to match the calibration at first. Retesting against a
    *realistic* clip (compressed, noisy, vignette-lit — not an isolated
    flat swatch) showed the "calibrated" constant was actually **worse**
    (18.1 mean alpha error vs. the original formula's 10.4) — tracked down
    to a real, physical effect rather than a bug: `diff` is a nonlinear
    function of noisy per-pixel chroma, and clamping the alpha ramp at 0
    means random noise (always present in real, compressed footage) pushes
    the *average* alpha up for any pixel already within one blend-width of
    the threshold — noiseless isolated calibration swatches can't see this,
    so they systematically under-measure real-world distance. The literal,
    three-times-independently-corroborated source formula was kept; the
    isolated-calibration detour is documented in `chromaKey.ts`'s header so
    a future round doesn't rediscover the same trap.
  - **Verification status:** `npm run typecheck` and `npm run build` both
    succeed. New `scripts/verifyChromaKey.mjs` (committed, runnable via
    `node scripts/verifyChromaKey.mjs`, no binary fixtures needed — it
    builds its own synthetic clip on each run via the bundled FFmpeg)
    pixel-compares the new algorithm's output against real FFmpeg
    `chromakey` output on a realistic synthetic clip (green screen,
    vignette-lit background, skin-tone subject box, per-pixel noise, real
    H.264 compression at CRF 18 — the same ingredients this project's own
    diagnostic rounds found necessary to reproduce realistic edge
    behavior), at Dan's actual real problem settings
    (`similarity=0.2 blend=0.1`) and at a cleaner, more typical setting
    (`similarity=0.1 blend=0.05`). Results: mean per-pixel alpha error
    dropped from 93.2/255 (old hard-cutoff algorithm) to 10.4/255 (new
    algorithm) at Dan's real settings — a **9x reduction** — and from
    185.2/255 to 0.3/255 (a **676x reduction**) at the cleaner setting,
    where the old algorithm's binary all-or-nothing cutoff was especially
    wrong. **Not done: testing against the literal file named in this
    round's ask** (`assets\video\0befbb2c-dcaf-4ba3-8d20-fc1767bf1d1e.mp4`
    in the `just-a-test-fbcdb697` project) — that project folder no longer
    exists in either current library location
    (`DansVideoEditor\Dan's Video Studio\Projects` or the OneDrive-redirected
    `Documents\Dan's Video Studio\Projects`) and isn't in the Windows
    Recycle Bin either; it was a throwaway diagnostic project (explicitly
    "no real data" per its own Completed Tasks entry above) and appears to
    have been deleted since that round. Its final *exported* output files
    are still sitting in Dan's Downloads folder (`just a test-export.mp4`,
    `just a test-export_not reveresed.mp4`) but those are already-composited
    final video, not useful for isolating one clip's own alpha channel.
    Verification instead used a realistic synthetic reconstruction built
    with Dan's exact real settings and the same class of problem (skin-tone
    subject vs. green background, compression noise) — see above. **Not
    yet done: a live UI click-through** confirming the preview now visually
    matches export on a real green-screen clip in Dan's hands — worth doing
    once he has a green-screen clip to try, alongside everything else still
    open in Phase 6.
- **Item 5 (library relocation): a real, serious bug — surfaced mid-move
  and needs to be the priority fix.** Dan's "Move Library" attempt threw
  `EPERM: operation not permitted, rmdir` on a `promptlab` folder inside a
  project named `dev-mode-test-1789254212537-dea1007f` — a name pattern
  (timestamp + random hex) that strongly suggests **leftover residue from
  a past automated test run, not one of Dan's real projects**, sitting
  inside his real library where it should never have been created in the
  first place. After the error, the app's UI lost track of Dan's real
  projects entirely ("Project not found"). **Confirmed with Dan: his real
  project files are still physically present** at the original default
  location — this is a UI/state bug, not data loss, but it needs to be
  treated with real urgency and real care given what's at stake. Root
  cause not yet confirmed, but the leading hypothesis: the persisted
  library-location preference is likely being committed (or the app's
  in-memory notion of "current root" is being switched) before every
  project has *actually* finished moving successfully, rather than only
  after full success with a clean rollback on any failure — so when the
  stray test project's move failed partway through, the app ended up
  looking for Dan's real projects in the wrong place even though they
  never left the original location. **Do not attempt "Move Library"
  again until this is fixed.**

  **RESOLVED (2026-09-13) — root cause found by actual disk inspection, not
  the hypothesis above.** The persisted preference was in fact never
  switched (that part of the original hypothesis was backwards) — the real
  problem was that the bulk `fs.rm(recursive, force)` fallback, on hitting
  the one locked file, had already destroyed files belonging to other, real
  projects before the throw surfaced, at the location the app correctly
  kept pointing at. Also correcting this file's earlier claim that "his
  real project files are still physically present at the original default
  location" — direct inspection found the opposite: that location was left
  with 0 files anywhere, just empty directory shells; the real data's
  survival was thanks to the full copy `copyRecursive` had already written
  to the move's *destination* moments before the delete ran, not anything
  intact at the original spot. See "Phase 6 continued — Dan's first-pass
  findings, addressed" above for the full recovery and the actual code
  fix — both done.

**Two more gaps identified (2026-09-13), added to Phase 6's scope before
Phase 7 starts** — not originally specified anywhere, genuinely overlooked,
not decided against. Speed adjustment (also asked about) turned out to
already be built — see above, the Clip Inspector's `speed` field. Audio
extraction is real, new work, confirmed with Dan to cover **both** of the
following, not just one:
1. **Extract audio from an imported video asset into a new standalone
   audio asset.** An "Extract Audio" action (Assets tab / Media Library) on
   a video asset that runs FFmpeg (`-vn`) to pull its audio track out into
   a real new audio asset file — added to `assets/audio/` and `assets.json`
   like any other imported asset, so it can be used anywhere an audio asset
   can: linked to a shot, a scene's songs, an SFX entry, or dragged onto an
   editor audio track.
2. **Extract a clip's audio onto its own audio track within the timeline
   editor.** For a video clip already placed on the timeline, an action
   that detaches its audio into a new, independent clip on an audio track
   at the same timeline position — carrying over the video clip's current
   trim/speed so the two stay in sync at the moment of extraction, but
   editable independently (volume/fades/trim) from then on. The video
   clip's own "include this clip's audio" toggle should switch off
   automatically when its audio is extracted this way, so the sound isn't
   doubled.

**Eight more items from Dan's own testing pass (2026-09-13), added to Phase
6's scope before Phase 7 starts.** Everything else in Phase 6 worked fine
per Dan directly — these are additions/fixes on top of that, not signs the
rest is broken. Reporting each separately, as usual:

3. **BUG, confirmed real by Dan — chroma key breaks specifically on
   export, not preview.** Consistent in both VLC and Windows Media Player,
   every time, not intermittent. Symptom: keyed-out areas render as opaque
   **black** in the exported file instead of transparent — with nothing
   beneath the keyed clip, the result is mostly a black screen; with
   another clip beneath it, the keyed clip's black areas fully cover it
   rather than letting it show through. **Diagnosis, not yet confirmed by
   code inspection:** this pattern strongly suggests an alpha-channel/pixel
   -format problem in the FFmpeg `filter_complex` chain — the `chromakey`
   filter's alpha output likely isn't surviving through to the `overlay`
   step (e.g. an implicit format conversion drops alpha along the way, or
   the chain isn't consistently using an alpha-carrying pixel format like
   `yuva420p`/`rgba` end-to-end). The engine-level test that shipped with
   Phase 6 only FFprobed stream presence/duration, not actual pixel/alpha
   correctness, which is how this got through unverified — fix needs a
   real check of exported pixel data (or at minimum a visual inspection),
   not just "the filter graph compiles and FFprobe sees a video stream."
   Priority: this is a real regression in a feature that was reported as
   built, not a nice-to-have.
4. **WITHDRAWN (2026-09-13) — not a real gap, was a misunderstanding.**
   Dan initially thought text overlay creation routed through the
   Assets/import flow. On closer look, he found the direct-add path
   already exists — he'd been clicking "+ Overlay" expecting it to add a
   text clip directly, when that button actually adds a new overlay
   *track* (a line to hold clips), not a text clip itself. No code change
   needed here; leaving this entry as a record of the false alarm rather
   than deleting it outright, per this project's habit of tracking what
   was actually resolved vs. what's still open.
5. **Choose the library's location.** DECIDED (2026-09-13): add a Settings
   option to relocate the entire `Dan's Video Studio/Projects` library root
   to a folder Dan picks — an actual migration of existing project data to
   the new location, not just pointing at a new empty folder going forward.
   Motivation: the default (deep inside the OS's Documents folder) is
   buried too deep for Dan's liking.
6. **Choose export destination per-export.** DECIDED (2026-09-13): the
   Export dialog gets a destination choice — default to the project's own
   `exports/` folder (so Media Library keeps tracking it, per Dan's
   "both places" answer being really "give me the choice each time," not
   "always both"), or pick a different folder for that specific export.
7. **Direct-manipulation editing on the preview.** Drag a clip directly on
   the Preview Player canvas to move/reposition it, and drag handles to
   crop — as an addition to the Clip Inspector's numeric fields, not a
   replacement (numeric entry stays for precision when wanted).
8. **Right-click context menu on a clip.** Common actions (split at
   playhead, delete, duplicate, extract audio per item 2 above, etc.)
   available via right-click, instead of only through the Inspector panel.
9. **Reverse and mirror/flip clips.** Two new clip properties — needs both
   preview support and real FFmpeg export support (a reverse filter for
   the former, `hflip` for the latter).
10. **Playhead/scrub-head drag precision.** Dan finds it hard to land the
    playhead exactly where he wants by dragging. Related to, but distinct
    from, the pre-existing unconfirmed "trim-drag gesture feel" question
    from Phase 6's original verification (see Completed Tasks above) —
    both are drag-precision issues but on different controls (playhead vs.
    trim handles). Recommended default, not yet confirmed with Dan:
    timeline zoom controls plus a live time readout while dragging (either
    the playhead or a trim handle), so exact positioning doesn't depend on
    pixel-perfect mouse accuracy at whatever zoom level happens to be
    active. Revisit if this doesn't turn out to be what actually helps.

**Real reverse live preview via a pre-rendered proxy — RESOLVED (2026-09-13),
built.** Was DECIDED (build now, not backlog) in this same round; now built
— see "Phase 6 continued — real reverse live-preview proxy" in Completed
Tasks above for the full record, including a pixel-level verification pass
(29 assertions) confirming genuine frame-order reversal, stale-proxy
regeneration on a trim change, and cleanup on reverse-off/delete/duplicate.
Mirror needed no change, as already decided — its live preview already
works correctly via a CSS flip. **Not yet confirmed: Dan's own click-through**
(turn Reverse on, watch it generate, confirm the preview plays backwards
once ready) — add this to the list of things worth trying during his next
Editor-tab pass, alongside everything else still open in Phase 6.

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

Full phased roadmap, in order — Phase 7 (Export Tools, above) is now
current; each phase below stays deferred until the prior one is
functional:

1. **Phase 8 — Smarter Assistance** *(originally Phase 7).* Use the
   accumulated Grok/Suno/SFX prompt history to recommend techniques based on
   what's actually worked before, rather than generating cold suggestions
   each time. Considered the most distinctive long-term feature of the
   whole project — and now directly builds on Phase 4's AI Assistant/API
   plumbing rather than needing its own from scratch.
2. **Audio editor within the Media Library.** DEFERRED (2026-09-13), not
   decided against — Dan explicitly flagged this as "not necessarily now,"
   a future idea rather than something to scope immediately. Not yet
   detailed: what actual editing it should support (trim/fade/volume/
   normalize on an audio asset directly from its Media Library card, versus
   something closer to a full waveform editor) hasn't been discussed.
   Scope this properly when Dan wants to pick it up.
3. **An iPad-usable version of the planning/scripting side** (Idea,
   Script, Scenes & Shots, Prompt Lab — explicitly not the video editor or
   heavy media files, which would stay desktop-only). Raised 2026-09-14;
   **DEFERRED, "keep it as an idea for later," explicitly NOT decided to
   proceed** — Dan chose not to formally reverse the standing "no
   cloud/no mobile" decision below yet. Worth remembering if this does get
   picked up later: it's a genuinely different scope of undertaking than
   everything else in this roadmap — not a feature addition to the
   existing Electron app, but a second, separate front-end (Electron
   doesn't run on iPadOS at all) backed by a real hosted database/API for
   sync, which is a new ongoing cost and a new class of problem (what
   happens when the same project is edited on both devices) this project
   hasn't had to deal with before. Revisit and properly scope only if/when
   Dan actually wants to move on it — don't let it half-live here as a
   vague someday item. **Re-added 2026-09-14 after this item was found
   missing from a file upload — worth double-checking future uploads
   against what's expected to be here, since this isn't the first time a
   scoped addition didn't make it into what came back from a coding
   round.**

**DECIDED: explicitly out of scope, indefinitely** (not "later," genuinely
declined) — cloud service, mobile app, social/collaboration features, a
CapCut-style template marketplace, hundreds of filters, built-in
Grok/Suno generation via API, and any "gigantic AI suite" scope expansion.
**Still stands as of 2026-09-14** — the iPad idea above was raised and
explicitly not chosen to reverse this, see item 3.

Technical Notes / Blockers

- **CONFIRMED to have resurfaced (2026-09-13): chroma-key-on-export bug
  (item 3), same symptom, on Dan's real project — no longer just a
  hypothetical "if it resurfaces."** See "Phase 6 continued" in Completed
  Tasks above for everything that *was* tested last round (multi-track
  stacking, letterboxing, transitions, speed+fades, realistic noisy
  footage — all composited correctly against this machine's exact bundled
  FFmpeg build) and the one concrete hardening fix that shipped anyway
  (`overlay=format=auto` plus re-asserting `format=yuva420p` end-to-end in
  `videoExportManager.ts`). **Next step, per this project's habit of
  getting real diagnostic data rather than guessing again:** add temporary
  diagnostic logging to the actual export path — the full generated
  `filter_complex` string, plus FFprobe'd codec/pixel format/resolution for
  every source clip involved — so Dan's own reproduction produces real
  evidence to act on. Also worth capturing when he reproduces it: his
  project's canvas resolution, the chroma key color/similarity/blend
  values, whether the keyed clip is on a video or overlay track, whether a
  transition is involved, and ideally the actual source clip (or a short
  trimmed copy) rather than just a description, since a synthetic
  same-shape test clip still hasn't triggered it. Worth checking Dan's
  installed `ffmpeg-static` binary's exact reported version too (`ffmpeg
  -version` via the app's bundled copy) in case it differs from the
  6.1.1-essentials_build used for prior testing.
  **UPDATE (2026-09-13): the diagnostic logging described above is now
  built** (`videoExportManager.ts`/`mediaProbe.ts` — see "Phase 6
  continued — Dan's first-pass findings, addressed" in Completed Tasks) —
  still waiting on Dan's real reproduction to actually produce a log to act
  on; this note's "next step" is now literally the next step, not a plan.
  **UPDATE (2026-09-14): the log arrived and ruled out `reverse` as the
  cause (confirmed independent of it); the filter-order (chromakey-before-
  scale) lead built from that log was tested with real pixel-level
  verification and did NOT hold up — see Current Objective's Item 3 above
  for the full test writeup, including a quick side-check that ruled out a
  color-range mismatch too.** Two rounds of synthetic recreation have now
  both failed to reproduce Dan's exact symptom. **Next step has changed:**
  stop trying to reconstruct it synthetically a third time — get Dan's
  actual source clip (or a short trimmed copy of it) and run it through the
  real export pipeline directly, since the diagnostics log alone wasn't
  enough to pin this down without the real footage's actual pixel data.
  **UPDATE (2026-09-14, same day): ROOT CAUSE CONFIRMED, against Dan's
  actual source clip and actual project this time — see Current Objective's
  Item 3 above for the full pixel-verified writeup.** Two-part finding: (1)
  this specific green-screen shot has no `similarity`/`blend` value that
  cleanly separates the background from the actor — at Dan's actual
  similarity=0.2, FFmpeg's real `chromakey` filter already erases 100% of a
  representative head-area box's full-opacity coverage (verified by
  decoding the real alpha channel across the whole clip), and (2) the live
  preview never showed this because `PreviewPlayer.tsx`'s chroma-key
  algorithm is a structurally different one from FFmpeg's real filter (hard
  RGB-distance cutoff, no blend, vs FFmpeg's graduated YUV-chroma key) —
  the same nominal settings mean very different things to each renderer.
  **No code changed this round, per the explicit ask to report rather than
  force a fix** — both the "make the preview trustworthy" fix (give it a
  real graduated/YUV-based key matching FFmpeg) and the "this shot needs
  better lighting/a different similarity" fact are real next steps, but
  neither is a safe one-line patch to land alongside just having found
  this.
  **UPDATE (2026-09-14, later the same day): the "make the preview
  trustworthy" half is now RESOLVED, built.** `src/chromaKey.ts` reimplements
  FFmpeg's real YUV-chroma-based, graduated-`blend` algorithm and
  `PreviewPlayer.tsx` now uses it — see Current Objective's live-preview
  accuracy fix entry above for the full build/verification writeup (a 9x
  reduction in measured pixel-level alpha error on a realistic synthetic
  clip at Dan's real problem settings). The "this shot needs better
  lighting/a different similarity" half remains a footage problem, not a
  code one, and stays as-is — nothing to fix there.
- **NEW, urgent (2026-09-13): library relocation (item 5) has a real bug
  that left Dan's real project list broken in the UI, though his files are
  confirmed physically safe.** See Current Objective above for the full
  incident writeup — the leading hypothesis is that the persisted
  library-location preference (or the app's in-memory "current root") gets
  switched before every project has actually finished moving successfully,
  rather than only after full success with a clean rollback on any
  failure. Compounding factor: the project that failed to move
  (`dev-mode-test-1789254212537-dea1007f`) has a name pattern strongly
  suggesting it's leftover residue from a past automated test run that got
  created inside Dan's real library rather than a scratch folder — worth
  auditing whether other past test rounds left similar residue behind, and
  tightening test discipline everywhere (not just item 5's own test, which
  was already rewritten to use a synthetic scratch fixture after a
  near-miss during its own development) so tests can never again write
  into the real library. **Immediate priorities, in order:** (1) get Dan's
  real project list showing correctly again — likely means resetting the
  persisted library-location preference back to the real default location
  where his files actually are; (2) fix the root cause so a partial-failure
  relocation can never again leave the app pointing at the wrong place;
  (3) find and remove the leftover stray test project (after confirming
  with Dan it isn't his); (4) audit for other stray test-residue projects
  from past rounds. Dan should not attempt "Move Library" again until this
  is fixed.
  **RESOLVED (2026-09-13):** all four priorities above are done — see
  "Phase 6 continued — Dan's first-pass findings, addressed" in Completed
  Tasks for the full writeup. Correcting two things this note got wrong,
  found only by actually inspecting the real disk rather than reasoning
  about it: (1) the persisted preference was *never* actually switched —
  that leading hypothesis was backwards; the real damage was to the *data*
  at the location the app correctly kept pointing at, not to the pointer
  itself. (2) His real files were **not** still at the original default
  location by the time this was investigated — that location had 0 files
  anywhere left in it. What actually saved his data was an intact copy
  `copyRecursive` had already written to the move's destination
  (`C:\Users\danmo\DansVideoEditor\Dan's Video Studio`) moments before the
  destructive delete ran there. The app now points at that copy. 9 stray/
  residue project folders (7 matching this file's own documented
  Playwright-test naming pattern, 2 small empty unlabeled ones) were
  deleted from both locations with Dan's explicit go-ahead — his project
  list is now exactly "sfh" and "teafa". **CONFIRMED (2026-09-13): these
  two were also just testing/feature-trying projects, not real work — no
  actual data was ever at risk in this whole incident.** Root cause is
  still worth having fixed regardless, since real project data will exist
  eventually: every project now moves individually with per-project
  verification, and the preference switches only once *every* project is
  confirmed fully moved, with a clean rollback (restoring the old location
  exactly) on any failure — verified against a synthetic fixture
  reproducing the original failure mode exactly (see Completed Tasks). Dan
  can try "Move Library" again whenever he wants; a real click-through of
  the fixed version in the live app (as opposed to the synthetic-fixture
  verification this round used) is still worth doing once he has a moment,
  though there's no urgency now that it's confirmed nothing real was ever
  on the line.
- **Safety lesson from testing item 5 (library relocation) — worth keeping
  on record.** An early draft of this round's relocation test ran
  `relocateLibrary` directly against the real default library location to
  set up its own fixture; combined with this machine's OneDrive-redirected
  Documents folder holding a locked leftover file (from an *earlier*
  session's test cleanup, unrelated to this feature), the copy-then-delete
  fallback path threw partway through deleting the original, before the
  test's own cleanup ran. The real library was confirmed fully intact
  afterward — a `rename` is tried first, and nothing was actually lost, just
  copied and then not-fully-deleted from the original spot — but the test
  was rewritten to build an entirely synthetic fixture under the scratchpad
  instead, specifically so a test of a destructive-by-design feature can
  never touch real user data even in a failure path. Apply the same caution
  to any future test of the relocation feature (or anything else that
  operates on the whole library root, not just one project).
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
  **RESOLVED (2026-09-13):** these (plus more of the same pattern from a
  later round) turned out to be exactly what got tangled up in the library-
  relocation incident — deleted for good this time, with Dan's explicit
  go-ahead, as part of that fix. See "Phase 6 continued — Dan's first-pass
  findings, addressed" in Completed Tasks.
- **Stale duplicate "teafa" project folder at the OLD (pre-relocation)
  default library location (2026-09-14) — CLOSED, confirmed harmless test
  data, not investigated further.** Noticed while cleaning up this round's
  own autosave-fix verification's throwaway test project (which this round
  deliberately ran against an isolated, throwaway `--user-data-dir`,
  specifically to avoid any risk of colliding with Dan's real,
  possibly-already-open app/library — see the URGENT item's verification
  write-up above) — a `teafa-3382c3aa` folder still exists under
  `Documents/Dan's Video Studio/Projects/` (the pre-relocation default
  location) even though Dan's library was relocated to
  `DansVideoEditor\Dan's Video Studio` and that same `teafa-3382c3aa`
  project exists there too. Initially flagged as a separate task pending
  investigation (which copy is authoritative), out of caution since it
  looked like real project data — **Dan confirmed directly it's just test
  data, doesn't matter.** Attempted to delete the stale copy directly as
  cleanup; this sandbox's permissions blocked deleting outside the repo
  (same restriction noted elsewhere in this file), so it's still sitting
  there — harmless, safe to delete via the OS or the app's own "Delete
  Project" whenever convenient, not worth further attention.
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
