import { useState } from 'react'
import { formatDate } from '../format'

/** Structural shape both a prompt-lab Recipe and a unified SfxRecipe satisfy — this component works with either. */
export interface RecipeCardData {
  name: string
  promptText: string
  lyrics?: string
  settings: string
  notes: string
  createdAt: string
}

interface Props {
  recipe: RecipeCardData
  showLyrics: boolean
  onRename: (name: string) => void
  onDelete: () => void
  onUseAsNewEntry: () => void
}

export default function RecipeCard({ recipe, showLyrics, onRename, onDelete, onUseAsNewEntry }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(recipe.name)

  function handleSaveName() {
    if (!name.trim()) return
    onRename(name)
    setRenaming(false)
  }

  return (
    <div className="recipe-card">
      <div className="prompt-entry-card__row">
        <button className="shot-card__collapse" onClick={() => setExpanded(!expanded)}>
          {expanded ? '▼' : '▶'}
        </button>
        {renaming ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
            autoFocus
          />
        ) : (
          <div className="prompt-entry-card__summary" onClick={() => setExpanded(!expanded)}>
            <span className="prompt-entry-card__prompt-preview">{recipe.name}</span>
            <span className="muted prompt-entry-card__meta">Saved {formatDate(recipe.createdAt)}</span>
          </div>
        )}
        <div className="spacer" />
        {renaming ? (
          <>
            <button className="btn btn--primary" onClick={handleSaveName}>
              Save
            </button>
            <button className="btn" onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => setRenaming(true)}>
              Rename
            </button>
            <button className="btn btn--primary" onClick={onUseAsNewEntry}>
              Use as New Entry
            </button>
            <button className="btn btn--danger" onClick={onDelete}>
              Delete
            </button>
          </>
        )}
      </div>

      {expanded && (
        <div className="prompt-entry-card__details">
          <div className="prompt-entry-card__field-block">
            <div className="muted field-label">Prompt</div>
            <p className="prompt-entry-card__text">{recipe.promptText}</p>
          </div>
          {showLyrics && recipe.lyrics && (
            <div className="prompt-entry-card__field-block">
              <div className="muted field-label">Lyrics</div>
              <p className="prompt-entry-card__text">{recipe.lyrics}</p>
            </div>
          )}
          {recipe.settings && (
            <div className="prompt-entry-card__field-block">
              <div className="muted field-label">Settings</div>
              <p className="prompt-entry-card__text">{recipe.settings}</p>
            </div>
          )}
          {recipe.notes && (
            <div className="prompt-entry-card__field-block">
              <div className="muted field-label">Notes</div>
              <p className="prompt-entry-card__text">{recipe.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
