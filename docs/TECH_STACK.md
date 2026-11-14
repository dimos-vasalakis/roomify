# Roomify tech stack

Decided 2026-11-14, before the build window. Model IDs and the catalogues of treg and oumi were found on that day and are **not yet confirmed by a real call**. The four kickoff tests at the end of this file confirm them.

## One-line architecture

```
phone / laptop ──photo, prompt, budget──▶ FastAPI ──▶ agent loop (Gemini, function calling)
                                              │            │
                                              │            ├─ tools via treg: product search, page fetch, maps
                                              │            ├─ oumi: judge extracted products, score candidates
                                              │            ├─ fal: render the room, swap one item, walk-in video
                                              │            └─ cache: every tool result on disk, replayable
                                              ▼
React app ◀──server-sent events: every step, decision, rejection, render──
```

## Layers

| Layer | Choice | Why | Fallback |
|---|---|---|---|
| Front end | React + Vite + TypeScript + Tailwind, GSAP for motion | Fast to build with coding agents; GSAP for the step feed and the before/after reveal | none needed |
| Live feed | Server-sent events (`EventSource`) | The agent working live is the demo | Poll `/runs/{id}` |
| Phone capture | `/snap` route in the same app, opened by QR, through a tunnel (`cloudflared` or `ngrok`) | A judge's phone is the camera | Upload from the laptop |
| Back end | Python 3.12, FastAPI, uvicorn, `httpx`, Pydantic | Team default | none needed |
| Agent brain | Gemini Flash (reported as `gemini-3.8-flash`) through `google-genai`, function calling | Vision and tools in one model; team's LLM access | A larger Gemini model for planning only |
| LLM access | One function, `llm()`, in `backend/app/llm.py` | Swap provider in a few lines | none needed |
| Tool access | **treg** (`treg.to`): one token, pay per call, many APIs, MCP endpoint at `treg.to/mcp` | One key instead of five; search, scraping and maps behind one client | Direct calls to the same providers with their own keys |
| Product search | A web or shopping search API reached through treg, restricted to 2 to 3 retailer sites (`site:` filters) | Returns the merchant's own URL | Cached catalogue in `demo/catalogue.json` |
| Page reading | Fetch via treg (scrape API) or plain `httpx`; read `schema.org/Product` JSON-LD first; Gemini extracts when JSON-LD is missing | Full-size image, price, size, stock flag | Hand-filled catalogue entries |
| Extraction check | **oumi** judge | Every extracted product is checked against the page text before the agent may use it | Rule-only checks |
| Decision scoring | **oumi** judge | Scores candidates per slot on fit, budget, style and convenience, with a written reason | Gemini scores directly |
| Proximity | `demo/stores.json` (chain store coordinates) plus distance maths; Places API via treg if it is in the catalogue | Cannot fail on stage | Static file only |
| Render | fal `google/nano-banana-2.1/edit` (up to 14 reference images, about $0.04 at 1K, about 16 s) | Best reported at keeping specific products recognisable | `bytedance/seedream/v5.5/edit`, then `fal-ai/nano-banana-pro/edit` |
| Render check | Gemini vision compares each product's crop in the render with its listing photo | The step competitors skip | Side-by-side for the human |
| One-item swap | Re-render from the original photo with the new list, then paste only that item's region back with Pillow and a mask | Rest of the room stays pixel-identical | Full re-render |
| Walk-in video | fal `minimax/h3-max/camera-controls` (about $0.08 per second at 768p) | "Scene frozen, only the camera moves" | `kling/v4/image-to-video`, `fal-ai/veo3.1/fast/image-to-video` |
| Optional 3D | fal `tripo3d/h3.1/image-to-3d` for one product as GLB | Stretch: one product in phone AR | Cut |
| Database and auth | Supabase | Hosted Postgres and login in one service | Local `runs/{run_id}/` JSON and images |
| Front end hosting | Vercel | Deploys the Vite app from the repo | Run locally on the demo laptop |
| Back end hosting | Render | Deploys the FastAPI app from the repo | Run locally on the demo laptop |
| Demo safety | Every tool call cached by a hash of its inputs; `REPLAY=1` serves the cache | Same code path live and replayed | Recorded video |

## fal: where it is used
1. **Render** the room with the chosen products (`render_room`).
2. **Swap** one item (`swap_item`), same model, then the mask paste.
3. **Walk-in** camera move (`make_walkin`), started in the background as soon as the render passes its check.
4. Stretch: one product as a 3D model.

All fal calls go through `backend/app/tools/fal_client.py`, use the queue API with a timeout, and fall back to the cache.

## oumi: where it is used
oumi is the judge layer. It never generates; it decides whether data is trustworthy and which option wins.

1. **Extraction judge (online).** After `read_product_page`, an oumi `SimpleJudge` with our own prompt gets the page text and the extracted fields. It answers per field: is the price, size, image and stock flag supported by the page? A product that fails is dropped and the feed shows why ("price not found on page, rejected").
2. **Deterministic checks.** oumi's rule-based judge (no model call) runs first: price is a number, dimensions parse to centimetres, URL is on an allowed retailer, image URL loads.
3. **Decision judge (online).** For each slot (desk, chair, lamp…) the candidates go to an oumi judge with the constraints (wall width, budget left, style, shops already in the basket). It returns a score and a one-sentence reason per candidate. The agent picks from the ranking and the reasons stream to the feed.
4. **Extraction eval (offline).** `eval/extraction/` holds 30 or more real product pages from our retailers with hand-checked fields. One command runs the extractor and the oumi judge over them and prints accuracy per field. The number goes in the README and the video: "the agent's shop reading is 93% accurate on 40 hand-checked pages".
5. Optional: HallOumi, oumi's sentence-level hallucination checker, as the extraction judge's model if a hosted endpoint is available. It is too heavy to run on a laptop.

