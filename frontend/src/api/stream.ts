import { API_URL } from './config'
import { accessToken } from './supabase'
import type { RunEvent } from './wire'

type Handlers = {
  onEvent: (event: RunEvent) => void
  /** The stream ended because the run is finished. */
  onEnd?: () => void
  /** A connection problem, with a sentence for the person. Reconnects follow on their own. */
  onTrouble?: (message: string) => void
}

/**
 * Follow a run's events (docs/API.md). Uses fetch rather than EventSource so the login token
 * travels in a header, not the URL. Replays from `after`, reconnects from the last event seen.
 * Returns a function that stops listening.
 */
export function followRun(runId: string, handlers: Handlers, after = 0): () => void {
  const controller = new AbortController()
  let lastSeq = after
  let attempt = 0

  const connect = async (): Promise<void> => {
    const token = await accessToken()
    let response: Response
    try {
      response = await fetch(`${API_URL}/runs/${runId}/events?after=${lastSeq}`, {
        headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: controller.signal,
      })
    } catch {
      if (controller.signal.aborted) return
      return retry("Lost the connection to the agent. Reconnecting…")
    }
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => null)
      const detail = typeof body?.detail === 'string' ? body.detail : null
      if (response.status === 404 || response.status === 405) {
        handlers.onTrouble?.(detail ?? "The agent's live feed is not built in the back end yet.")
        return
      }
      if (response.status === 401) {
        handlers.onTrouble?.(detail ?? 'Login expired. Log in again.')
        return
      }
      return retry(detail ?? `The live feed answered ${response.status}. Reconnecting…`)
    }

    attempt = 0
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += value
        let cut: number
        while ((cut = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, cut)
          buffer = buffer.slice(cut + 2)
          const event = parse(block)
          if (event) {
            lastSeq = event.seq
            handlers.onEvent(event)
          }
        }
      }
      handlers.onEnd?.()
    } catch {
      if (controller.signal.aborted) return
      return retry('Lost the connection to the agent. Reconnecting…')
    }
  }

  const retry = (message: string) => {
    handlers.onTrouble?.(message)
    attempt += 1
    const wait = Math.min(8000, 500 * 2 ** attempt)
    setTimeout(() => !controller.signal.aborted && void connect(), wait)
  }

  void connect()
  return () => controller.abort()
}

function parse(block: string): RunEvent | null {
  let id = ''
  let type = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'id') id = value
    else if (field === 'event') type = value
    else if (field === 'data') data.push(value)
  }
  if (!data.length) return null
  try {
    return { type, seq: Number(id) || 0, data: JSON.parse(data.join('\n')) } as RunEvent
  } catch {
    return null
  }
}
