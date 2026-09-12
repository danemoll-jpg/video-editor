Active Development Plan

Completed Tasks

None yet — project is in initial planning stage.

Current Objective (Focus Area)

**Phase 1 — Dan Video Studio foundation.**

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

**Phase 1 scope (current focus):** Projects, project files, basic UI, and
asset storage. A project (e.g. "Abi & Dan – Forest Story") holds its script,
scenes, shots, prompts, generated videos/images, music, SFX, editing
timeline, notes, and exports — all organized automatically so file naming
doesn't degenerate into `final_v2_FINAL_really-final-use-this-one.mp4`.

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

Full phased roadmap, in order — each phase deferred until the prior one is
functional:

1. **Phase 2 — Production Planning.** Scripts, scenes, shots, and
   production status tracking (Planned → Prompt Ready → Generated →
   Imported → Edited → Complete per shot).
2. **Phase 3 — Prompt/Asset Lab.** Grok Prompt Lab (full prompt history,
   per-clip ratings across character consistency/motion/camera
   behavior/prompt obedience/visual quality, version comparison, and
   promotion of successful wording into reusable "recipes" — this is where
   the original Prompt/Continuity Tracker plan lives now, expanded); Suno
   Music Lab (same pattern — prompt/lyrics/settings history, ratings,
   version comparison, reusable Music Recipes); SFX library (tagged, licensed
   free-source assets with attribution tracking); ElevenLabs SFX prompt
   history (same history/ratings pattern as Grok and Suno).
3. **Phase 4 — Media Management.** Unified searchable library across video
   clips, images, music, SFX, generated assets, and exports, tied back to
   the projects/scenes/shots where each was used.
4. **Phase 5 — Video Editor.** The actual editing layer: multiple
   video/audio tracks, trimming/splitting, rearranging clips,
   overlays/text/titles, fades/dissolves, volume control, green
   screen/chroma key, cropping/scaling/positioning, speed adjustment, basic
   transitions, MP4 export. Deliberately not a CapCut feature clone — scoped
   to what this workflow actually needs. Acknowledged as the largest,
   highest-effort phase.
5. **Phase 6 — Export Tools.** MP4, GIF, still-frame, and clip exports as
   first-class features (GIF maker: select part of a clip/timeline → choose
   dimensions/FPS/quality/looping — not buried in a submenu).
6. **Phase 7 — Smarter Assistance.** Use the accumulated Grok/Suno/SFX
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
