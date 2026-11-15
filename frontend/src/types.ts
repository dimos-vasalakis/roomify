/** Shared shapes. Mirrors the back end's models; see docs/TECH_STACK.md. */

/** A rectangle on the room image, every value 0 to 1 of the image's width or height. */
export type Box = { x: number; y: number; w: number; h: number }

/** A point on the room image, 0 to 1. */
export type Point = { x: number; y: number }

export type Product = {
  id: string
  slot: string
  title: string
  retailer: string
  url: string
  /** In `currency`, the shop's own (the name predates shops outside the euro). */
  priceEur: number
  currency?: string
  widthCm: number | null
  depthCm: number | null
  heightCm?: number | null
  deliveryText: string | null
  /** Where the product sits in the rendered room. */
  box: Box
  /** The product's own picture: the shop's listing photo (whole, no box) or a region of a sample photo. */
  thumb?: { src: string; box?: Box }
  reason?: string
  placed?: boolean
  /** The fit check's lines, only when the page gave the size and the wall width is known. */
  fit?: string[]
  fitOk?: boolean
}

export type RejectRule = 'size' | 'budget' | 'page-check' | 'style' | 'trip'

export type Rejection = {
  id: string
  slot: string
  title: string
  retailer: string
  priceEur: number | null
  rule: RejectRule
  reason: string
}

export type WalkMove = 'push' | 'orbit' | 'rise'

export type WalkIn = {
  id: string
  from: Point
  /** Direction the camera looks, in degrees: 0 is up the image (into the room), 90 is right. */
  aimDeg: number
  move: WalkMove
  seconds: 5 | 8
  status: 'making' | 'ready' | 'failed'
  createdAt: string
  /** The real clip, once the back end has made it. Samples have none and simulate the move. */
  videoUrl?: string | null
  posterUrl?: string | null
  error?: string
}

export type ChatLine = { role: 'user' | 'agent'; text: string }

export type SessionStatus = 'new' | 'asking' | 'shopping' | 'drawing' | 'done' | 'failed'

/** One step of a live run, used by the recorded sample run. */
export type LiveStep =
  | { kind: 'now'; text: string }
  | { kind: 'chosen'; product: Product }
  | { kind: 'rejected'; rejection: Rejection }

export type Session = {
  id: string
  name: string
  city: string
  budgetEur: number
  /** The one measurement the user gave, in cm. */
  wallCm: number | null
  prompt: string
  group: 'Today' | 'Yesterday' | 'Last week' | 'Earlier'
  updatedLabel: string
  status: SessionStatus
  beforeSrc: string
  afterSrc: string | null
  products: Product[]
  rejections: Rejection[]
  /** Replacement products the agent would pick on a swap, keyed by the product they replace. */
  alternatives: Record<string, Product>
  walkIns: WalkIn[]
  /** The question the agent is waiting on, when status is 'asking'. */
  ask: { question: string; unit: string; suggestion?: number | null } | null
  /** The conversation with the agent about this room, oldest first. */
  chat?: ChatLine[]
  /** The budget's currency, from the city ("EUR", "USD"). */
  currency?: string
  /** The agent's current step, when it is working. */
  now: { text: string; startedAt: number } | null
  /** Recorded run for the live sample. */
  script?: LiveStep[]
  /** How far through the recorded run the sample has played. */
  cursor?: number
  error?: { what: string; lastGood: string }
  /** Live mode: the run this room shows, and how much of the room has loaded. */
  runId?: string
  loaded?: boolean
  /** The last run event this room has seen, to pick the stream up again from there. */
  lastSeq?: number
  /** This room's basket came from a real POST /offer (not a sample, not a saved run). */
  offer?: boolean
  direction?: string
  phase?: 'planning' | 'shopping' | 'rendering' | 'checking'
}
