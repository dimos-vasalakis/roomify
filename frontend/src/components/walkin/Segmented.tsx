type Option<T extends string | number> = { value: T; label: string; hint?: string }

type Props<T extends string | number> = {
  label: string
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
}

/** A small segmented control, as wide as its options. */
export function Segmented<T extends string | number>({ label, value, options, onChange }: Props<T>) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-small text-muted">{label}</legend>
      <div className="inline-flex rounded-control bg-raised p-0.5">
        {options.map((o) => {
          const on = o.value === value
          return (
            <button
              key={String(o.value)}
              type="button"
              title={o.hint}
              aria-pressed={on}
              onClick={() => onChange(o.value)}
              className={`press h-8 rounded-[5px] px-3 text-chrome transition-colors duration-150 ${on ? 'bg-surface font-medium text-ink' : 'text-muted hover:text-ink'}`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
