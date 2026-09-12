import { useState } from 'react'
import type { Asset } from '../api'
import { PROMPT_LAB_KINDS, PROMPT_LAB_LABELS, type PromptLabKind } from '../../electron/promptLabTypes'
import PromptLabPanel from './PromptLabPanel'
import SfxLibraryPanel from './SfxLibraryPanel'

interface Props {
  projectId: string
  assets: Asset[]
}

type SubTab = PromptLabKind | 'sfx'

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'grok', label: PROMPT_LAB_LABELS.grok },
  { key: 'suno', label: PROMPT_LAB_LABELS.suno },
  { key: 'sfx', label: 'SFX Library' },
  { key: 'elevenlabs', label: PROMPT_LAB_LABELS.elevenlabs },
]

/** Phase 3: Prompt/Asset Lab — the four subsystems as sub-tabs within the project's "Prompt Lab" tab. */
export default function PromptLab({ projectId, assets }: Props) {
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
        <SfxLibraryPanel projectId={projectId} assets={assets} />
      ) : (
        <PromptLabPanel key={subTab} projectId={projectId} kind={subTab} assets={assets} />
      )}
    </div>
  )
}
