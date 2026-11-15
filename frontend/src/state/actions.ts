import { ApiError, api } from '../api/client'
import { LIVE, OFFERS } from '../api/config'
import { followTurn } from '../api/stream'
import { fromDetail, fromSummary, walkIn } from '../api/map'
import { money, roomName } from '../lib/format'
import { compose, isWorking, totalOf } from '../lib/session'
import { toRoomPhoto } from '../lib/photo'
import type { Session, WalkMove } from '../types'
import { DRAFT_ID, MAX_PAST, checkpointOf, useStore, type Block } from './store'

/** The prepared photo of each room, kept for sending with the offer. */
const photos = new Map<string, Blob>()
/** The open stream of each room's message, so Stop can end it. */
const streams = new Map<string, () => void>()
/** Rooms deleted a moment ago: the server delete waits, so Undo can bring them back. */
const deleting = new Map<string, ReturnType<typeof setTimeout>>()
const UNDO_MS = 6000

const message = (err: unknown) =>
  err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong. Try again.'

/**
 * Everything the person can do. With the back end configured these call the API and the results
 * arrive through the run's event stream; with local samples they act on the sample rooms.
 */
export function useActions() {
  const { state, active, dispatch } = useStore()

  const guard = async (block: Block, sessionId: string, fn: () => Promise<void>): Promise<boolean> => {
    dispatch({ type: 'setError', block, sessionId, message: null })
    try {
      await fn()
      return true
    } catch (err) {
      dispatch({ type: 'setError', block, sessionId, message: message(err) })
      return false
    }
  }

  /** Live: the draft room becomes a real one on first use. */
  const ensureRoom = async (): Promise<string> => {
    if (active.id !== DRAFT_ID) return active.id
    const created = await api.createRoom(active.name || 'New room')
    dispatch({ type: 'upsertRoom', session: { ...active, ...fromSummary(created, active), loaded: true }, select: true })
    return created.id
  }

  /**
   * One message to the agent (POST /turn): the first brief, an answer, a change or a question.
   * The room's conversation and basket go with it, so the server keeps no state.
   */
  const talk = async (text: string, room: Partial<Session> = {}, block: Block = 'start') => {
    const said = text.trim()
    if (!said) return
    await guard(block, active.id, async () => {
      const photo = photos.get(active.id) ?? (active.beforeSrc ? await (await fetch(active.beforeSrc)).blob() : null)
      if (!photo) throw new Error('Add a photo of the room first.')
      const id = LIVE ? await ensureRoom() : active.id
      const s = { ...active, ...room }
      const name = s.name === 'New room' ? roomName(said) : s.name
      const history = s.chat ?? []
      // The room as it is now, so Undo, Stop or a failure can come back to it. A failed room is
      // not a place to come back to: its own checkpoint is already saved.
      const past = active.status === 'failed' || isWorking(active)
        ? active.past ?? []
        : [...(active.past ?? []), checkpointOf(active, said)].slice(-MAX_PAST)
      dispatch({
        type: 'patchRoom',
        id,
        patch: { ...room, name, prompt: s.prompt || said, offer: true, ask: null, status: 'shopping', error: undefined, past,
                 chat: [...history, { role: 'user', text: said }], now: { text: 'Thinking about what you said', startedAt: Date.now() } },
      })
      if (LIVE && name !== active.name) void api.renameRoom(id, name).catch(() => undefined)
      const form = new FormData()
      form.append('photo', photo, 'room.jpg')
      form.append('message', said)
      form.append('budget', String(s.budgetEur))
      form.append('city', s.city)
      if (s.wallCm) form.append('wall_cm', String(s.wallCm))
      form.append('history', JSON.stringify(history.slice(-20)))
      form.append('basket', JSON.stringify(s.products.map((p) => ({
        slot: p.slot, url: p.url, title: p.title, price_eur: p.priceEur, currency: p.currency ?? 'EUR',
        width_cm: p.widthCm, depth_cm: p.depthCm, height_cm: p.heightCm ?? null,
      }))))
      if (s.afterSrc?.startsWith('https://')) form.append('render_url', s.afterSrc)
      let got = 0
      let completed = false
      const stop = followTurn(form, {
        onEvent: (event) => {
          got += 1
          if (event.type === 'done' || event.type === 'error' || event.type === 'ask') completed = true
          dispatch({ type: 'runEvent', id, event })
        },
        onEnd: () => {
          streams.delete(id)
          if (!completed) dispatch({ type: 'patchRoom', id, patch: { status: 'failed', now: null, error: { what: 'The connection ended before the agent finished. Try again.', lastGood: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) } } })
        },
        onTrouble: (problem) => {
          streams.delete(id)
          // Nothing arrived: back where we were, with the reason. Mid-way: keep what was found.
          if (!got) {
            dispatch({ type: 'patchRoom', id, patch: { status: s.products.length ? 'done' : 'new', now: null, chat: history, past: active.past ?? [] } })
            compose(said) // the message comes back to the composer, ready to send again
            dispatch({ type: 'setError', block, sessionId: id, message: problem })
          } else {
            dispatch({ type: 'patchRoom', id, patch: { status: 'failed', now: null, error: { what: problem, lastGood: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) } } })
          }
        },
      })
      streams.set(id, stop)
    })
  }

  /** Back to the room before the last message: the message returns to the composer to edit. */
  const undo = (id = active.id) => {
    const room = state.sessions.find((x) => x.id === id)
    const back = room?.past?.at(-1)
    if (!room || !back) return
    streams.get(id)?.()
    streams.delete(id)
    dispatch({ type: 'undo', id })
    if (id === active.id) compose(back.said)
    dispatch({ type: 'toast', toast: { text: `Back to the room before “${back.said.length > 48 ? back.said.slice(0, 47) + '…' : back.said}”` } })
  }

  return {
    undo,

    /** Stop the agent mid-message: the room goes back to how it was. */
    stop() {
      if (active.past?.length) return undo(active.id)
      streams.get(active.id)?.()
      streams.delete(active.id)
      dispatch({ type: 'patchRoom', id: active.id, patch: { status: active.products.length ? 'done' : 'new', now: null } })
    },

    /** A budget can change at any time; the next message carries it to the agent. */
    setBudget(eur: number) {
      const value = Math.round(eur)
      if (!Number.isFinite(value) || value < 20 || value === active.budgetEur) return
      dispatch({ type: 'patchRoom', id: active.id, patch: { budgetEur: value } })
    },

    /** Over budget: ask for the same room for less. */
    fitBudget() {
      const target = money(active.budgetEur, active.currency)
      const over = money(totalOf(active) - active.budgetEur, active.currency)
      return talk(`That is ${over} over my budget. Bring the total under ${target}: swap the priciest pieces for cheaper ones that still fit, and keep the rest.`, {}, 'swap')
    },

    async newRoom() {
      if (!LIVE) return dispatch({ type: 'newRoom' })
      await guard('rooms', active.id, async () => {
        const created = await api.createRoom('New room')
        dispatch({ type: 'upsertRoom', session: { ...fromSummary(created), loaded: true }, select: true })
      })
    },

    async renameRoom(id: string, name: string) {
      const title = name.trim()
      const before = state.sessions.find((s) => s.id === id)?.name
      if (!title || title === before) return
      dispatch({ type: 'renameRoom', id, name: title })
      if (!LIVE || id === DRAFT_ID) return
      const ok = await guard('rooms', id, async () => void (await api.renameRoom(id, title)))
      if (!ok && before) dispatch({ type: 'renameRoom', id, name: before })
    },

    /** Gone at once, with Undo for a few seconds; the server only deletes once that has passed. */
    deleteRoom(id: string) {
      const room = state.sessions.find((x) => x.id === id)
      if (!room) return
      streams.get(id)?.()
      streams.delete(id)
      const index = state.sessions.findIndex((x) => x.id === id)
      dispatch({ type: 'removeRoom', id })
      const forGood = () => {
        deleting.delete(id)
        if (!LIVE || id === DRAFT_ID) return
        api.deleteRoom(id).catch((err: unknown) => {
          // The server kept it: show it again rather than pretend it is gone.
          dispatch({ type: 'restoreRoom', session: room, index })
          dispatch({ type: 'setError', block: 'rooms', sessionId: '', message: message(err) })
        })
      }
      deleting.set(id, setTimeout(forGood, UNDO_MS))
      dispatch({
        type: 'toast',
        toast: {
          text: `Deleted “${room.name}”`,
          undo: () => {
            clearTimeout(deleting.get(id))
            deleting.delete(id)
            dispatch({ type: 'restoreRoom', session: room, index, select: true })
          },
        },
      })
    },

    async setPhoto(file: File) {
      return guard('photo', active.id, async () => {
        const photo = await toRoomPhoto(file)
        dispatch({ type: 'resetRun', id: active.id })
        photos.set(active.id, photo)
        if (!LIVE) {
          const url = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.onerror = () => reject(new Error("This photo couldn't be read. Choose another one."))
            reader.readAsDataURL(photo)
          })
          return dispatch({ type: 'patchRoom', id: active.id, patch: { beforeSrc: url } })
        }
        const id = await ensureRoom()
        photos.set(id, photo)
        const detail = await api.uploadPhoto(id, photo)
        dispatch({ type: 'patchRoom', id, patch: { beforeSrc: detail.room_photo_url ?? URL.createObjectURL(photo) } })
      })
    },

    talk,

    /** "Try again" in a conversation: send the last message again, keeping the room as it was. */
    async retry() {
      const chat = active.chat ?? []
      const last = chat.map((line) => line.role).lastIndexOf('user')
      if (last === -1) return talk(active.prompt, { chat: [] })
      return talk(chat[last].text, { chat: chat.slice(0, last) })
    },

    async startRun(prompt: string, budgetEur: number, city: string, wallCm: number | null = null) {
      if (OFFERS) {
        // The first message of the conversation: a fresh room, then the brief.
        dispatch({ type: 'resetRun', id: active.id })
        await talk(prompt, { budgetEur, city, wallCm, chat: [], products: [], afterSrc: null, prompt })
        return
      }
      if (!LIVE) return void dispatch({ type: 'startRun', prompt, budgetEur, city })
      await guard('start', active.id, async () => {
        const id = await ensureRoom()
        const run = await api.startRun(id, { prompt, budget_eur: budgetEur, city, wall_width_cm: null })
        dispatch({ type: 'resetRun', id })
        dispatch({ type: 'patchRoom', id, patch: { runId: run.id, prompt, budgetEur, city, status: 'shopping', now: { text: 'Reading your photo', startedAt: Date.now() } } })
        // The room title follows the brief, like a chat named after its first message.
        if (active.name === 'New room') {
          const named = roomName(prompt)
          dispatch({ type: 'renameRoom', id, name: named })
          void api.renameRoom(id, named).catch(() => undefined)
        }
      })
    },

    async answer(value: number) {
      // In a conversation the answer is simply the next message, with the width remembered.
      if (active.offer) return talk(`${value} ${active.ask?.unit ?? 'cm'}`, { wallCm: value }, 'ask')
      if (!LIVE) return void dispatch({ type: 'answer', value })
      const runId = active.runId
      if (!runId) return
      await guard('ask', active.id, async () => {
        await api.answer(runId, value, active.ask?.unit ?? 'cm')
        dispatch({ type: 'patchRoom', id: active.id, patch: { wallCm: value, ask: null, status: 'shopping' } })
      })
    },

    async swap(productId: string, instruction: string) {
      dispatch({ type: 'startSwap', productId, instruction })
      if (active.offer) {
        const p = active.products.find((x) => x.id === productId)
        dispatch({ type: 'cancelSwap' })
        if (p) await talk(`Change the ${p.slot.toLowerCase()}: ${instruction}`, {}, 'swap')
        return
      }
      if (!LIVE) return
      const runId = active.runId
      const ok = !!runId && (await guard('swap', active.id, async () => api.swap(runId, productId, instruction)))
      if (!ok) dispatch({ type: 'cancelSwap' })
      else dispatch({ type: 'refollow' })
    },

    async makeWalkIn(move: WalkMove, seconds: 5 | 8, view?: { from: { x: number; y: number }; aimDeg: number }) {
      if (!LIVE) return void dispatch({ type: 'createWalkIn', move, seconds, view })
      const runId = active.runId
      const draft = view ?? state.draft
      if (!runId || !draft) return
      await guard('walkin', active.id, async () => {
        const made = await api.walkIn(runId, { from: draft.from, aim_deg: Math.round(draft.aimDeg), move, seconds })
        dispatch({ type: 'addWalkIn', id: active.id, walk: walkIn(made) })
        dispatch({ type: 'refollow' })
      })
    },

    /** Reload one room from the server (used by "Try again"). */
    async reloadRoom(id: string) {
      if (!LIVE || id === DRAFT_ID) return
      await guard('room', id, async () => {
        const detail = await api.room(id)
        dispatch({ type: 'upsertRoom', session: fromDetail(detail, state.sessions.find((s) => s.id === id)) })
      })
    },
  }
}
