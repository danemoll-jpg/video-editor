import { useEffect, useState } from 'react'
import type { Asset } from '../api'
import { PROMPT_LAB_KINDS, PROMPT_LAB_LABELS, type PromptLabKind } from '../../electron/promptLabTypes'
import PromptLabPanel from './PromptLabPanel'
import SfxPanel from './SfxPanel'

/** A sub-tab of the Prompt Lab: a `PromptLabKind` (Grok/Suno) or the unified SFX system. */
export type SubTab = PromptLabKind | 'sfx'

interface Props {
  projectId: string
  assets: Asset[]
  /**
   * Which sub-tab a "Draft Prompt" navigation (2026-09-14: Grok, then
   * extended to Suno and SFX for Phase 8) should land on, if any — set by
   * `ProjectView`. Forces `subTab` to this value.
   */
  focusKind?: SubTab | null
  /**
   * The entry id (if any) to expand/scroll into view within `focusKind`'s
   * panel — set by `ProjectView` alongside `focusKind` on a fresh draft
   * navigation. Passed through to whichever panel matches `focusKind`.
   */
  focusEntryId?: string | null
  /**
   * The entry id (if any) whose prompt text field should be overwritten
   * automatically with the AI Assistant's *next* reply, instead of the
   * normal manual-"Insert" flow — set only right after a fresh draft
   * request was placed unsent into the composer. Passed through only to
   * `focusKind`'s panel, same as `focusEntryId`.
   */
  autoInsertEntryId?: string | null
  /** Called once that auto-insert has actually happened, so the caller can clear its armed state. */
  onAutoInsertConsumed?: () => void
}

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'grok', label: PROMPT_LAB_LABELS.grok },
  { key: 'suno', label: PROMPT_LAB_LABELS.suno },
  { key: 'sfx', label: 'SFX' },
]

/**
 * Phase 3: Prompt/Asset Lab — Grok/Suno as sub-tabs within the project's
 * "Prompt Lab" tab, plus the unified SFX system (Phase 5 merge of the old
 * SFX library and ElevenLabs prompt-lab kind — see sfxLibraryManager.ts's
 * header comment).
 */
export default function PromptLab({
  projectId,
  assets,
  focusKind,
  focusEntryId,
  autoInsertEntryId,
  onAutoInsertConsumed,
}: Props) {
  const [subTab, setSubTab] = useState<SubTab>('grok')

  // A "Draft Prompt" navigation can target any sub-tab (Grok is the default,
  // so it needed no forcing before Suno/SFX drafting existed — Suno and SFX
  // do, since neither is the default).
  useEffect(() => {
    if (focusKind) setSubTab(focusKind)
  }, [focusKind, focusEntryId])

  return (
    <div className="prompt-lab">
      <div className="tab-bar tab-bar--sub">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            className={`tab-bar__tab ${subTab === t.key ? 'tab-bar__tab--active' : ''}`}
            onClick={() => setSubTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'sfx' ? (
        <SfxPanel
          projectId={projectId}
          assets={assets}
          focusEntryId={focusKind === 'sfx' ? focusEntryId : null}
          autoInsertEntryId={focusKind === 'sfx' ? autoInsertEntryId : null}
          onAutoInsertConsumed={onAutoInsertConsumed}
        />
      ) : (
        <PromptLabPanel
          key={subTab}
          projectId={projectId}
          kind={subTab}
          assets={assets}
          focusEntryId={focusKind === subTab ? focusEntryId : null}
          autoInsertEntryId={focusKind === subTab ? autoInsertEntryId : null}
          onAutoInsertConsumed={onAutoInsertConsumed}
        />
      )}
    </div>
  )
}
