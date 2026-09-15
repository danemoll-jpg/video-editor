import { useEffect, useState } from 'react'
import type { Asset, Scene, SfxEntry, Shot } from '../api'
import SceneCard, { type SceneUpdates } from './SceneCard'
import type { ShotUpdates } from './ShotCard'
import type { SubTab as PromptFocusKind } from './PromptLab'
import { RATING_DIMENSIONS } from '../../electron/promptLabTypes'
import { SFX_RATING_DIMENSIONS } from '../../electron/sfxTypes'
import { assembleDraftRequest, buildTechniqueContext } from '../labContext'

interface Props {
  projectId: string
  assets: Asset[]
  /**
   * Called with a shot/scene's linked (or newly created) Prompt Lab / SFX
   * entry id once ready to navigate there. `armAutoInsert` is true only on
   * a fresh first-click draft (a brand-new entry, its draft request just
   * placed unsent into the AI Assistant composer) — see
   * `handleDraftGrokPrompt`/`handleDraftSunoPrompt`/`handleDraftSfxPrompt`
   * below — so the landing panel knows to auto-insert the *next* AI reply
   * into this entry's prompt field instead of the normal manual-Insert
   * flow. A plain navigate to an already-linked Grok entry passes `false`.
   */
  onOpenPromptEntry: (kind: PromptFocusKind, entryId: string, armAutoInsert: boolean) => void
}

/** Style notes, formatted as a context block for a composed draft request — empty string if there are none. */
function styleContextBlock(styleContent: string): string {
  const trimmed = styleContent.trim()
  return trimmed ? `Project style notes (from the Style tab):\n${trimmed}` : ''
}

