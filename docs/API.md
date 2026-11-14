# Roomify API contract

Shared between the front end (`frontend/src/api/`) and the back end (`backend/app/`). Written 2026-11-14 by the front end owner from the routes and tables already in `backend/`. The back end owner decides the implementation; change a shape here first and tell the team.

- Base URL: `VITE_API_URL` on the front end. JSON everywhere, `snake_case` on the wire.
- Every route except `/health` needs `Authorization: Bearer <Supabase access token>` (already enforced by `app/auth.py`).
- Errors: FastAPI's `{"detail": "<one readable sentence>"}`. The front end shows `detail` as is, so write it for a person.
- Images and videos are short-lived signed URLs (already done by `app/storage.py`).

## Status

| Route | State |
|---|---|
| `GET /health` | Built |
| `GET /me`, `PATCH /me`, `POST /me/avatar` | Built |
| `GET /conversations`, `POST /conversations`, `GET/PATCH/DELETE /conversations/{id}` | Built |
| `POST /conversations/{id}/photo` | **Needed** |
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

The front end ignores types it does not know, so new ones never break it. Names follow `docs/TECH_STACK.md`.

| Type | Payload | The screen |
|---|---|---|
| `run.status` | `{status}` (`running`, `waiting_for_user`, `done`, `failed`) | Room state |
| `step.started` | `{text}`, one plain sentence: "Searching ikea.gr for a white sofa under €750" | The Now line |
| `ask` | `{question, unit}` | The question card; run is `waiting_for_user` |
| `product.chosen` | `{slot, product: ProductOut}` | A receipt line, a shelf card |
| `candidate.rejected` | `{slot, product: {title, retailer, url, price_eur \| null}, rule, reason}` | A struck line with the reason. `rule`: `size`, `budget`, `page-check`, `style`, `trip` |
| `product.swapped` | `{slot, old_product_id, product: ProductOut, reason}` | The line reprints; the old one is struck |
| `render.ready` | `{render_id, kind, image_url, items: [{product_id, box: {x, y, w, h}}]}` | The room picture and its price dots. Boxes are 0 to 1 of the render |
| `verify.result` | `{product_id, match, note}` | Reserved; shown later |
| `walkin.queued` | `{walkin: WalkinOut}` | A walk-in card appears. Sent when `POST /walkins` creates one, so reopening a room replays its walk-ins too |
| `video.ready` | `{walkin_id, video_url, poster_url}` | Walk-in becomes playable |
| `walkin.failed` | `{walkin_id, error}` | Walk-in card says why |
| `error` | `{message, retryable}` | The block-level error. Run becomes `failed` |
| `done` | `{total_eur}` | Run finished |

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
