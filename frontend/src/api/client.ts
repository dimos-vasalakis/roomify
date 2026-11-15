import { API_URL } from './config'
import { accessToken, supabase } from './supabase'
import type {
  ConversationDetail,
  ConversationSummary,
  ProfileOut,
  DepthOut,
  Model3DOut,
  PhotoDepthOut,
  HandoffOut,
  TranscriptOut,
  RunSummary,
  WalkinOut,
} from './wire'

/** An error a person can read: the back end's `detail`, or what went wrong on the way. */
export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const TIMEOUT_MS = 20_000

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')

  let response: Response
  try {
    response = await fetch(API_URL + path, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') throw new ApiError(0, 'The server took too long to answer. Try again.')
    console.warn(`Request to ${API_URL}${path} failed. Is the back end running, and is ${location.origin} listed in its FRONTEND_ORIGINS?`)
    throw new ApiError(0, "Can't reach the server. Check that the back end is running.")
  }

  if (response.status === 204) return undefined as T
  // The back end no longer accepts this login (expired or revoked): back to the login screen.
  if (response.status === 401) void supabase?.auth.signOut({ scope: 'local' })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : null
    if (response.status === 404 && !detail) throw new ApiError(404, 'This part of the back end is not built yet.')
    if (response.status === 405) throw new ApiError(405, 'This part of the back end is not built yet.')
    throw new ApiError(response.status, detail ?? `The server answered ${response.status}.`)
  }
  return body as T
}

const json = (body: unknown) => JSON.stringify(body)

export const api = {
  me: () => request<ProfileOut>('/me'),

  rooms: () => request<ConversationSummary[]>('/conversations'),
  room: (id: string) => request<ConversationDetail>(`/conversations/${id}`),
  createRoom: (title: string) => request<ConversationSummary>('/conversations', { method: 'POST', body: json({ title }) }),
  renameRoom: (id: string, title: string) =>
    request<ConversationSummary>(`/conversations/${id}`, { method: 'PATCH', body: json({ title }) }),
  deleteRoom: (id: string) => request<void>(`/conversations/${id}`, { method: 'DELETE' }),

  uploadPhoto: (id: string, photo: Blob) => {
    const form = new FormData()
    form.append('file', photo, 'room.jpg')
    return request<ConversationDetail>(`/conversations/${id}/photo`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) })
  },
  startRun: (id: string, body: { prompt: string; budget_eur: number; city: string; wall_width_cm: number | null }) =>
    request<RunSummary>(`/conversations/${id}/runs`, { method: 'POST', body: json(body) }),
  answer: (runId: string, value: number, unit: string) =>
    request<void>(`/runs/${runId}/answer`, { method: 'POST', body: json({ value, unit }) }),
  swap: (runId: string, productId: string, instruction: string) =>
    request<void>(`/runs/${runId}/swap`, { method: 'POST', body: json({ product_id: productId, instruction }) }),
  walkIn: (runId: string, body: { from: { x: number; y: number }; aim_deg: number; move: string; seconds: number }) =>
    request<WalkinOut>(`/runs/${runId}/walkins`, { method: 'POST', body: json(body) }),
  depth: (imageUrl: string) =>
    request<DepthOut>('/depth', { method: 'POST', body: json({ image_url: imageUrl }), signal: AbortSignal.timeout(60_000) }),
  /** The empty room photo's depth: the shell of the 3D room. */
  photoDepth: (photo: Blob) => {
    const form = new FormData()
    form.append('photo', photo, 'room.jpg')
    return request<PhotoDepthOut>('/depth/photo', { method: 'POST', body: form, signal: AbortSignal.timeout(90_000) })
  },
  /** A real 3D model (GLB) of one product, made from the shop's photos of it from every side its page shows.
   *  The first time takes up to about three minutes. */
  model3d: (imageUrl: string, pageUrl: string, title: string) =>
    request<Model3DOut>('/model3d', {
      method: 'POST',
      body: json({ image_url: imageUrl, page_url: pageUrl, title }),
      signal: AbortSignal.timeout(420_000),
    }),
  /** A drop box the phone can send a photo into (the QR code on the empty room). */
  openHandoff: () => request<HandoffOut>('/handoff', { method: 'POST' }),
  sendHandoff: (code: string, photo: Blob) => {
    const form = new FormData()
    form.append('photo', photo, 'room.jpg')
    return request<void>(`/handoff/${encodeURIComponent(code)}/photo`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) })
  },
  /** The photo once the phone has sent it, null while it hasn't. ApiError 404 once the code expired. */
  pickUpHandoff: async (code: string, signal?: AbortSignal): Promise<Blob | null> => {
    let response: Response
    try {
      response = await fetch(`${API_URL}/handoff/${encodeURIComponent(code)}`, { cache: 'no-store', signal: signal ?? AbortSignal.timeout(TIMEOUT_MS) })
    } catch {
      throw new ApiError(0, "Can't reach the server. Check that the back end is running.")
    }
    if (response.status === 204) return null
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw new ApiError(response.status, typeof body?.detail === 'string' ? body.detail : `The server answered ${response.status}.`)
    }
    return response.blob()
  },
  transcribe: (audio: Blob, signal?: AbortSignal) => {
    const form = new FormData()
    const ext = audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm'
    form.append('audio', audio, `speech.${ext}`)
    return request<TranscriptOut>('/transcribe', { method: 'POST', body: form, signal: signal ?? AbortSignal.timeout(40_000) })
  },
}
