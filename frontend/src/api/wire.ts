/* Shapes on the wire, snake_case, exactly as the back end sends them.
   Built routes mirror backend/app/models.py; the rest follow docs/API.md. Change both together. */

export type ProfileOut = {
  id: string
  email: string | null
  display_name: string | null
  avatar_url: string | null
  home_city: string | null
}

export type ConversationSummary = {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export type RunStatus = 'created' | 'running' | 'waiting_for_user' | 'done' | 'failed'

export type RunSummary = {
  id: string
  status: RunStatus
  prompt: string
  budget_eur: number
  total_eur: number | null
  created_at: string
  /** Not sent yet; requested in docs/API.md. */
  city?: string | null
  wall_width_cm?: number | null
}

export type MessageOut = {
  id: number
  role: 'user' | 'agent'
  content: string
  run_id: string | null
  created_at: string
}

export type ConversationDetail = ConversationSummary & {
  room_photo_url: string | null
  messages: MessageOut[]
  runs: RunSummary[]
}

export type ProductOut = {
  id: string
  url: string
  retailer: string
  title: string
  image_url: string
  price_eur: number
  width_cm: number | null
  depth_cm: number | null
  height_cm: number | null
  delivery_text: string | null
  in_stock: boolean | null
  currency?: string
}

export type BoxOut = { x: number; y: number; w: number; h: number }

/** POST /depth: the render's depth map, white near and black far. */
export type DepthOut = { depth_url: string; width: number; height: number }

/** POST /depth/photo: the depth of the person's own photo, and that photo on fal storage. */
/** The room measured in metres (MoGe-2), when it could be: distance along each grid ray, 0 unknown. */
export type GeometryOut = { fov_y: number; fov_x: number; cols: number; rows: number; distance: number[] }
export type RoomObjectOut = { name: string; box: { x: number; y: number; w: number; h: number }; on_top: boolean; crop_url: string }
export type PhotoDepthOut = DepthOut & { image_url: string; geometry?: GeometryOut | null; objects?: RoomObjectOut[] }

/** POST /model3d: a product's 3D model, made from its shop photo. */
/** POST /model3d: the model, and how many of the shop's photos (and which sides) it was made from. */
export type Model3DOut = { glb_url: string; views: number; sides: string[] }

/** POST /transcribe: what was said into the mic. */
export type TranscriptOut = { text: string }

export type WalkinOut = {
  id: string
  status: 'queued' | 'ready' | 'failed'
  from: { x: number; y: number }
  aim_deg: number
  move: 'push' | 'orbit' | 'rise'
  seconds: 5 | 8
  video_url: string | null
  poster_url: string | null
  created_at: string
}

/** One server-sent event of a run. Unknown types are ignored. */
export type RunEvent =
  | { type: 'run.status'; seq: number; data: { status: RunStatus } }
  | { type: 'step.started'; seq: number; data: { text: string; phase?: 'planning' | 'shopping' | 'rendering' | 'checking' } }
  | { type: 'plan.ready'; seq: number; data: { text: string; slots: string[]; currency?: string } }
  | { type: 'ask'; seq: number; data: { question: string; unit: string; suggestion?: number | null } }
  | { type: 'message'; seq: number; data: { text: string; action: 'ask' | 'design' | 'add' | 'drop' | 'swap' | 'arrange' | 'view' | 'reply' } }
  | { type: 'product.chosen'; seq: number; data: { slot: string; product: ProductOut; reason?: string } }
  | {
      type: 'candidate.rejected'
      seq: number
      data: {
        slot: string
        product: { title: string; retailer: string; url?: string; price_eur: number | null }
        rule: 'size' | 'budget' | 'page-check' | 'style' | 'trip'
        reason: string
      }
    }
  | { type: 'product.removed'; seq: number; data: { slot: string; url: string } }
  | { type: 'product.swapped'; seq: number; data: { slot: string; old_product_id: string; product: ProductOut; reason: string } }
  | { type: 'render.ready'; seq: number; data: { render_id: string; kind: string; image_url: string; items: { product_id: string; box: BoxOut }[] } }
  | { type: 'verify.result'; seq: number; data: { product_id: string; match: boolean; note: string } }
  | { type: 'walkin.queued'; seq: number; data: { walkin: WalkinOut } }
  | { type: 'video.ready'; seq: number; data: { walkin_id: string; video_url: string; poster_url: string | null } }
  | { type: 'walkin.failed'; seq: number; data: { walkin_id: string; error: string } }
  | { type: 'error'; seq: number; data: { message: string; retryable?: boolean; code?: string } }
  | { type: 'fit.proof'; seq: number; data: { product_id: string; ok: boolean; lines: string[] } }
  | { type: 'done'; seq: number; data: { total_eur: number; currency?: string } }
  /** The person changed the budget in words ("raise it to 800"): the new total, worked out by the server. */
  | { type: 'budget.changed'; seq: number; data: { budget_eur: number } }

/** POST /handoff: a drop box for a photo from the phone, open for `expires_in_s`. */
export type HandoffOut = { code: string; expires_in_s: number }
