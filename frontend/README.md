# Roomify front end

React + Vite + TypeScript + Tailwind v4 + GSAP. Design rules: [../docs/DESIGN.md](../docs/DESIGN.md). API contract with the back end: [../docs/API.md](../docs/API.md).

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # type-check and production build
```

## Two ways to run

**With the back end** (rooms saved to your account, the real agent): copy `.env.example` to `.env` and fill in

| Variable | Value |
|---|---|
| `VITE_API_URL` | The back end, e.g. `http://localhost:8000` |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable (anon) key. Never the secret key |

The back end must list this app's address in its `FRONTEND_ORIGINS` (add the Vercel URL once deployed), or every request fails as "Can't reach the server".

**Without it** (leave the variables empty, or add `?replay=1`): the app runs on the sample rooms in `src/data/samples.local.ts` with photos in `public/samples/`. Both stay on your machine (gitignored). Without them it starts with one empty room.

## Other switches

- `?stage=1` scales everything up 12.5% for a projector.
- `?replay=3d` opens the portable recorded 3D room. No backend or keys required;
  all five textured meshes and room assets ship locally. See [the demo guide](../docs/3D_DEMO.md).

## Where things live

- `src/api/`: the back end client (`client.ts`), the run event stream (`stream.ts`), wire shapes (`wire.ts`, mirrors `backend/app/models.py`), and the mapping into the screen's model (`map.ts`).
- `src/state/`: the store, `actions.ts` (everything a person can do, live or sample), `useLiveSync.ts` (loads rooms and follows the open room's run).
- `src/auth/`: Supabase email and password login.

Deployed on Vercel; `vercel.json` sends every route (including `/snap`) to the app.


## End-to-end tests

From `frontend/`, after installing backend dev dependencies:

```bash
npm ci
npx playwright install chromium
npm run test:e2e
```

Playwright starts isolated servers on ports 4173 and 8173. It drives Chromium at
1440 × 900 and 390 × 844 (the latter with reduced motion), covering landing,
photo upload and bad-photo recovery, independent room inputs, rename/delete,
measurement answers, multipart submission, the agent's SSE stream, shop links,
totals, keyboard comparison, brief edits, refinement, tab reload, HTTP errors,
truncated streams, CRLF events, unknown events, and replay network isolation.
Screenshots are saved under `test-results/`; failures retain a Playwright trace.

The 3D tests load the real committed GLBs at both widths and check camera controls,
product inspection, focus containment, replay network isolation and recovery from
failed models and room preparation. The recording is read-only.

The test-only backend (`backend/tests/e2e_app.py`) uses the production routes and
agent loop with deterministic planning, shop, judge and render fixtures. It never
calls paid providers or writes to Supabase. Synthetic images check the interface,
not new furniture generation quality. Do not deploy this test server.

Other checks, from `backend/`:

```bash
.venv/bin/pytest -q          # offline service and API regressions
.venv/bin/pytest -q -m live  # public retailer catalogue/page checks; needs internet
```

Database integration tests require a migrated, disposable `TEST_DATABASE_URL`;
never use the shared Supabase database. Real account login/storage, paid render
quality, microphone permissions, physical touch devices and production hosting
need separate live checks. Saved-run events/answer/swap/walk-in routes and phone
capture are not implemented in the current backend. The current offer flow uses
whole-brief refinement instead. A complete committed `demo/cache` recording is
also absent, so a full backend demo replay cannot yet be certified.
