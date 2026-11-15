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
  /** Where its dot goes: a point on the piece itself, so it never floats between legs. */
  anchor?: { x: number; y: number }
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

export type ChatLine = { role: 'user' | 'agent'; text: string }

export type SessionStatus = 'new' | 'asking' | 'shopping' | 'drawing' | 'done' | 'failed'

/** One step of a live run, used by the recorded sample run. */
export type LiveStep =
  | { kind: 'now'; text: string }
  | { kind: 'chosen'; product: Product }
  | { kind: 'rejected'; rejection: Rejection }

/** A length drawn on the room photo: two points (0 to 1 of the picture), its size, and what it is. */
export type Measure = { id: string; a: { x: number; y: number }; b: { x: number; y: number }; cm: number; label: string }

export type Session = {
  /** Portable, explicitly labelled 3D recording; all assets are local. */
  recorded3d?: string
  id: string
  name: string
  city: string
  budgetEur: number
  /** The one measurement the user gave, in cm. */
  wallCm: number | null
  /** Lengths the person drew on the photo and named; sent with every message as size limits. */
  measures?: Measure[]
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
  /** The room as it was before each of the last few messages, newest last: Undo, Stop and failures go back to it. */
  past?: Checkpoint[]
}

/** What a message can change about a room, saved before the message is sent. */
export type Checkpoint = Pick<
  Session,
  'products' | 'rejections' | 'afterSrc' | 'chat' | 'status' | 'budgetEur' | 'wallCm' | 'prompt' | 'name' | 'direction' | 'ask' | 'currency'
> & { said: string }
