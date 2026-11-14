import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react'
import { LIVE } from '../api/config'
import { applyEvent, blank } from '../api/map'
import type { RunEvent } from '../api/wire'
import { SAMPLES } from '../data/loadSamples'
import { roomName } from '../lib/format'
import type { Point, Product, Session, WalkIn, WalkMove } from '../types'

/** Where an error belongs on screen, so it shows inside the block that failed. */
export type Block = 'rooms' | 'photo' | 'start' | 'ask' | 'swap' | 'walkin' | 'feed' | 'room'

export type State = {
  sessions: Session[]
  activeId: string
  sidebarOpen: boolean
  /** Phone only: the rooms sheet is open. */
  sheetOpen: boolean
  selectedProductId: string | null
  /** Product currently being swapped, with what the user asked for. */
  swapping: { productId: string; instruction: string } | null
  /** Last change to the total, shown briefly next to it. */
  lastDelta: { sessionId: string; eur: number; at: number } | null
  walkMode: boolean
  /** The viewpoint being placed, before the user confirms it. */
  draft: { from: Point; aimDeg: number } | null
  playingWalkInId: string | null
  compare: boolean
  /** Live mode: the rooms list is loading. */
  roomsLoading: boolean
  /** One error per block, per room. */
  errors: Partial<Record<Block, { sessionId: string; message: string }>>
  /** Bumped to listen to a room's run again (after a swap or walk-in on a finished run). */
  refollow: number
  /** Talking to the room: live caption, and a sentence waiting for the person to tap an item. */
  voice: { listening: boolean; caption: string; pending: string | null; error: string | null }
  /** The before-to-after reveal: which room plays it now, and the rooms already shown this visit. */
  reveal: { id: string; key: number } | null
  revealed: string[]
}

export type Action =
  | { type: 'select'; id: string }
  | { type: 'newRoom' }
  | { type: 'toggleSidebar' }
  | { type: 'setSheet'; open: boolean }
  | { type: 'selectProduct'; id: string | null }
  | { type: 'startSwap'; productId: string; instruction: string }
  | { type: 'finishSwap' }
  | { type: 'answer'; value: number }
  | { type: 'setPhoto'; url: string }
  | { type: 'startRun'; prompt: string; budgetEur: number; city: string }
  | { type: 'liveTick' }
  | { type: 'setWalkMode'; on: boolean }
  | { type: 'setDraft'; draft: State['draft'] }
  | { type: 'createWalkIn'; move: WalkMove; seconds: 5 | 8 }
  | { type: 'walkInReady'; id: string }
  | { type: 'play'; id: string | null }
  | { type: 'toggleCompare' }
  | { type: 'setRooms'; sessions: Session[] }
  | { type: 'upsertRoom'; session: Session; select?: boolean }
  | { type: 'patchRoom'; id: string; patch: Partial<Session> }
  | { type: 'removeRoom'; id: string }
  | { type: 'renameRoom'; id: string; name: string }
  | { type: 'resetRun'; id: string }
  | { type: 'runEvent'; id: string; event: RunEvent }
  | { type: 'addWalkIn'; id: string; walk: WalkIn }
  | { type: 'setError'; block: Block; sessionId: string; message: string | null }
  | { type: 'cancelSwap' }
  | { type: 'refollow' }
  | { type: 'setVoice'; voice: Partial<State['voice']> }
  | { type: 'replayReveal' }
  | { type: 'revealDone' }

const updateActive = (state: State, fn: (s: Session) => Session): State => ({
  ...state,
  sessions: state.sessions.map((s) => (s.id === state.activeId ? fn(s) : s)),
})

const clearTransient = {
  selectedProductId: null,
  swapping: null,
  walkMode: false,
  draft: null,
  playingWalkInId: null,
  compare: false,
} as const

let roomCount = 0

/** The first time a finished room is opened this visit, it plays the before-to-after reveal. */
function withReveal(state: State, force = false): State {
  const s = state.sessions.find((x) => x.id === state.activeId)
  if (!s || s.status !== 'done' || !s.afterSrc || (!force && state.revealed.includes(s.id))) return state
  return {
    ...state,
    reveal: { id: s.id, key: (state.reveal?.key ?? 0) + 1 },
    revealed: state.revealed.includes(s.id) ? state.revealed : [...state.revealed, s.id],
  }
}

