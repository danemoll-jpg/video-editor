import { useState } from 'react'
import type { Asset } from '../api'
import { PROMPT_LAB_KINDS, PROMPT_LAB_LABELS, type PromptLabKind } from '../../electron/promptLabTypes'
import PromptLabPanel from './PromptLabPanel'
import SfxPanel from './SfxPanel'

interface Props {
  projectId: string
  assets: Asset[]
  /**
   * A Grok Prompt Lab entry id to land on and expand, set by
   * `ProjectView` when a "✨ Draft Grok Prompt" shot navigation
   * (2026-09-14) switches to this tab. Forces the Grok sub-tab (already the
   * default) and is passed through to `PromptLabPanel`.
   */
  focusGrokEntryId?: string | null
  /**
   * The entry id (if any) the Grok AI Assistant's next reply should
   * auto-insert into — set alongside `focusGrokEntryId` only on a fresh
   * draft-request navigation, per the same 2026-09-14 revision. Passed
   * through to `PromptLabPanel` only for the Grok sub-tab.
   */
  autoInsertGrokEntryId?: string | null
  /** Called once that auto-insert has actually happened. */
  onAutoInsertConsumed?: () => void
}

type SubTab = PromptLabKind | 'sfx'

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
  focusGrokEntryId,
  autoInsertGrokEntryId,
  onAutoInsertConsumed,
}: Props) {
  // Grok is already the default sub-tab, so a focusGrokEntryId target needs
  // no extra logic here beyond being passed through to PromptLabPanel below.
  const [subTab, setSubTab] = useState<SubTab>('grok')

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
        <SfxPanel projectId={projectId} assets={assets} />
      ) : (
        <PromptLabPanel
          key={subTab}
          projectId={projectId}
          kind={subTab}
          assets={assets}
          focusEntryId={subTab === 'grok' ? focusGrokEntryId : null}
          autoInsertEntryId={subTab === 'grok' ? autoInsertGrokEntryId : null}
          onAutoInsertConsumed={onAutoInsertConsumed}
        />
      )}
    </div>
  )
}
