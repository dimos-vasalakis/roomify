import { ApiError, api } from '../api/client'
import { LIVE } from '../api/config'
import { fromDetail, fromSummary, walkIn } from '../api/map'
import { roomName } from '../lib/format'
import { toRoomPhoto } from '../lib/photo'
import type { WalkMove } from '../types'
import { DRAFT_ID, useStore, type Block } from './store'

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

  return {
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

    async deleteRoom(id: string) {
      if (!LIVE || id === DRAFT_ID) return dispatch({ type: 'removeRoom', id })
      await guard('rooms', id, async () => {
        await api.deleteRoom(id)
        dispatch({ type: 'removeRoom', id })
      })
    },

    async setPhoto(file: File) {
      return guard('photo', active.id, async () => {
        const photo = await toRoomPhoto(file)
        if (!LIVE) return dispatch({ type: 'setPhoto', url: URL.createObjectURL(photo) })
        const id = await ensureRoom()
        const detail = await api.uploadPhoto(id, photo)
        dispatch({ type: 'patchRoom', id, patch: { beforeSrc: detail.room_photo_url ?? URL.createObjectURL(photo) } })
      })
    },

    async startRun(prompt: string, budgetEur: number, city: string) {
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
      if (!LIVE) return
      const runId = active.runId
      const ok = !!runId && (await guard('swap', active.id, async () => api.swap(runId, productId, instruction)))
      if (!ok) dispatch({ type: 'cancelSwap' })
      else dispatch({ type: 'refollow' })
    },

    async makeWalkIn(move: WalkMove, seconds: 5 | 8) {
      if (!LIVE) return void dispatch({ type: 'createWalkIn', move, seconds })
      const runId = active.runId
      const draft = state.draft
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
