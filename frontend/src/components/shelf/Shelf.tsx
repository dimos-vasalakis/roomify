import { Footprints, Play } from 'lucide-react'
import { useRef, useState } from 'react'
import { money } from '../../lib/format'
import { STAGGER, enter, useGSAP } from '../../lib/motion'
import { pictureOf } from '../../lib/session'
import { useStore } from '../../state/store'
import type { Box, Point } from '../../types'
import { Crop } from '../common/Crop'

const MOVE_NAME = { push: 'Push in', orbit: 'Orbit', rise: 'Rise' } as const

/** A 4:3 crop of the room around the spot a walk-in starts from. */
const around = (p: Point): Box => {
  const w = 0.36
  const h = w * 1.125
  return { x: Math.min(Math.max(p.x - w / 2, 0), 1 - w), y: Math.min(Math.max(p.y - h * 0.7, 0), 1 - h), w, h }
}

type Tab = 'basket' | 'walkins'

/** Under the room: what is in the basket, and the walk-ins made so far. */
export function Shelf() {
  const { state, active: s, dispatch } = useStore()
  const [tab, setTab] = useState<Tab>('basket')
  // Walking in, or a new clip arriving, brings the walk-ins forward.
  const [seen, setSeen] = useState({ id: s.id, walk: state.walkMode, clips: s.walkIns.length })
  if (seen.id !== s.id || seen.walk !== state.walkMode || seen.clips !== s.walkIns.length) {
    if (seen.id === s.id && (state.walkMode || s.walkIns.length > seen.clips)) setTab('walkins')
    if (seen.id !== s.id) setTab('basket')
    setSeen({ id: s.id, walk: state.walkMode, clips: s.walkIns.length })
  }
  const row = useRef<HTMLDivElement>(null)
  const picture = s.afterSrc ?? pictureOf(s)
  const done = s.status === 'done'

  useGSAP(
    () => {
      // Only while shopping: the newest product slides onto the shelf.
      if (s.status !== 'shopping' || !s.products.length) return
      enter('[data-card]:last-child', { y: 12 })
    },
    { scope: row, dependencies: [s.products.length] },
  )

  useGSAP(
    () => {
      if (row.current?.querySelector('[data-card]')) enter('[data-card]', { y: 8, stagger: STAGGER * 0.6 })
    },
    { scope: row, dependencies: [s.id, tab] },
  )

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'basket', label: 'In the basket', count: s.products.length },
    { id: 'walkins', label: 'Walk-ins', count: s.walkIns.length },
  ]

  return (
    <div className="border-t border-rule">
      <div role="tablist" aria-label="Under the room" className="flex gap-5 border-b border-rule px-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`relative -mb-px flex h-11 items-center gap-1.5 text-chrome transition-colors duration-150 ${tab === t.id ? 'font-medium text-ink' : 'text-muted hover:text-ink'}`}
          >
            {t.label}
            <span className="num text-muted">{t.count}</span>
            {tab === t.id && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-ink" />}
          </button>
        ))}
      </div>

      <div ref={row} className="flex min-h-44 gap-3 overflow-x-auto px-4 pt-3 pb-4" role="tabpanel">
        {tab === 'basket' &&
          (s.products.length ? (
            s.products.map((p) => {
              const on = p.id === state.selectedProductId
              return (
                <button
                  key={p.id}
                  data-card
                  type="button"
                  onClick={() => done && dispatch({ type: 'selectProduct', id: on ? null : p.id })}
                  className={`group w-32 shrink-0 rounded-card p-1 text-left outline-offset-0 transition-colors duration-150 ${on ? 'outline-2 outline-ink' : 'hover:bg-raised'}`}
                >
                  <Crop src={p.thumb?.src ?? s.afterSrc ?? picture} box={p.thumb?.box ?? p.box} alt="" className="rounded-[5px]" />
                  <span className="mt-2 block px-0.5 text-small text-muted">{p.slot}</span>
                  <span className="line-clamp-2 block px-0.5 text-chrome leading-5 text-ink">{p.title}</span>
                  <span className="num mt-0.5 block px-0.5 text-chrome font-bold">{money(p.priceEur)}</span>
                </button>
              )
            })
          ) : (
            <p className="self-center text-chrome text-muted">
              {s.status === 'new' ? 'Products appear here as the agent chooses them.' : 'Nothing in the basket yet.'}
            </p>
          ))}

        {tab === 'walkins' && (
          <>
            <button
              data-card
              type="button"
              disabled={!done}
              onClick={() => dispatch({ type: 'setWalkMode', on: true })}
              className="press flex w-32 shrink-0 flex-col items-center justify-center gap-2 rounded-card border border-dashed border-control p-3 text-center text-chrome hover:border-ink disabled:cursor-not-allowed disabled:hover:border-control"
            >
              <Footprints size={18} strokeWidth={1.5} className="text-muted" />
              <span className="font-medium text-ink">New walk-in</span>
              <span className="text-small text-muted">{done ? 'Choose a spot on the room' : 'Once your room is drawn'}</span>
            </button>
            {s.walkIns.map((w) => (
              <button
                key={w.id}
                data-card
                type="button"
                disabled={w.status !== 'ready'}
                onClick={() => dispatch({ type: 'play', id: w.id })}
                className="group w-40 shrink-0 rounded-card p-1 text-left transition-colors duration-150 hover:bg-raised disabled:cursor-progress"
              >
                <span className="relative block overflow-hidden rounded-[5px]">
                  <Crop src={picture} box={around(w.from)} alt="" className={w.status === 'making' ? 'opacity-40' : ''} />
                  {w.status === 'ready' ? (
                    <span className="absolute bottom-2 left-2 grid size-8 place-items-center rounded-full bg-surface text-ink transition-transform duration-200 group-hover:scale-105">
                      <Play size={14} strokeWidth={2} className="ml-0.5" fill="currentColor" />
                    </span>
                  ) : (
                    <span className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-surface/70">
                      <span className="block h-full w-1/3 rounded-full bg-ink motion-safe:animate-[slide_1.1s_var(--ease-in-out)_infinite]" />
                    </span>
                  )}
                </span>
                <span className="mt-2 block px-0.5 text-chrome font-medium text-ink">
                  {MOVE_NAME[w.move]} · {w.seconds} s
                </span>
                <span className="block px-0.5 text-small text-muted">{w.status === 'making' ? 'Making it, about a minute' : `Made ${w.createdAt}`}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