export default function SceneList({ projectId, assets, onOpenPromptEntry }: Props) {
  const [scenes, setScenes] = useState<Scene[]>([])
  const [shots, setShots] = useState<Shot[]>([])
  const [sfxEntries, setSfxEntries] = useState<SfxEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newSceneTitle, setNewSceneTitle] = useState('')
  const [addingScene, setAddingScene] = useState(false)
  const [draftingGrokPromptShotId, setDraftingGrokPromptShotId] = useState<string | null>(null)
  const [draftingSunoPromptSceneId, setDraftingSunoPromptSceneId] = useState<string | null>(null)
  const [draftingSfxPromptShotId, setDraftingSfxPromptShotId] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    try {
      const [s, sh, sfx] = await Promise.all([
        window.api.listScenes(projectId),
        window.api.listShots(projectId),
        window.api.listSfxEntries(projectId),
      ])
      setScenes(s)
      setShots(sh)
      setSfxEntries(sfx)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  async function guard(action: () => Promise<void>) {
    try {
      await action()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleAddScene() {
    if (!newSceneTitle.trim() || addingScene) return
    setAddingScene(true)
    await guard(async () => {
      setScenes(await window.api.createScene(projectId, newSceneTitle))
      setNewSceneTitle('')
    })
    setAddingScene(false)
  }

  function handleDeleteScene(sceneId: string) {
    if (!window.confirm('Delete this scene and all of its shots? This cannot be undone.')) return
    guard(async () => {
      const result = await window.api.deleteScene(projectId, sceneId)
      setScenes(result.scenes)
      setShots(result.shots)
    })
  }

  function handleMoveScene(sceneId: string, direction: 'up' | 'down') {
    guard(async () => setScenes(await window.api.moveScene(projectId, sceneId, direction)))
  }

  function handleUpdateScene(sceneId: string, updates: SceneUpdates) {
    guard(async () => setScenes(await window.api.updateScene(projectId, sceneId, updates)))
  }

  function handleAddShot(sceneId: string, title: string) {
    guard(async () => setShots(await window.api.createShot(projectId, sceneId, title)))
  }

  function handleUpdateShot(shotId: string, updates: ShotUpdates) {
    guard(async () => setShots(await window.api.updateShot(projectId, shotId, updates)))
  }

  function handleDeleteShot(shotId: string) {
    if (!window.confirm('Delete this shot?')) return
    guard(async () => setShots(await window.api.deleteShot(projectId, shotId)))
  }

  function handleMoveShot(shotId: string, direction: 'up' | 'down') {
    guard(async () => setShots(await window.api.moveShot(projectId, shotId, direction)))
  }

  /**
   * "✨ Draft Grok Prompt". If the shot already has a linked entry, just
   * navigate — no duplicate, no re-draft. Otherwise: create one Grok Prompt
   * Lab entry (seeded from the shot's title/description, which carries
   * forward any script detail the outline generator preserved verbatim)
   * and link it to the shot immediately, same as before — but instead of
   * stopping there, also assemble a fuller draft-request and place it,
   * unsent, into the Grok AI Assistant's composer via `saveAiDraft` — the
   * same persistence `AiAssistantPanel` already reads on expand, so it
   * shows up there pre-filled with nothing more than a normal navigate. No
   * Anthropic call happens here; Dan reviews/edits and sends it himself.
   * `armAutoInsert: true` tells the landing panel to auto-insert *that*
   * send's reply into this entry's prompt field once it comes back, instead
   * of requiring a manual "Insert" click.
   *
   * Phase 8 (2026-09-14) revision: the draft-request context used to be the
   * project's Idea notes; it's now the Style tab's notes instead (Idea notes
   * are purely brainstorming now, pulled into no generation step — see
   * productionManager.ts's header comment for the full rationale), plus
   * Grok's own top-rated entries and promoted recipes, assembled once here
   * via the shared `buildTechniqueContext`/`assembleDraftRequest` helpers
   * (see labContext.ts) that the new Suno/SFX draft flows below also use.
   */
  async function handleDraftGrokPrompt(shot: Shot) {
    if (draftingGrokPromptShotId) return
    setDraftingGrokPromptShotId(shot.id)
    await guard(async () => {
      let entryId = shot.linkedGrokEntryId
      let armAutoInsert = false
      if (!entryId) {
        const seed = [shot.title, shot.description].filter((s) => s.trim()).join('\n\n') || shot.title
        const entries = await window.api.createPromptEntry(projectId, 'grok', { promptText: seed })
        entryId = entries[0].id // listPromptEntries/createPromptEntry both return newest-first
        setShots(await window.api.updateShot(projectId, shot.id, { linkedGrokEntryId: entryId }))

        const [style, recipes] = await Promise.all([
          window.api.getStyle(projectId),
          window.api.listRecipes(projectId, 'grok'),
        ])
        const technique = buildTechniqueContext(
          'Grok',
          entries,
          recipes,
          RATING_DIMENSIONS.grok.map((d) => d.key),
        )
        const draftRequest = assembleDraftRequest('Draft a Grok video-generation prompt for this shot:', seed, [
          styleContextBlock(style.content),
          technique,
        ])
        await window.api.saveAiDraft(projectId, 'grok', draftRequest)
        armAutoInsert = true
      }
      onOpenPromptEntry('grok', entryId, armAutoInsert)
    })
    setDraftingGrokPromptShotId(null)
  }

  /**
   * "🎵 Draft Suno Prompt" (Phase 8, 2026-09-14). Unlike Grok, this always
   * creates a brand-new Suno Prompt Lab entry on every click — confirmed
   * explicitly: a scene might genuinely want more than one song direction
   * going at once (the Phase 5 multi-link feature already lets a scene link
   * multiple finished songs), so repeat clicks shouldn't keep reopening one
   * entry.
   * The new entry's id is appended to the scene's `linkedSunoEntryIds` —
   * kept separate from `linkedSongAssetIds`, which is for finished,
   * already-imported song assets, not draft Prompt Lab entries. Composes
   * and places a full draft request (Style notes + Suno's own top-rated
   * entries/recipes + the scene's title/description) unsent into the Suno
   * AI Assistant's composer, same review-before-send pattern as Grok — no
   * automatic API call.
   */
  async function handleDraftSunoPrompt(scene: Scene) {
    if (draftingSunoPromptSceneId) return
    setDraftingSunoPromptSceneId(scene.id)
    await guard(async () => {
      const seed = [scene.title, scene.description].filter((s) => s.trim()).join('\n\n') || scene.title
      const entries = await window.api.createPromptEntry(projectId, 'suno', { promptText: seed })
      const entryId = entries[0].id
      setScenes(
        await window.api.updateScene(projectId, scene.id, {
          linkedSunoEntryIds: [...scene.linkedSunoEntryIds, entryId],
        }),
      )

      const [style, recipes] = await Promise.all([
        window.api.getStyle(projectId),
        window.api.listRecipes(projectId, 'suno'),
      ])
      const technique = buildTechniqueContext(
        'Suno',
        entries,
        recipes,
        RATING_DIMENSIONS.suno.map((d) => d.key),
      )
      const draftRequest = assembleDraftRequest('Draft a Suno music-generation prompt for this scene:', seed, [
        styleContextBlock(style.content),
        technique,
      ])
      await window.api.saveAiDraft(projectId, 'suno', draftRequest)

      onOpenPromptEntry('suno', entryId, true)
    })
    setDraftingSunoPromptSceneId(null)
  }

  /**
   * "🔊 Draft SFX Prompt" (Phase 8, 2026-09-14). Also always creates a
   * brand-new SFX entry on every click, for the same reason as Suno above —
   * a shot might genuinely want footsteps *and* wind *and* a door creak as
   * three separate entries. Unlike Suno, this needs no new link field: the
   * new entry's id is simply appended to the shot's existing `linkedSfxIds`
   * (already an uncapped list into the unified SFX system from Phase 5),
   * since that system's entries already serve both "finished/tagged sound"
   * and "draft prompt" roles — there's no separate finished-asset-link
   * field to keep this distinct from, unlike Suno's
   * linkedSongAssetIds/linkedSunoEntryIds split. Sourced as `elevenlabs`
   * (this is a generation prompt, not a search term for a licensed
   * download). Same Style-notes + top-rated/recipe context assembly and
   * review-before-send composer placement as Grok/Suno.
   */
  async function handleDraftSfxPrompt(shot: Shot) {
    if (draftingSfxPromptShotId) return
    setDraftingSfxPromptShotId(shot.id)
    await guard(async () => {
      const seed = [shot.title, shot.description].filter((s) => s.trim()).join('\n\n') || shot.title
      const entries = await window.api.createSfxEntry(projectId, {
        source: 'elevenlabs',
        name: shot.title,
        promptText: seed,
      })
      const entryId = entries[0].id
      setSfxEntries(entries)
      setShots(await window.api.updateShot(projectId, shot.id, { linkedSfxIds: [...shot.linkedSfxIds, entryId] }))

      const [style, recipes] = await Promise.all([
        window.api.getStyle(projectId),
        window.api.listSfxRecipes(projectId),
      ])
      const technique = buildTechniqueContext(
        'SFX',
        entries,
        recipes,
        SFX_RATING_DIMENSIONS.map((d) => d.key),
      )
      const draftRequest = assembleDraftRequest('Draft an ElevenLabs sound-effect prompt for this shot:', seed, [
        styleContextBlock(style.content),
        technique,
      ])
      await window.api.saveAiDraft(projectId, 'elevenlabs', draftRequest)

      onOpenPromptEntry('sfx', entryId, true)
    })
    setDraftingSfxPromptShotId(null)
  }

  if (loading) return <p className="muted">Loading scenes…</p>

  return (
    <div className="scene-list">
      {error && <div className="error-banner">{error}</div>}

      {scenes.length === 0 && (
        <p className="muted">
          No scenes yet. Break your script into scenes, then break each scene into shots to plan
          and track production.
        </p>
      )}

      {scenes.map((scene, index) => (
        <SceneCard
          key={scene.id}
          scene={scene}
          shots={shots.filter((s) => s.sceneId === scene.id)}
          assets={assets}
          sfxEntries={sfxEntries}
          isFirst={index === 0}
          isLast={index === scenes.length - 1}
          onUpdate={(updates) => handleUpdateScene(scene.id, updates)}
          onDelete={() => handleDeleteScene(scene.id)}
          onMove={(direction) => handleMoveScene(scene.id, direction)}
          onAddShot={(title) => handleAddShot(scene.id, title)}
          onUpdateShot={handleUpdateShot}
          onDeleteShot={handleDeleteShot}
          onMoveShot={handleMoveShot}
          onDraftGrokPrompt={handleDraftGrokPrompt}
          draftingGrokPromptShotId={draftingGrokPromptShotId}
          onDraftSunoPrompt={handleDraftSunoPrompt}
          draftingSunoPromptSceneId={draftingSunoPromptSceneId}
          onDraftSfxPrompt={handleDraftSfxPrompt}
          draftingSfxPromptShotId={draftingSfxPromptShotId}
        />
      ))}

      <div className="new-scene-form">
        <input
          type="text"
          placeholder="New scene title, e.g. Scene 1 — Forest Entrance"
          value={newSceneTitle}
          onChange={(e) => setNewSceneTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddScene()}
        />
        <button className="btn btn--primary" disabled={addingScene} onClick={handleAddScene}>
          {addingScene ? 'Adding…' : '+ Add Scene'}
        </button>
      </div>
    </div>
  )
}
