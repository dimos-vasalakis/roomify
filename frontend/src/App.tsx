import { Mark } from './components/shell/Mark'

if (new URLSearchParams(location.search).has('stage')) {
  document.documentElement.dataset.stage = ''
}

/* Grid: 1424 = stage 968 + gap 12 + receipt 444, inside 8px outer margins at 1440. */
export default function App() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-bar shrink-0 items-center justify-between px-6">
        <Mark />
      </header>
      <main className="flex flex-1 flex-col gap-gap px-edge pb-edge lg:flex-row">
        <section
          aria-label="Your room"
          className="min-h-96 flex-1 rounded-panel border border-border bg-surface"
        />
        <aside
          aria-label="Receipt"
          className="min-h-96 rounded-panel border border-border bg-surface lg:w-receipt lg:shrink-0"
        />
      </main>
    </div>
  )
}
