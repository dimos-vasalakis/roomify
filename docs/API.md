# Roomify API contract

Shared between the front end (`frontend/src/api/`) and the back end (`backend/app/`). Written 2026-11-14 by the front end owner from the routes and tables already in `backend/`. The back end owner decides the implementation; change a shape here first and tell the team.

- Base URL: `VITE_API_URL` on the front end. JSON everywhere, `snake_case` on the wire.
- Saved-data routes need `Authorization: Bearer <Supabase access token>` (enforced by `app/auth.py`). `/health` and the demo `/offer` route do not require login.
- Errors: FastAPI's `{"detail": "<one readable sentence>"}`. The front end shows `detail` as is, so write it for a person.
- Images and videos are short-lived signed URLs (already done by `app/storage.py`).

## Status

| Route | State |
|---|---|
| `GET /health` | Built |
| `GET /me`, `PATCH /me`, `POST /me/avatar` | Built |
| `GET /conversations`, `POST /conversations`, `GET/PATCH/DELETE /conversations/{id}` | Built |
| `POST /conversations/{id}/photo` | Built |
| `POST /turn` (stream) | Built: the conversation the front end uses |
| `POST /conversations/{id}/runs` | **Needed** |
| `GET /runs/{run_id}/events` (stream) | **Needed** |
| `POST /runs/{run_id}/answer` | **Needed** |
| `POST /runs/{run_id}/swap` | **Needed** |
| `POST /runs/{run_id}/walkins` | **Needed** |

The front end already calls every route in this file. Until a route exists, the screen shows the route's error inside the block that needed it; nothing crashes.

## Built routes, as the front end uses them

- `GET /conversations` → `ConversationSummary[]`, newest first. The rooms sidebar.
- `POST /conversations {title}` → `ConversationSummary`. "New room" sends `{"title": "New room"}`.
- `GET /conversations/{id}` → `ConversationDetail`. Opening a room: photo, runs. The latest run in `runs` decides the room's state.
- `PATCH /conversations/{id} {title}` → rename. `DELETE /conversations/{id}` → 204.
- `GET /me` → `ProfileOut`. The account row at the bottom of the sidebar.

## Needed routes

### `POST /conversations/{id}/photo`
Multipart, field `file`, `image/jpeg`. The front end crops to 3:2 landscape and caps it at 1536 × 1024 before uploading, so every render and every box shares one geometry. Store at `rooms/{conversation_id}.jpg` in the `roomify` bucket, set `room_photo_path`, return `ConversationDetail`.

### `POST /conversations/{id}/runs`
```json
{ "prompt": "Desk and chair for long days", "budget_eur": 500, "city": "Athens", "wall_width_cm": null }
```
→ `201 RunSummary` with `status: "created"`, then the agent starts in the background. `409` if the room has no photo yet (`"Add a photo of the room first."`). The front end then opens the event stream.

### `GET /runs/{run_id}/events?after=<seq>`
Server-sent events. The front end reads it with `fetch` (not `EventSource`), so the `Authorization` header works and no token goes in the URL.

- First send every stored `run_events` row with `seq > after`, in order. Then, if the run is still going, keep streaming new events as they happen. If the run is `done` or `failed`, close after the stored events.
- Opening an old room replays its whole run from `after=0`, so one code path draws live and finished rooms.
- Each event:
  ```
  id: <seq>
  event: <type>
  data: <json payload>

  ```
- Send a comment line (`: keepalive`) every 15 s so proxies do not cut the stream.
- On a dropped connection the front end reconnects with `after=<last seq it saw>`.
- A swap or walk-in on a finished run adds new events to that run. Keep the stream open while that work is pending, then close. The front end reconnects with `after=<last seq>` right after it calls `swap` or `walkins`, and again every 2 s while that work has not reported back, so a stream that closes early only adds a short delay.

### `POST /runs/{run_id}/answer`
```json
{ "value": 160, "unit": "cm" }
```
→ `202`. Answers the run's open `ask`. Stores `wall_width_cm`, sets the run back to `running`; the result arrives as events.

### `POST /runs/{run_id}/swap`
```json
{ "product_id": "<products.id>", "instruction": "warmer, cheaper" }
```
→ `202`. The agent finds a replacement for that product's slot, re-renders that region, and reports through `product.swapped` and `render.ready` on the run's stream.

