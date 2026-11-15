import { useEffect, useRef } from 'react'
import { enter, useGSAP } from '../../lib/motion'
import { isWorking, linesOf } from '../../lib/session'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import { BlockError } from '../common/BlockError'
import { LiveDot } from '../common/LiveDot'

type Props = { speaking: string | null; spoken: number }

/** Lines, not bubbles. The line being read aloud lights up word by word. */
export function Thread({ speaking, spoken }: Props) {
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

  useEffect(() => {
    const el = list.current?.parentElement
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [lines.length, s.now?.text, ask?.question])

  if (!lines.length && !ask) {
    return (
      <div className="flex flex-1 flex-col justify-end pb-2">
        <p className="text-title font-semibold tracking-[-0.015em] text-ink">What do you need, and what&rsquo;s the budget?</p>
        <p className="mt-2 text-body text-muted">Say it or type it. Something like &ldquo;A desk and a comfortable chair for long days, €400.&rdquo;</p>
      </div>
    )
  }

  return (
    <ol ref={list} className="flex flex-col gap-5 pb-2">
      {lines.map((line, i) => {
        const key = `${s.id}:${i}`
        const live = speaking === key
        return (
          <li key={key} data-line className="flex flex-col gap-1">
            <span className={`text-small font-semibold ${line.role === 'agent' ? 'text-chosen' : 'text-muted'}`}>{line.role === 'agent' ? 'Roomify' : 'You'}</span>
            <p className="text-body text-ink">
              {live ? (
                <>
                  <span>{line.text.slice(0, spoken)}</span>
                  <span className="text-muted">{line.text.slice(spoken)}</span>
                </>
              ) : (
                line.text
              )}
            </p>
          </li>
        )
      })}

      {ask && (
        <li data-line className="flex flex-col gap-1">
          {askShown && (
            <>
              <span className="text-small font-semibold text-chosen">Roomify</span>
              <p className="text-body text-ink">{ask.question}</p>
            </>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ask.suggestion ? (
              <button type="button" onClick={() => void actions.answer(Math.round(ask.suggestion!))} className="press num h-9 rounded-control bg-ink px-3 text-chrome font-medium text-surface">
                {Math.round(ask.suggestion)} {ask.unit} looks right
              </button>
            ) : null}
            {s.offer && (
              <button type="button" onClick={() => void actions.talk("Skip, I don't know the size", {}, 'ask')} className="press h-9 rounded-control bg-raised px-3 text-chrome font-medium text-ink hover:bg-active">
                Skip, design without it
              </button>
            )}
          </div>
          <BlockError block="ask" className="mt-2" />
        </li>
      )}

      {isWorking(s) && s.now && (
        <li className="flex items-center gap-2 text-chrome text-muted" aria-live="polite">
          <LiveDot />
          <span className="truncate">{s.now.text}</span>
        </li>
      )}

      <BlockError block="start" />
      <BlockError block="swap" />
      <BlockError block="feed" />
    </ol>
  )
}