const blankRoom = (): Session => ({
  id: `s-new-${++roomCount}`,
  name: 'New room',
  city: 'Athens',
  budgetEur: 500,
  wallCm: null,
  prompt: '',
  group: 'Today',
  updatedLabel: 'Now',
  status: 'new',
  beforeSrc: '',
  afterSrc: null,
  products: [],
  rejections: [],
  alternatives: {},
  walkIns: [],
  ask: null,
  now: null,
})

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'select':
      return withReveal({ ...state, ...clearTransient, activeId: action.id, sheetOpen: false, voice: { ...state.voice, pending: null, caption: '' } })

    case 'newRoom': {
      const room = blankRoom()
      return { ...state, ...clearTransient, sessions: [room, ...state.sessions], activeId: room.id, sheetOpen: false }
    }

    case 'toggleSidebar':
      return { ...state, sidebarOpen: !state.sidebarOpen }

    case 'setSheet':
      return { ...state, sheetOpen: action.open }

    case 'selectProduct':
      return { ...state, selectedProductId: action.id, walkMode: false, draft: null }

    case 'startSwap':
      return {
        ...updateActive(state, (s) => ({
          ...s,
          now: { text: `Working on “${action.instruction}”`, startedAt: Date.now() },
        })),
        swapping: { productId: action.productId, instruction: action.instruction },
      }

    case 'finishSwap': {
      if (!state.swapping) return state
      const { productId, instruction } = state.swapping
      const active = state.sessions.find((s) => s.id === state.activeId)
      const old = active?.products.find((p) => p.id === productId)
      if (!active || !old) return { ...state, swapping: null }
      const alt: Product = active.alternatives[productId] ?? { ...old, id: `${old.id}-b`, priceEur: Math.round(old.priceEur * 0.85 * 100) / 100, title: `${old.title} (alternative)` }
      return {
        ...updateActive(state, (s) => ({
          ...s,
          now: null,
          products: s.products.map((p) => (p.id === productId ? alt : p)),
          rejections: [
            { id: `r-${old.id}`, slot: old.slot, title: old.title, retailer: old.retailer, priceEur: old.priceEur, rule: 'style', reason: `Swapped out: you asked for “${instruction}”` },
            ...s.rejections,
          ],
        })),
        swapping: null,
        selectedProductId: alt.id,
        lastDelta: { sessionId: state.activeId, eur: alt.priceEur - old.priceEur, at: Date.now() },
      }
    }

    case 'answer':
      return updateActive(state, (s) => ({
        ...s,
        wallCm: action.value,
        ask: null,
        status: 'shopping',
        updatedLabel: 'Now',
        now: { text: `Searching for a reading chair that fits ${action.value} cm`, startedAt: Date.now() },
      }))

    case 'setPhoto':
      return updateActive(state, (s) => ({ ...s, beforeSrc: action.url }))

    case 'startRun': {
      return updateActive(state, (s) => ({
        ...s,
        name: roomName(action.prompt),
        prompt: action.prompt,
        budgetEur: action.budgetEur,
        city: action.city,
        status: 'asking',
        ask: { question: 'How wide is the main wall in your photo?', unit: 'cm' },
      }))
    }

    case 'liveTick':
      return {
        ...state,
        sessions: state.sessions.map((s) => {
          if (s.status !== 'shopping' || !s.script) return s
          const cursor = s.cursor ?? 0
          const step = s.script[cursor]
          if (!step) {
            // End of the recording: start again so the sample keeps moving.
            return { ...s, cursor: 0, products: [], rejections: [], now: { text: 'Reading your photo', startedAt: Date.now() } }
          }
          const next = { ...s, cursor: cursor + 1 }
          if (step.kind === 'now') return { ...next, now: { text: step.text, startedAt: Date.now() } }
          if (step.kind === 'chosen') return { ...next, products: [...s.products, step.product] }
          return { ...next, rejections: [...s.rejections, step.rejection] }
        }),
      }

    case 'setWalkMode':
      return { ...state, walkMode: action.on, draft: null, selectedProductId: null, compare: false }

    case 'setDraft':
      return { ...state, draft: action.draft }

    case 'createWalkIn': {
      if (!state.draft) return state
      const walk: WalkIn = {
        id: `w-${Date.now()}`,
        from: state.draft.from,
        aimDeg: state.draft.aimDeg,
        move: action.move,
        seconds: action.seconds,
        status: 'making',
        createdAt: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      }
      return {
        ...updateActive(state, (s) => ({ ...s, walkIns: [walk, ...s.walkIns] })),
        draft: null,
        walkMode: false,
      }
    }

    case 'walkInReady':
      return {
        ...state,
        sessions: state.sessions.map((s) => ({
          ...s,
          walkIns: s.walkIns.map((w) => (w.id === action.id ? { ...w, status: 'ready' } : w)),
        })),
      }

    case 'play':
      return { ...state, playingWalkInId: action.id, selectedProductId: null, walkMode: false, draft: null }

    case 'toggleCompare':
      return { ...state, compare: !state.compare, walkMode: false, draft: null, selectedProductId: null }

    case 'setRooms': {
      const byId = new Map(state.sessions.map((s) => [s.id, s]))
      const sessions = action.sessions.map((s) => ({ ...(byId.get(s.id) ?? {}), ...s }))
      const keep = sessions.some((s) => s.id === state.activeId)
      const list = sessions.length ? sessions : [draftRoom()]
      return { ...state, sessions: list, activeId: keep ? state.activeId : list[0].id, roomsLoading: false }
    }

    case 'upsertRoom': {
      const exists = state.sessions.some((s) => s.id === action.session.id)
      const sessions = exists
        ? state.sessions.map((s) => (s.id === action.session.id ? action.session : s))
        : [action.session, ...state.sessions.filter((s) => s.id !== DRAFT_ID)]
      return { ...state, ...(action.select ? clearTransient : {}), sessions, activeId: action.select ? action.session.id : state.activeId, sheetOpen: action.select ? false : state.sheetOpen }
    }

    case 'patchRoom':
      return { ...state, sessions: state.sessions.map((s) => (s.id === action.id ? { ...s, ...action.patch } : s)) }

    case 'renameRoom':
      return { ...state, sessions: state.sessions.map((s) => (s.id === action.id ? { ...s, name: action.name } : s)) }

    case 'removeRoom': {
      const rest = state.sessions.filter((s) => s.id !== action.id)
      const sessions = rest.length ? rest : [LIVE ? draftRoom() : blankRoom()]
      const activeId = state.activeId === action.id ? sessions[0].id : state.activeId
      return { ...state, ...(state.activeId === action.id ? clearTransient : {}), sessions, activeId }
    }

    case 'resetRun':
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === action.id ? { ...s, products: [], rejections: [], walkIns: [], afterSrc: null, ask: null, now: null, error: undefined, lastSeq: 0 } : s,
        ),
      }

    case 'runEvent': {
      const before = state.sessions.find((s) => s.id === action.id)
      const next = {
        ...state,
        sessions: state.sessions.map((s) => (s.id === action.id ? { ...applyEvent(s, action.event), lastSeq: action.event.seq } : s)),
      }
      // A swap finished: stop the spinner and show the change next to the total.
      const e = action.event
      if (e.type === 'product.swapped' && state.swapping?.productId === e.data.old_product_id) {
        const old = before?.products.find((p) => p.id === e.data.old_product_id)
        return {
          ...next,
          swapping: null,
          selectedProductId: e.data.product.id,
          lastDelta: old ? { sessionId: action.id, eur: e.data.product.price_eur - old.priceEur, at: Date.now() } : state.lastDelta,
        }
      }
      return e.type === 'done' && action.id === state.activeId ? withReveal(next, true) : next
    }

    case 'addWalkIn':
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === action.id && !s.walkIns.some((w) => w.id === action.walk.id) ? { ...s, walkIns: [action.walk, ...s.walkIns] } : s,
        ),
        draft: null,
        walkMode: false,
      }

    case 'setError': {
      const errors = { ...state.errors }
      if (action.message) errors[action.block] = { sessionId: action.sessionId, message: action.message }
      else delete errors[action.block]
      return { ...state, errors }
    }

    case 'replayReveal':
      return { ...state, ...clearTransient, reveal: { id: state.activeId, key: (state.reveal?.key ?? 0) + 1 } }

    case 'revealDone':
      return { ...state, reveal: null }

    case 'setVoice':
      return { ...state, voice: { ...state.voice, ...action.voice } }

    case 'refollow':
      return { ...state, refollow: state.refollow + 1 }

    case 'cancelSwap':
      return { ...updateActive(state, (s) => ({ ...s, now: null })), swapping: null }
  }
}

/** Live mode before the first room exists on the server: a local room that is created on first use. */
export const DRAFT_ID = 'draft'
const draftRoom = (): Session => ({ ...blank(DRAFT_ID), loaded: true })

const firstSessions = LIVE ? [draftRoom()] : SAMPLES.length ? SAMPLES : [blankRoom()]

const initial: State = {
  sessions: firstSessions,
  activeId: firstSessions[0].id,
  sidebarOpen: true,
  sheetOpen: false,
  selectedProductId: null,
  swapping: null,
  lastDelta: null,
  walkMode: false,
  draft: null,
  playingWalkInId: null,
  compare: false,
  roomsLoading: LIVE,
  errors: {},
  refollow: 0,
  voice: { listening: false, caption: '', pending: null, error: null },
  reveal: null,
  revealed: [],
}

const Ctx = createContext<{ state: State; dispatch: Dispatch<Action> } | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial, withReveal)
  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>
}

export function useStore() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStore outside StoreProvider')
  const active = ctx.state.sessions.find((s) => s.id === ctx.state.activeId) ?? ctx.state.sessions[0]
  return { ...ctx, active }
}