### `POST /runs/{run_id}/walkins`
```json
{ "from": { "x": 0.2, "y": 0.89 }, "aim_deg": 40, "move": "push", "seconds": 5 }
```
- `from`: where the camera stands, 0 to 1 of the latest render's width and height.
- `aim_deg`: which way it looks. 0 is up the image (into the room), 90 is right, -90 is left.
- `move`: `push` (walk forward), `orbit` (circle what it looks at), `rise` (lift up).
- `seconds`: 5 or 8.

→ `201 WalkinOut` with `status: "queued"`. The result arrives on the run's stream as `video.ready` or `walkin.failed`. Uses the latest render of the run.

**Table change needed:** `walkins` has no columns for the spot yet. Add `from_x`, `from_y` (float), `aim_deg` (float), `move` (text), `seconds` (int).

## Event types

Live offer refinement: `step.started` also accepts optional `phase` (`planning`, `shopping`, `rendering`, `checking`).
An `error` may include `code`, a sanitized exception class and HTTP status for deployment diagnostics; it is not displayed as user copy.
`product.chosen` may include `reason` (one sentence explaining relevance).
`plan.ready` carries `{text, slots: string[]}`: a short design direction and the requested pieces.
Offer completion requires a successful render. Unknown product positions are omitted from `render.ready.items`.
The client refines an offer by submitting the revised complete brief to `/offer`; receipt-only swaps and walk-ins are not offered on this path.

The front end ignores types it does not know, so new ones never break it. Names follow `docs/TECH_STACK.md`.

| Type | Payload | The screen |
|---|---|---|
| `run.status` | `{status}` (`running`, `waiting_for_user`, `done`, `failed`) | Room state |
| `step.started` | `{text}`, one plain sentence: "Searching ikea.gr for a white sofa under €750" | The Now line |
| `message` | `{text, action}`; `action` is `ask`, `design`, `add`, `drop`, `swap`, `arrange`, `view` or `reply` | The agent's chat line. `design` starts from an empty basket; the others keep it. Mid-run lines (`reply`) say what was left out and why, or that no faithful picture could be made; they go back in `history`, so later answers rest on them |
| `ask` | `{question, unit, suggestion}`; `suggestion` is the agent's own estimate (e.g. a wall width from the photo) or null | The question card, pre-filled; run is `waiting_for_user` |
| `fit.proof` | `{product_id, ok, lines}` | Only for pieces whose page gave a size, when the wall width is known: fit lines on the receipt and a tape measure on the room |
| `product.chosen` | `{slot, product: ProductOut}` | A receipt line, a shelf card |
| `candidate.rejected` | `{slot, product: {title, retailer, url, price_eur \| null}, rule, reason}` | A struck line with the reason. `rule`: `size`, `budget`, `page-check`, `style`, `trip` |
| `product.removed` | `{slot, url}` | That slot's piece leaves the basket and the total (sent by `drop`) |
| `product.swapped` | `{slot, old_product_id, product: ProductOut, reason}` | The line reprints; the old one is struck |
| `render.ready` | `{render_id, kind (render or view), image_url, items: [{product_id, box: {x, y, w, h}}]}` | The room picture and its price dots. Boxes are 0 to 1 of the render |
| `verify.result` | `{product_id, match, note}` | Reserved; shown later |
| `walkin.queued` | `{walkin: WalkinOut}` | A walk-in card appears. Sent when `POST /walkins` creates one, so reopening a room replays its walk-ins too |
| `video.ready` | `{walkin_id, video_url, poster_url}` | Walk-in becomes playable |
| `walkin.failed` | `{walkin_id, error}` | Walk-in card says why |
| `error` | `{message, retryable}` | The block-level error. Run becomes `failed` |
| `done` | `{total_eur, currency}` | Run finished. Every price is in its shop's own currency (`currency` on each product; `plan.ready` also carries the budget's currency) |

Reason sentences are for people and carry their numbers: "160 cm wide, your wall is 140 cm", "€619.00 would leave €171.00 for 4 items".

## Shapes

