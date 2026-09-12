// Small 1-5 star picker shared by every rating dimension in a PromptLabPanel
// rating form/display. Deliberately dumb — value in, onChange out — no
// fetching or IPC here.

interface Props {
  value: number
  onChange?: (value: number) => void
  size?: 'sm' | 'md'
}

export default function StarRating({ value, onChange, size = 'md' }: Props) {
  const stars = [1, 2, 3, 4, 5]
  return (
    <span className={`star-rating star-rating--${size} ${onChange ? '' : 'star-rating--readonly'}`}>
      {stars.map((n) => (
        <span
          key={n}
          className={`star-rating__star ${n <= value ? 'star-rating__star--filled' : ''}`}
          onClick={onChange ? () => onChange(n) : undefined}
        >
          ★
        </span>
      ))}
    </span>
  )
}
