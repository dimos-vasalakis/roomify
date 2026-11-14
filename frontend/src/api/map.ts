/* Turn the back end's shapes into the screen's room model, and fold run events into a room. */
import type { Product, Session, SessionStatus, WalkIn } from '../types'
import type { ConversationDetail, ConversationSummary, ProductOut, RunEvent, RunStatus, WalkinOut } from './wire'

const DAY = 86_400_000

function groupOf(iso: string): Session['group'] {
  const d = new Date(iso)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = today.getTime() - new Date(d).setHours(0, 0, 0, 0)
  if (diff <= 0) return 'Today'
  if (diff <= DAY) return 'Yesterday'
  if (diff <= 7 * DAY) return 'Last week'
  return 'Earlier'
}

function labelOf(iso: string) {
  const d = new Date(iso)
  return groupOf(iso) === 'Today'
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export const statusOf = (s: RunStatus): SessionStatus =>
  ({ created: 'shopping', running: 'shopping', waiting_for_user: 'asking', done: 'done', failed: 'failed' })[s] as SessionStatus

/** A room from the rooms list, before its details load. */
export function fromSummary(c: ConversationSummary, previous?: Session): Session {
  return {
    ...(previous ?? blank(c.id)),
    id: c.id,
    name: c.title,
    group: groupOf(c.updated_at),
    updatedLabel: labelOf(c.updated_at),
  }
}

/** A room with its photo and its latest run. Products and renders arrive by replaying the run's events. */
export function fromDetail(c: ConversationDetail, previous?: Session): Session {
  const base = fromSummary(c, previous)
  const run = c.runs.at(-1)
  return {
    ...base,
    beforeSrc: c.room_photo_url ?? '',
    status: run ? statusOf(run.status) : 'new',
    prompt: run?.prompt ?? '',
    budgetEur: run?.budget_eur ?? base.budgetEur,
    city: run?.city ?? base.city,
    wallCm: run?.wall_width_cm ?? base.wallCm,
    runId: run?.id,
    loaded: true,
  }
}

export function blank(id: string): Session {
  return {
    id,
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
    loaded: false,
  }
}

/** Until a render places it, a product sits centred; its picture is the listing photo. */
function product(p: ProductOut, slot: string): Product {
  return {
    id: p.id,
    slot,
    title: p.title,
    retailer: p.retailer,
    url: p.url,
    priceEur: p.price_eur,
    widthCm: p.width_cm,
    depthCm: p.depth_cm,
    deliveryText: p.delivery_text,
    box: { x: 0.45, y: 0.45, w: 0.1, h: 0.1 },
    thumb: { src: p.image_url },
  }
}

export function walkIn(w: WalkinOut): WalkIn {
  return {
    id: w.id,
    from: w.from,
    aimDeg: w.aim_deg,
    move: w.move,
    seconds: w.seconds,
    status: w.status === 'queued' ? 'making' : w.status,
    createdAt: new Date(w.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    videoUrl: w.video_url,
    posterUrl: w.poster_url,
  }
}

const now = (text: string) => ({ text, startedAt: Date.now() })

/** Fold one run event into a room. Pure; unknown events leave the room as it is. */
export function applyEvent(s: Session, e: RunEvent): Session {
  switch (e.type) {
    case 'run.status': {
      const status = statusOf(e.data.status)
      return { ...s, status, now: status === 'done' || status === 'failed' ? null : s.now, ask: status === 'asking' ? s.ask : null }
    }
    case 'step.started':
      return { ...s, now: now(e.data.text), status: s.status === 'asking' || s.status === 'new' ? 'shopping' : s.status }
    case 'ask':
      return { ...s, status: 'asking', ask: { question: e.data.question, unit: e.data.unit }, now: null }
    case 'product.chosen':
      if (s.products.some((p) => p.id === e.data.product.id)) return s
      return { ...s, products: [...s.products, product(e.data.product, e.data.slot)] }
    case 'candidate.rejected':
      return {
        ...s,
        rejections: [
          ...s.rejections,
          {
            id: `r${e.seq}`,
            slot: e.data.slot,
            title: e.data.product.title,
            retailer: e.data.product.retailer,
            priceEur: e.data.product.price_eur,
            rule: e.data.rule,
            reason: e.data.reason,
          },
        ],
      }
    case 'product.swapped': {
      const old = s.products.find((p) => p.id === e.data.old_product_id)
      const next = product(e.data.product, e.data.slot)
      return {
        ...s,
        products: s.products.map((p) => (p.id === e.data.old_product_id ? { ...next, box: p.box } : p)),
        rejections: old
          ? [...s.rejections, { id: `r${e.seq}`, slot: old.slot, title: old.title, retailer: old.retailer, priceEur: old.priceEur, rule: 'style', reason: e.data.reason }]
          : s.rejections,
        now: null,
      }
    }
    case 'render.ready': {
      const boxes = new Map(e.data.items.map((i) => [i.product_id, i.box]))
      return {
        ...s,
        afterSrc: e.data.image_url,
        products: s.products.map((p) => (boxes.has(p.id) ? { ...p, box: boxes.get(p.id)! } : p)),
      }
    }
    case 'walkin.queued':
      if (s.walkIns.some((w) => w.id === e.data.walkin.id)) return s
      return { ...s, walkIns: [walkIn(e.data.walkin), ...s.walkIns] }
    case 'video.ready':
      return {
        ...s,
        walkIns: s.walkIns.map((w) =>
          w.id === e.data.walkin_id ? { ...w, status: 'ready', videoUrl: e.data.video_url, posterUrl: e.data.poster_url } : w,
        ),
      }
    case 'walkin.failed':
      return { ...s, walkIns: s.walkIns.map((w) => (w.id === e.data.walkin_id ? { ...w, status: 'failed', error: e.data.error } : w)) }
    case 'error':
      return {
        ...s,
        status: 'failed',
        now: null,
        error: { what: e.data.message, lastGood: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) },
      }
    case 'done':
      return { ...s, status: 'done', now: null, ask: null }
    default:
      return s
  }
}