```ts
ProductOut = {
  id: string            // products.id
  url: string
  retailer: string      // "ikea.gr"
  title: string         // as the shop writes it, Greek included
  image_url: string     // the listing photo
  price_eur: number     // price at decision time (candidates.price_eur)
  width_cm: number | null
  depth_cm: number | null
  height_cm: number | null
  delivery_text: string | null
  in_stock: boolean | null
}

WalkinOut = {
  id: string
  status: "queued" | "ready" | "failed"
  from: { x: number, y: number }
  aim_deg: number
  move: "push" | "orbit" | "rise"
  seconds: 5 | 8
  video_url: string | null
  poster_url: string | null
  created_at: string
}
```

`ConversationSummary`, `ConversationDetail`, `RunSummary`, `MessageOut` and `ProfileOut` are as in `backend/app/models.py` today.

## Small additions that would help the screen

- `RunSummary`: add `city` and `wall_width_cm` (both already columns on `runs`). The front end reads them when present.
- `ConversationSummary`: add `thumb_url` (signed link to the latest render, or the room photo) and `latest_run: {status, budget_eur, total_eur} | null`. The rooms sidebar can then show each room's picture and state without opening every room. Until then it shows the room's name and when it was last changed.

## Demo routes (no login, no database)

Built 2026-11-14 for the stage and Vercel (`?demo=1` on the front end). Code: `backend/app/routes/offer.py`.

### `POST /offer`
Multipart: `photo` (JPEG, PNG or WebP, under 8 MB), `brief`, `budget_eur`, optional `city`, optional `wall_cm`.
Answers with the run's events as a stream: `run.status`, `step.started`, `plan.ready`, `candidate.rejected`, `product.chosen`, `render.ready`, `done`, or `error`.
- The loop lives in `app/agent/loop.py`. Vision reads the photo and brief through `llm()`, using the existing fal key (`FAL_LLM_MODEL`, default `google/gemini-2.5-flash`), or direct Gemini when only its key is configured. There is no silent keyword-only fallback.
- The scraper supplies real listings. A single vision judge chooses a coherent basket and checks its claims against evidence using `app/judges/basket.yaml` through the documented LLM fallback. IDs and total are validated before rendering.
- Budget preference: aim to use 50–80% of the entered allowance (around 70% ideally), choosing suitable upgrades over the cheapest basket. The full amount remains the hard ceiling; do not pad the room with unrequested items.
- The preview uses fal (`FAL_RENDER_MODEL`, default `fal-ai/nano-banana-2/edit`) with the room photo, brief and exact product images.
- Before rendering, a placement step reads the room's scale from visible anchors (doors, sockets, seats) and gives each product a spot and an apparent size from its listed W × D × H. The render gets those sizes, the spots and the anchors, at 2K (`FAL_RENDER_RESOLUTION`, `FAL_RENDER_THINKING`).
- Vision (`VISION_MODEL`, default `google/gemini-3-flash-preview`) then checks that the room is unchanged, that each product matches its shop photo, and its scale and placement. If something fails and time allows, the agent renders once more and says why in a `step.started` line. On that last try, a piece that differs from its shop photo loses its price dot instead of the whole room failing. A changed room or an invented piece is still an `error`.
- `/offer` centre-crops any photo to 3:2 and at most 1536 × 1024, so render, reveal and dots share one geometry whatever the client sends.
- Missing product positions are omitted. Render failure ends with `error`, preserving the basket; `done` requires a preview. Every model, image-read and render call is cached. A run has a six-minute deadline.
- Completed offers are retained for this browser tab, scoped to the signed-in account. They are not yet durable database runs.

### `POST /offer/swap`
Deprecated: returns 409 with instructions to refresh and adjust the brief. The client submits a new complete `/offer` so the preview and shopping list always update together.


## `POST /depth` (the 3D view)
JSON `{"image_url": "<a render's fal link>"}` → `{"depth_url", "width", "height"}`: a grayscale map the size of the render, white near and black far (Depth Anything v2 on fal, about 3 s). Only fal-hosted renders are accepted (`422` otherwise); a failed call is `502` with a readable `detail`. Saved forever per render, so a second open and `REPLAY=1` are instant. The front end builds the room as a mesh from it and lets the person look around the furnished room.

