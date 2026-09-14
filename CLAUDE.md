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
renderer. **As of Phase 6:** FFmpeg/FFprobe are bundled via the
`ffmpeg-static`/`ffprobe-static` npm packages (resolved in
`electron/videoRuntime.ts`) — Dan needs no system FFmpeg install. The
renderer plays media (for the editor's live preview) through a privileged
`media://` protocol (`electron/mediaProtocol.ts`), never via a raw `file://`
path, so canvas pixel access (chroma-key preview) isn't blocked by the
browser treating it as cross-origin.

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
  script/scenes/shots the same way — a shot's `linkedAssetId` is its single
  primary generated clip, and (as of the Phase 5 SFX-merge round) its
  separate `linkedSfxIds` is an uncapped list into the unified SFX system; a
  scene's `linkedSongAssetIds` is likewise an uncapped list of song asset
  ids. `electron/promptLabManager.ts` (`PromptLabManager` class) owns the
  Grok/Suno prompt-history subsystems (one manager, parameterized by `kind`,
  rather than duplicating near-identical code — see its file header).
  `electron/sfxLibraryManager.ts` (`SfxLibraryManager` class) owns the
  unified SFX system — as of the same round, this merges what used to be
  two separate Phase 3 subsystems (the tagged SFX library and the
  ElevenLabs prompt-lab kind) into one: every entry has a `source`
  (`licensed` or `elevenlabs`) and, regardless of source, the same
  prompt/search-term field, version history, ratings, and
  recipe-promotion — see that file's header comment for the shape and its
  one-time data migration of pre-merge projects.
  `electron/mediaLibraryManager.ts` (`MediaLibraryManager` class) is a
  read-only Phase 5 aggregator with no JSON file of its own — it just
  cross-references the other three managers' data (which asset is linked
  from which shot/scene/prompt-entry/rating/SFX-entry) into one searchable
  view, plus a plain listing of the `exports/` folder. `electron/
  editorManager.ts` (`EditorManager` class) is Phase 6's addition — it owns
  the video-editor timeline (tracks/clips/project canvas settings; see that
  file's header comment for the full shape) the same way every other
  manager owns its slice, and `electron/videoExportManager.ts`
  (`VideoExportManager` class) is the one place that actually shells out to
  FFmpeg, turning a timeline into a real MP4 via a generated
  `filter_complex` (see that file's header comment for the compositing
  model — crop/scale/position/chroma-key/fades per clip, `xfade`/
  `acrossfade` for transitions, `overlay`/`amix` to composite). Both are
  supported by small single-purpose files: `electron/mediaProbe.ts`
  (FFprobe metadata lookups), `electron/videoRuntime.ts` (resolves the
  bundled FFmpeg/FFprobe binaries), `electron/mediaProtocol.ts` (the
  `media://` protocol the renderer's preview player uses to actually play a
  file), (Phase 6 continued) `electron/audioExtractor.ts` (the one
  other FFmpeg call site besides `VideoExportManager` — pulls a file's
  audio track out via `-vn`, used by `ProjectManager.extractAudioAsset`'s
  "Extract Audio" asset action), and `electron/reverseProxyManager.ts` (a
  third FFmpeg call site — renders a clip's reverse live-preview proxy;
  `EditorManager`'s "Reverse live-preview proxies" section owns *when* one
  gets (re)generated/deleted, this file only knows *how* to render one).
  Library relocation splits the same way:
  `electron/libraryLocation.ts` is pure preference-reading (where the
  library currently lives — a small JSON file under Electron's userData
  folder, read by `projectPaths.ts`'s now-async `projectsRoot()`) and
  `electron/libraryRelocationManager.ts` (`LibraryRelocationManager` class)
  is the one place that actually moves the data. All storage managers share
  project-folder resolution and generic JSON read/write helpers from
  `electron/projectPaths.ts` and `electron/fsUtils.ts` rather than
  duplicating them. `electron/main.ts`
  just wires `ipcMain.handle` calls to whichever manager owns that data
  (plus, for the export's progress bar, one `webContents.send` per progress
  tick). The renderer only ever calls `window.api.*` methods (typed in
  `src/api.d.ts`, which mirrors the preload's shape) and renders what comes
  back — no fs/path logic in `src/`. The one deliberate exception:
  `electron/shotStatus.ts` (the fixed shot-status sequence and labels),
  `electron/promptLabTypes.ts` (Grok/Suno rating dimensions and lab
  labels), `electron/sfxTypes.ts` (SFX source labels and rating
  dimensions), and `electron/editorTypes.ts` (the timeline/clip/transition
  shape and a few fixed lookup tables) have no Node/Electron imports, so the
  renderer imports them directly instead of duplicating that data — see
  each file's header comment.
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
  Phase 2 script/scenes/shots data), and `promptlab/` (Grok/Suno prompt
  histories + recipes, one JSON file pair per lab, plus the unified SFX
  system's `sfxEntries.json`+`sfxRecipes.json`). A project built before the
  Phase 5 SFX merge may still have leftover `sfxLibrary.json`/
  `elevenlabsPrompts.json`/`elevenlabsRecipes.json` files sitting alongside
  the new ones — `SfxLibraryManager` migrates their data into the unified
  files the first time it touches that project, then leaves the old files
  in place unread rather than deleting them (see that file's header
  comment). `editor/timeline.json` (Phase 6 — the video-editor timeline:
  tracks, clips, project canvas settings; see `EditorManager`'s header
  comment), `editor/proxies/` (cached reverse live-preview proxies, one
  small `.mp4` per clip currently rendered — see `EditorManager`'s "Reverse
  live-preview proxies" section), and `exports/` (no longer just a
  placeholder — Phase 6's MP4 export writes real files here, which Phase 5's
  Media Library already
  lists generically).
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
rather than blocking anything. **Phase 5 (Media Management)** is now fully
confirmed by Dan's own click-through, including all three items its scope
grew to cover: Grok/Suno asset-linking, the unified SFX system (merging
the old SFX library and ElevenLabs into one, with a `source` field and
universal ratings/prompt-search-term/version history/recipes regardless of
source), and uncapped multi-linking (shots → multiple SFX, scenes →
multiple songs). See TODO.md's Completed Tasks for the full record.

**Phase 6 (Video Editor)** — multi-track editing (video/audio/overlay),
trimming/splitting/rearranging clips, text/title overlays, fades,
volume, chroma key, crop/scale/position, speed, a curated set of basic
transitions, and real MP4 export via a bundled FFmpeg — is built and
dev-tested (including a Claude-driven UI click-through of the actual app)
but **not yet confirmed by Dan's own hands**, so it's still the current
objective; Phase 7 doesn't start until that happens. **Nine more items were
added to this phase's scope (2026-09-13), and are now all built too** (a
tenth, a text-overlay flow fix, was withdrawn — turned out to be a
misunderstanding, not a real gap): two audio-extraction features (a
standalone-asset action on the Assets tab, and a timeline-clip context-menu
action that needs no new file since it just points a new audio-track clip
at the same source asset); the chroma-key-on-export bug got real diagnostic
work (a battery of real-pipeline, pixel-verified tests — none reproduced
Dan's exact symptom on this machine's bundled FFmpeg build) and one
concrete hardening fix regardless (`overlay=format=auto` plus consistently
re-asserting an alpha-carrying pixel format through the whole compositing
chain, since the previous code's reliance on the `overlay` filter's
non-alpha default format was real); a Settings library-relocation option
with a genuine data migration (`electron/libraryLocation.ts` +
`libraryRelocationManager.ts` — `projectPaths.ts`'s root is now async and
reads that preference); a per-export destination choice; direct-manipulation
editing on the Preview Player (drag to move, drag corner handles to crop —
a plain DOM overlay atop the `<canvas>`, not canvas-drawn); a right-click
context menu on clips (split/duplicate/extract audio/delete, via new
`EditorManager.duplicateClip`/`extractClipAudio`); reverse/mirror clip
properties (`Clip.reverse`/`mirror`, both with real FFmpeg export support —
`reverse`/`areverse`/`hflip` — and mirror also previewing correctly live;
reverse has no live-preview equivalent, a documented simplification since
browsers can't play `<video>` backwards); and playhead drag-precision via
scrub-to-seek plus a live time-readout tooltip while dragging the playhead
or a trim handle. **A further round on 2026-09-13** addressed Dan's own
first click-through findings on those nine items: a real, serious library-
relocation bug (found and fixed by direct disk inspection — a bulk
whole-library delete could partially destroy real project data when it hit
one locked file elsewhere; `libraryRelocationManager.ts` is rewritten to
move/verify one project at a time with a clean rollback on any failure, and
Dan's actual project list — down to just his two real projects, "sfh" and
"teafa," after clearing out a pile of old test-residue folders — has been
recovered and repointed at the intact copy); temporary diagnostic logging
for the still-unresolved chroma-key-on-export bug (`videoExportManager.ts`/
`mediaProbe.ts` now log the full `filter_complex` and every source clip's
FFprobe'd codec/pixel-format/resolution on every export, waiting on Dan's
real repro to produce a log to act on); and a small visible timeline badge
for the Reverse/Mirror clip properties, so a checked setting is confirmed
without needing to export first. **Confirmed (2026-09-13): "sfh" and
"teafa" were also just test/feature-trying projects — no real project data
was ever actually at risk in the library-relocation incident.** **A real
live preview for Reverse (not just the badge) is now built too:** a
background-rendered proxy — reverse a clip's currently-trimmed range into a
small cached file under `editor/proxies/` and preview that instead, since
browsers can't play video backward directly — regenerating automatically if
the trim changes and cleaning itself up on reverse-off/clip-delete/
duplicate (project-delete needs no special handling, since the whole
project folder is trashed as one unit). Verified with a pixel-level scripted
test (decoding real frames, not just checking FFmpeg's exit code) confirming
genuine frame-order reversal — see TODO.md's Completed Tasks for the full
record. Mirror needed no equivalent work; its live preview (a CSS flip)
already works correctly. **Chroma-key-on-export (2026-09-14 round):** Dan's
real diagnostic log ruled out `reverse` as a cause (re-tested with reverse
off, same washed-out result — it's the original bug on its own). The
filter-order lead it suggested (chroma key applied after scaling, so
upscale interpolation could shift keyed pixels off-color) was tested with
real pixel-level verification — decoding actual output pixels/alpha values
from real, compressed, realistically-lit synthetic footage, not just
compiling the filter graph — and did **not** hold up: reordering
(`crop, chromakey, scale` instead of `crop, scale, chromakey`) produced no
measurable improvement across three separate measurements, and it would
also introduce a real, separate edge-fringing risk (scaling straight RGBA
after a partial key can darken semi-transparent edges) with nothing to show
for the trade. **Not applied** — `videoExportManager.ts`'s filter order is
unchanged. See TODO.md's Current Objective (Item 3) for the full test
methodology and results, and Technical Notes for what's actually needed
next (Dan's real source clip, not another synthetic reconstruction — two
rounds of those have now failed to reproduce his exact symptom). See
TODO.md's Current Objective and Completed Tasks for the full per-item
record, including Dan's own click-through of the reverse preview, which is
still outstanding.
