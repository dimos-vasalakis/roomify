import { useEffect, useRef } from 'react'
import { enter, reducedMotion, useGSAP } from '../../lib/motion'
import { isWorking, linesOf } from '../../lib/session'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import { BlockError } from '../common/BlockError'
import { LiveDot } from '../common/LiveDot'

/** A work log, not bubbles: your lines open with an ink ring, Roomify's with a pine dot. Newest at the bottom. */
export function Thread() {
  const { active: s } = useStore()
  const actions = useActions()
  const list = useRef<HTMLOListElement>(null)
  const lines = linesOf(s)
  const ask = s.status === 'asking' && s.ask ? s.ask : null
  const askShown = ask && !(lines.at(-1)?.role === 'agent' && lines.at(-1)?.text === ask.question)

  useGSAP(
    () => {
      const items = list.current?.querySelectorAll('[data-line]')
      if (items?.length) enter(items[items.length - 1], { y: 8 })
    },
    { scope: list, dependencies: [lines.length, !!askShown] },
  )

  // New lines arrive below the old ones; follow them only if the reader was already at the end.
  const pinned = useRef(true)
  useEffect(() => {
    const el = list.current?.parentElement
    if (!el) return
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
      el.dataset.scrolled = el.scrollTop > 4 ? 'true' : 'false'
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    const el = list.current?.parentElement
    if (el && pinned.current) el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }, [lines.length, s.now?.text, ask?.question])

  if (!lines.length && !ask) {
    return (
      <div className="flex flex-col pt-6">
        <p className="text-title font-semibold tracking-[-0.015em] text-ink">What do you need, and what&rsquo;s the budget?</p>
        <p className="mt-2 max-w-[32ch] text-body text-muted">Say it or type it. Something like &ldquo;a desk and a comfortable chair for long days, €400&rdquo;.</p>
      </div>
    )
  }

  return (
    <ol ref={list} className="flex flex-col pt-5 pb-3">
      {lines.map((line, i) => {
        const user = line.role === 'user'
        const follows = i > 0 && lines[i - 1].role === line.role
        return (
          <li
            key={`${s.id}:${i}`}
            data-line
            className={`grid grid-cols-[0.875rem_minmax(0,1fr)] gap-x-2.5 ${follows ? 'mt-2' : i ? 'mt-5' : ''}`}
          >
            <span aria-hidden="true" className="flex justify-center pt-[0.45rem]">
              {!follows && <span className={`size-2 rounded-full ${user ? 'border-[1.5px] border-ink' : 'bg-chosen'}`} />}
            </span>
            <p className={`text-body ${user ? 'font-medium text-ink' : 'text-ink/85'}`}>
              <span className="sr-only">{user ? 'You: ' : 'Roomify: '}</span>
              {line.text}
            </p>
          </li>
        )
      })}

      {ask && (
        <li data-line className="mt-5 grid grid-cols-[0.875rem_minmax(0,1fr)] gap-x-2.5">
          <span aria-hidden="true" className="flex justify-center pt-[0.5rem]">
            {askShown && <span className="size-1.5 rounded-full bg-chosen" />}
          </span>
          <div className="min-w-0">
            {askShown && <p className="text-body text-ink/85"><span className="sr-only">Roomify: </span>{ask.question}</p>}
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {ask.suggestion ? (
                <button type="button" onClick={() => void actions.answer(Math.round(ask.suggestion!))} className="press num h-9 rounded-control bg-ink px-3 text-chrome font-medium text-surface">
                  {Math.round(ask.suggestion)} {ask.unit} looks right
                </button>
              ) : null}
              {s.offer && (
                <button type="button" onClick={() => void actions.talk("Skip, I don't know the size", {}, 'ask')} className="press h-9 rounded-control border border-control px-3 text-chrome font-medium text-ink hover:bg-raised">
                  Skip, design without it
                </button>
              )}
            </div>
            <BlockError block="ask" className="mt-2" />
          </div>
        </li>
      )}

      {isWorking(s) && s.now && (
        <li className="mt-5 grid grid-cols-[0.875rem_minmax(0,1fr)] items-center gap-x-2.5 text-chrome text-muted" aria-live="polite">
          <span className="flex justify-center"><LiveDot /></span>
          <span className="truncate">{s.now.text}</span>
        </li>
      )}

      <BlockError block="start" className="mt-4" />
      <BlockError block="swap" className="mt-4" />
      <BlockError block="feed" className="mt-4" />
    </ol>
  )
}
