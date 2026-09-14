import { FONT_FAMILIES, TRANSITION_LABELS, TRANSITION_TYPES, type TransitionType } from '../../electron/editorTypes'
import type { Clip, ClipUpdates } from '../api'

// The right-hand properties panel for whichever clip is selected on the
// timeline — trim/speed/volume/fades for media clips, crop/scale/position,
// chroma key, the transition into the next clip, and (for text clips) the
// title's content/style. Every field is a controlled input that calls
// `onUpdate` with just the one field that changed — editorManager.ts merges
// partial updates, so there's no need to resend the whole clip here.

interface Props {
  clip: Clip
  playhead: number
  onUpdate: (updates: ClipUpdates) => void
  onDelete: () => void
  onSplit: () => void
}

function NumberField({
  label,
  value,
  step = 0.1,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  step?: number
  min?: number
  max?: number
  onChange: (value: number) => void
}) {
  return (
    <label className="clip-inspector__field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={Number.isFinite(value) ? Number(value.toFixed(3)) : 0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

export default function ClipInspector({ clip, playhead, onUpdate, onDelete, onSplit }: Props) {
  const canSplit = playhead > clip.startTime + 0.05 && playhead < clip.startTime + clip.duration - 0.05
  const t = clip.transform

  return (
    <div className="clip-inspector">
      <div className="clip-inspector__header">
        <h3>{clip.kind === 'text' ? 'Title' : 'Clip'}</h3>
        <div className="spacer" />
        <button className="btn" disabled={!canSplit} onClick={onSplit} title="Split at playhead">
          ✂ Split
        </button>
        <button className="btn btn--danger" onClick={onDelete}>
          Delete
        </button>
      </div>

      <NumberField label="Start (s)" value={clip.startTime} onChange={(v) => onUpdate({ startTime: v })} />

      {clip.kind === 'media' && (
        <>
          <div className="clip-inspector__row">
            <NumberField label="Trim in (s)" value={clip.inPoint} onChange={(v) => onUpdate({ inPoint: v })} />
            <NumberField label="Trim out (s)" value={clip.outPoint} onChange={(v) => onUpdate({ outPoint: v })} />
          </div>
          <div className="clip-inspector__row">
            <NumberField label="Speed ×" value={clip.speed} step={0.05} onChange={(v) => onUpdate({ speed: v })} />
            <span className="muted clip-inspector__hint">On-timeline duration: {clip.duration.toFixed(2)}s</span>
          </div>
          <div className="clip-inspector__row">
            <NumberField label="Volume" value={clip.volume} step={0.05} onChange={(v) => onUpdate({ volume: v })} />
            <label className="clip-inspector__checkbox">
              <input
                type="checkbox"
                checked={clip.includeAudio}
                onChange={(e) => onUpdate({ includeAudio: e.target.checked })}
              />
              Include this clip's audio
            </label>
          </div>
          <div className="clip-inspector__row">
            <label className="clip-inspector__checkbox">
              <input type="checkbox" checked={clip.reverse} onChange={(e) => onUpdate({ reverse: e.target.checked })} />
              Reverse
            </label>
            <label className="clip-inspector__checkbox">
              <input type="checkbox" checked={clip.mirror} onChange={(e) => onUpdate({ mirror: e.target.checked })} />
              Mirror / flip horizontal
            </label>
          </div>
          {clip.reverse && (
            <p className="muted clip-inspector__hint">
              {clip.reverseProxy?.status === 'ready'
                ? '✅ Reversed preview ready — the live preview now plays this clip backwards.'
                : clip.reverseProxy?.status === 'error'
                  ? `⚠ Reversed preview failed to render (${clip.reverseProxy.error ?? 'unknown error'}) — export still reverses correctly.`
                  : '⏳ Generating a reversed preview proxy… the live preview plays forward until this finishes.'}
            </p>
          )}
        </>
      )}

      {clip.kind === 'text' && (
        <NumberField label="Duration (s)" value={clip.duration} onChange={(v) => onUpdate({ duration: v })} />
      )}

      <div className="clip-inspector__row">
        <NumberField label="Fade in (s)" value={clip.fadeInDuration} onChange={(v) => onUpdate({ fadeInDuration: v })} />
        <NumberField label="Fade out (s)" value={clip.fadeOutDuration} onChange={(v) => onUpdate({ fadeOutDuration: v })} />
      </div>

      <section className="clip-inspector__section">
        <h4>Position &amp; Scale</h4>
        <div className="clip-inspector__row">
          <NumberField label="X" value={t.x} step={1} onChange={(v) => onUpdate({ transform: { ...t, x: v } })} />
          <NumberField label="Y" value={t.y} step={1} onChange={(v) => onUpdate({ transform: { ...t, y: v } })} />
        </div>
        <div className="clip-inspector__row">
          <NumberField label="Width" value={t.width} step={1} onChange={(v) => onUpdate({ transform: { ...t, width: v } })} />
          <NumberField label="Height" value={t.height} step={1} onChange={(v) => onUpdate({ transform: { ...t, height: v } })} />
        </div>
      </section>

      {clip.kind === 'media' && (
        <section className="clip-inspector__section">
          <h4>Crop</h4>
          <label className="clip-inspector__checkbox">
            <input
              type="checkbox"
              checked={!!clip.crop}
              onChange={(e) =>
                onUpdate({
                  crop: e.target.checked
                    ? { x: 0, y: 0, width: clip.sourceWidth ?? t.width, height: clip.sourceHeight ?? t.height }
                    : null,
                })
              }
            />
            Crop source before scaling
          </label>
          {clip.crop && (
            <>
              <div className="clip-inspector__row">
                <NumberField label="Crop X" value={clip.crop.x} step={1} onChange={(v) => onUpdate({ crop: { ...clip.crop!, x: v } })} />
                <NumberField label="Crop Y" value={clip.crop.y} step={1} onChange={(v) => onUpdate({ crop: { ...clip.crop!, y: v } })} />
              </div>
              <div className="clip-inspector__row">
                <NumberField
                  label="Crop W"
                  value={clip.crop.width}
                  step={1}
                  onChange={(v) => onUpdate({ crop: { ...clip.crop!, width: v } })}
                />
                <NumberField
                  label="Crop H"
                  value={clip.crop.height}
                  step={1}
                  onChange={(v) => onUpdate({ crop: { ...clip.crop!, height: v } })}
                />
              </div>
            </>
          )}
        </section>
      )}

      {clip.kind === 'media' && (
        <section className="clip-inspector__section">
          <h4>Green Screen / Chroma Key</h4>
          <label className="clip-inspector__checkbox">
            <input
              type="checkbox"
              checked={clip.chromaKey.enabled}
              onChange={(e) => onUpdate({ chromaKey: { ...clip.chromaKey, enabled: e.target.checked } })}
            />
            Enable chroma key
          </label>
          {clip.chromaKey.enabled && (
            <>
              <label className="clip-inspector__field">
                <span>Key color</span>
                <input
                  type="color"
                  value={clip.chromaKey.color}
                  onChange={(e) => onUpdate({ chromaKey: { ...clip.chromaKey, color: e.target.value } })}
                />
              </label>
              <div className="clip-inspector__row">
                <NumberField
                  label="Similarity"
                  value={clip.chromaKey.similarity}
                  step={0.01}
                  min={0.01}
                  max={1}
                  onChange={(v) => onUpdate({ chromaKey: { ...clip.chromaKey, similarity: v } })}
                />
                <NumberField
                  label="Blend"
                  value={clip.chromaKey.blend}
                  step={0.01}
                  min={0}
                  max={1}
                  onChange={(v) => onUpdate({ chromaKey: { ...clip.chromaKey, blend: v } })}
                />
              </div>
            </>
          )}
        </section>
      )}

      <section className="clip-inspector__section">
        <h4>Transition to Next Clip</h4>
        <div className="clip-inspector__row">
          <label className="clip-inspector__field">
            <span>Type</span>
            <select
              value={clip.transitionOut.type}
              onChange={(e) =>
                onUpdate({ transitionOut: { ...clip.transitionOut, type: e.target.value as TransitionType } })
              }
            >
              {TRANSITION_TYPES.map((tt) => (
                <option key={tt} value={tt}>
                  {TRANSITION_LABELS[tt]}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label="Duration (s)"
            value={clip.transitionOut.duration}
            onChange={(v) => onUpdate({ transitionOut: { ...clip.transitionOut, duration: v } })}
          />
        </div>
        {clip.transitionOut.type !== 'none' && (
          <p className="muted clip-inspector__hint">
            Move the next clip on this track so it starts {clip.transitionOut.duration.toFixed(2)}s before this one
            ends — they'll blend across that overlap on export.
          </p>
        )}
      </section>

      {clip.kind === 'text' && clip.text && (
        <section className="clip-inspector__section">
          <h4>Title Text</h4>
          <label className="clip-inspector__field">
            <span>Content</span>
            <textarea
              value={clip.text.content}
              onChange={(e) => onUpdate({ text: { ...clip.text!, content: e.target.value } })}
            />
          </label>
          <div className="clip-inspector__row">
            <label className="clip-inspector__field">
              <span>Font</span>
              <select
                value={clip.text.fontFamily}
                onChange={(e) => onUpdate({ text: { ...clip.text!, fontFamily: e.target.value } })}
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <NumberField
              label="Size"
              value={clip.text.fontSize}
              step={1}
              onChange={(v) => onUpdate({ text: { ...clip.text!, fontSize: v } })}
            />
          </div>
          <div className="clip-inspector__row">
            <label className="clip-inspector__field">
              <span>Color</span>
              <input
                type="color"
                value={clip.text.color}
                onChange={(e) => onUpdate({ text: { ...clip.text!, color: e.target.value } })}
              />
            </label>
            <label className="clip-inspector__field">
              <span>Align</span>
              <select
                value={clip.text.align}
                onChange={(e) => onUpdate({ text: { ...clip.text!, align: e.target.value as 'left' | 'center' | 'right' } })}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
          </div>
          <label className="clip-inspector__checkbox">
            <input
              type="checkbox"
              checked={!!clip.text.backgroundColor}
              onChange={(e) => onUpdate({ text: { ...clip.text!, backgroundColor: e.target.checked ? '#000000' : null } })}
            />
            Background box
          </label>
          {clip.text.backgroundColor && (
            <label className="clip-inspector__field">
              <span>Box color</span>
              <input
                type="color"
                value={clip.text.backgroundColor}
                onChange={(e) => onUpdate({ text: { ...clip.text!, backgroundColor: e.target.value } })}
              />
            </label>
          )}
        </section>
      )}
    </div>
  )
}
