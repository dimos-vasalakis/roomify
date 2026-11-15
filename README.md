# Roomify

**Real products, planned for your room and your budget.**

Roomify turns a room photo and a short brief into a furnished preview and a shopping list. The agent searches retailer listings, evaluates products against the brief and available measurements, then renders the selected pieces into the room. Its choices, rejected candidates and progress appear as it works.

Built during a 36-hour hackathon.

## Features

- **Shopping grounded in listings.** Product prices, dimensions and links come from retailers' own pages. Greek shop catalogues are included; optional search services extend coverage.
- **Visible decisions.** Follow the agent's progress, inspect its choices and see why candidates were rejected.
- **A room you can revise.** Add, remove, move or replace pieces through item controls or natural language. Compare the furnished preview with the original photo.
- **Interactive 3D.** Orbit the reconstructed room, switch camera angles, zoom and inspect individual product models alongside their listing photos and dimensions.
- **Walk-in preview.** Generate a short camera-move video from the furnished room.
- **Voice and phone capture.** Speak a brief or transfer a room photo from a phone using a QR code.

The preview and 3D models are reconstructions, not exact product replicas or architectural surveys. Unseen surfaces and details are approximate; the original shop listing remains the reference.

## Try the recorded demo

With Node.js 22.12+ and npm installed:

```bash
cd frontend
npm ci
npm run dev
```

Open **[localhost:5173/?replay=3d](http://localhost:5173/?replay=3d)** and select **Look around in 3D**.

The recording includes the original photo, furnished preview, room geometry and five textured models. All scene assets are bundled locally, so it needs no backend, API keys or external network. The room is read-only and clearly labelled as recorded; displayed prices are those captured with the listings. Opening shop links requires internet access.

Use `?replay=3d&stage=1` for larger projector text. See the [3D demo guide](docs/3D_DEMO.md) for controls, a presentation sequence and recording instructions.

## Run the live app

### Requirements

- Python 3.12
- Node.js 22.12+ and npm
- A fal API key for live rendering, 3D model generation and walk-in previews

Supabase is optional for the browser-based demo flow. It is used for account access and saved-data routes.

### Backend

From the repository root, copy the environment template:

```bash
cp backend/.env.example backend/.env
```

Set `FAL_KEY` in `backend/.env`. Planning and vision use this service by default; `GEMINI_API_KEY` supports direct model access. Optional integrations and model overrides are documented in the same template.

Start the API:

```bash
cd backend
python3.12 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Check [API health](http://localhost:8000/health), [configured services](http://localhost:8000/health/services) or the [interactive API reference](http://localhost:8000/docs).

### Frontend

In a separate terminal, from the repository root:

```bash
cp frontend/.env.example frontend/.env
cd frontend
npm ci
```

Set the backend address in `frontend/.env` before starting Vite:

```dotenv
VITE_API_URL=http://localhost:8000
```

Then start the frontend from `frontend/`:

```bash
npm run dev
```

Open **[localhost:5173/?demo=1](http://localhost:5173/?demo=1)** to use the live agent without login. Rooms in this flow are retained in the browser tab. Live generation uses paid services, and new 3D models can take several minutes to prepare.

For account access, also configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Backend credentials remain in `backend/.env`; never expose the Supabase secret key in the frontend. For a different frontend origin, add its address to the backend's `FRONTEND_ORIGINS`.

### Database

For Supabase-backed routes, set `DATABASE_URL` to the project's session-pooler connection and apply migrations from `backend/`:

```bash
.venv/bin/alembic upgrade head
```

Tables are defined in [backend/app/db/tables.py](backend/app/db/tables.py); migrations live in [backend/migrations/](backend/migrations/).

## Architecture

- **Frontend:** React, TypeScript, Vite and Tailwind CSS, with GSAP for interface motion and Three.js for the 3D viewer.
- **API and agent:** Python and FastAPI. The agent loop lives in [backend/app/agent/loop.py](backend/app/agent/loop.py); progress streams to the browser over server-sent events.
- **Shopping and evaluation:** Local retailer catalogues, page extraction and evidence-based basket checks, with optional Serper, Firecrawl and Oumi integrations.
- **Generation:** fal handles room rendering, product meshes, room geometry and walk-in video. Model access is centralized in [backend/app/llm.py](backend/app/llm.py).
- **Persistence and hosting:** Supabase for database, storage and authentication; Vercel for the frontend and Render for the backend.

External model and service results pass through the [cache layer](backend/app/cache.py). Backend `REPLAY=1` reads matching cache records without making external calls; it requires an existing recording. The bundled `?replay=3d` demo is independent of that backend mode.

## Development

After installing both applications, run backend checks from `backend/`:

```bash
.venv/bin/pytest -q
```

Run frontend checks from `frontend/`:

```bash
npm run build
npm run lint
npx playwright install chromium
npm run test:e2e
```

Playwright covers desktop and phone layouts at 1440px and 390px. Tests exercise the design flow, streamed events, room controls, error recovery and recorded 3D scene. Service fixtures avoid paid generation during tests; the 3D tests load the bundled meshes and verify replay network isolation. Database integration tests require a disposable `TEST_DATABASE_URL`.

## Documentation

- [Product scope and principles](PRODUCT.md)
- [Technical decisions](docs/TECH_STACK.md)
- [API contract](docs/API.md)
- [Design system](docs/DESIGN.md)
- [3D demo guide](docs/3D_DEMO.md)
- [Frontend setup and testing](frontend/README.md)
- [Contributor guidelines](AGENTS.md)

## License

[MIT](LICENSE).