## `POST /transcribe` (the mic)
Multipart: `audio` (a short recording: `audio/webm`, `audio/mp4`, `audio/ogg`, `audio/wav` or `audio/mpeg`, under 6 MB) → `{"text"}`. Whisper on fal, any language, never cached. Used when the browser's own speech recognition is missing or fails (Firefox, Brave, Safari, in-app browsers, phones); Chrome and Edge still caption live and send without it. `415` for another format, `400` for an empty recording, `413` for a long one, `502` with a readable `detail` when the call fails.

## Phone to laptop (`/handoff`, the QR code)
- `POST /handoff` → `{"code", "expires_in_s"}`: a drop box for one room photo, kept in memory for 15 minutes. The laptop shows `<front end>/snap/<code>` as a QR code.
- `POST /handoff/{code}/photo`, multipart `photo` (JPEG, PNG, WebP or HEIC, under 12 MB) → `204`. The phone's page sends a 3:2 crop.
- `GET /handoff/{code}` → `204` while nothing new has arrived, the image itself once per photo (a retake replaces it), `404` with a readable `detail` once the code has expired.
No login: the 16-character random code is the only key.

## `GET /health/services`
Which outside services the server can use, never their keys: `{"firecrawl": {"state": "on" | "no FIRECRAWL_API_KEY" | "off: <reason>", "pages_read", "pages_failed", "last_error"}, "serper", "fal", "gemini", "replay"}`. Firecrawl switches itself off for 10 minutes after a rejected key (401) or no credits (402); a 403 about one site only fails that page.

## `POST /turn` (the conversation)
Multipart: `photo` (file), `message`, `budget`, `city`, optional `wall_cm`, `history` (JSON `[{role: "user"|"agent", text}]`), `basket` (JSON: the chosen pieces as the front end holds them, `{slot, url, title, price_eur, currency, width_cm, depth_cm, height_cm}`), optional `render_url` (the latest room picture; only fal-hosted links are accepted). Answers with the run's events as a stream.

The server keeps no conversation state, so a restart or a sleeping instance never loses a room. Each turn the agent decides one action from the photo, the conversation and the basket:
- `ask`: one question, only when it changes what is bought, never twice; for a wall width it proposes its own estimate from visible anchors (`suggestion`).
- `add`: more pieces on top of the basket; "another", "a second", "next to", "matching" always mean add, never a swap of the piece already there (a server rule backs the model up).
- `fit`: over budget, or "make it fit" / "too expensive": the priciest piece is swapped for one that brings the total within the budget; when no single swap can, the agent lists the pieces and asks which to drop.
- Budget in words ("raise it to 800", "€200 more", "lower it by 100", "halve it") is worked out exactly on the server and sent as `budget.changed` before the action, which then uses it.
- The decision is made by the sharper vision model, which writes a short `thinking` first (logged, never shown).
- `design`: plan, shop, check, choose, render, check the picture (the `/offer` path). Only for a first design or when the person asks to start over: it empties the basket.
- `add`: more pieces on top of the basket ("add a lamp"). Every chosen piece stays; only the new ones are shopped, with the budget left, at most 5 pieces in all. The new pieces are edited into the latest picture (checked like a swap), else the whole room is drawn again. Streams `product.chosen` only for the new pieces (a new slot, e.g. `"Lamp 2"` beside a `"Lamp"`), then `render.ready` and `done`, with `message.action` `"add"`.
- `drop`: take one chosen piece out ("remove the rug"). Nothing is bought; the other pieces stay. Streams `product.removed`, then the latest picture edited without it (checked like a swap, else the room drawn again), then `done`, with `message.action` `"drop"`.
- `swap`: re-shop one slot within the budget left, keep the rest, render again.
- `arrange`: keep every piece, render them placed as the person now asks ("bed against the wall"). Nothing is bought; the basket and total stay. Streams like `swap` (`step.started`, `render.ready`, `done`), with `message.action` `"arrange"`.
- `view`: the same furnished room from another camera position, checked against the pieces.
- `reply`: an answer from the basket (sizes, totals, fit), no shopping.

Basket pages are read again before a swap or a view, so nothing reaches a picture that was not read from a shop page. Outside Greece, products come from Google Shopping results through Serper (`SERPER_API_KEY`) and are read from any shop's own page; in Greece the shop catalogues come first.