Judge configs live in `backend/app/judges/*.yaml`. The judge's inference engine points at Gemini. **Unconfirmed:** the exact oumi engine name for Gemini. Check the `InferenceEngineType` list in the oumi docs at kickoff. If oumi can't call Gemini, run the same judge prompts through `llm()` and keep the oumi config and eval harness.

## treg: verdict
**Use it, but don't depend on it.** treg is a pay-per-call gateway: one token gives the agent access to a large catalogue of third-party APIs, with the provider's own price and no markup. That fits Roomify's three outside needs (search, page scraping, maps) and means one key in `.env` instead of three.

- Every treg call goes through `backend/app/tools/treg_client.py`.
- Each tool also has a direct-provider path behind the same function, so losing treg costs one config change.
- **Unconfirmed:** which search, scraping and maps providers are in treg's catalogue today, and whether they cover Greece. Check at kickoff.

## Agent tools
The model chooses which tool to call next. Tools are plain Python functions in `backend/app/tools/`.

| Tool | Does | Uses |
|---|---|---|
| `analyse_room(photo)` | Room type, style, free zones, existing items with `box_2d` | Gemini vision |
| `ask_user(question)` | One question back, for example the wall width | SSE + POST answer |
| `search_products(query, retailer, max_price)` | Candidate URLs | treg → search API |
| `read_product_page(url)` | `Product` fields | treg → scrape, JSON-LD, Gemini |
| `judge_extraction(product, page_text)` | Pass or fail with per-field reasons | oumi |
| `score_candidates(slot, candidates, constraints)` | Ranked list with reasons | oumi |
| `nearest_store(retailer, location)` | Distance and address | `stores.json`, maps via treg |
| `render_room(photo, products)` | Rendered image | fal |
| `verify_render(render, products)` | Per-product match or mismatch | Gemini vision |
| `swap_item(slot, instruction)` | New product and new render | search + oumi + fal |
| `make_walkin(render)` | Video URL | fal |

## Data shapes

```python
class Product(BaseModel):
    id: str                 # hash of url
    slot: str               # "desk", "chair", "lamp", ...
    title: str
    retailer: str           # "ikea.gr", "jysk.gr", ...
    url: str
    image_url: str
    price_eur: float
    width_cm: float | None
    depth_cm: float | None
    height_cm: float | None
    delivery_text: str | None   # as written on the page
    in_stock: bool | None       # as shown on the page when read
    judged: bool                # passed the oumi extraction judge
```

SSE events, all JSON with `type`, `run_id`, `t`:
`step.started`, `step.result`, `ask`, `candidate.found`, `candidate.rejected` (with `reason`), `product.chosen`, `budget.update`, `render.ready`, `verify.result`, `video.ready`, `error`, `done`.

## Accounts and data
Every user logs in with email and password through Supabase Auth (supabase-js in the front end). Each sign-up gets a `profiles` row automatically (name from sign-up metadata `display_name`, avatar, home city). A **conversation** is one room project: its photo, the chat with the agent, and every run for that room.

Tables (`backend/app/db/tables.py`, Alembic migrations in `backend/migrations/`): `profiles`, `conversations`, `messages`, `runs`, `run_events`, `products`, `candidates`, `renders`, `walkins`. Row level security is on everywhere: with a user token, the browser can read only that user's own rows (and edit its own profile); products are readable by all. Files go in the private `roomify` storage bucket; the API returns signed URLs.

API routes (all except `/health` need `Authorization: Bearer <supabase access token>`; `401` with a readable `detail` otherwise). In `REPLAY=1` login is skipped and saved-data routes return `503`.

| Route | Does |
|---|---|
| `GET /me`, `PATCH /me` | Own profile: `display_name`, `home_city`, `avatar_url` |
| `POST /me/avatar` | Upload avatar (JPEG, PNG, WebP, under 5 MB) |
| `GET /conversations`, `POST /conversations` | List own (newest first), create with `title` |
| `GET /conversations/{id}` | One conversation with `messages`, `runs`, `room_photo_url` |
| `PATCH /conversations/{id}`, `DELETE /conversations/{id}` | Rename, delete (with its runs) |

## Keys (`.env`, gitignored; names in `.env.example`)
`GEMINI_API_KEY`, `FAL_KEY`, `TREG_TOKEN`, and the optional direct fallbacks `SERPER_API_KEY`, `FIRECRAWL_API_KEY`. Plus `REPLAY`, `RETAILERS`, `DEFAULT_CITY`. Database and login: `DATABASE_URL` (Supabase session pooler), `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWT_SECRET` (older projects only), `FRONTEND_ORIGINS`.

## Cost per full run (estimate)
Three renders (about $0.12), one 5-second video (about $0.40), 10 to 20 search and scrape calls through treg (a few cents), Gemini and judge calls (cents). About **$0.60 per run**.

## Kickoff tests (20:00, before any feature)
| Test | Pass | If it fails |
|---|---|---|
| 1. Fidelity: room photo + 4 product photos into the render model | A stranger matches each product to its listing; walls and windows don't move | Try the two backups. If all fail, stop and rethink the pitch |
| 2. Search and read: 10 Greek queries through treg, read the pages | Image, price and size come back for most | Direct provider keys, then a hand-built catalogue of 100 items |
| 3. oumi: run one judge config against Gemini on 5 extracted products | Judge returns per-field verdicts | Same prompts through `llm()`, keep oumi for the offline eval |
| 4. Walk-in: one render into the video model | Products stay recognisable | Cut the video |
