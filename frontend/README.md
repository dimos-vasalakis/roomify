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

## Where things live

- `src/api/`: the back end client (`client.ts`), the run event stream (`stream.ts`), wire shapes (`wire.ts`, mirrors `backend/app/models.py`), and the mapping into the screen's model (`map.ts`).
- `src/state/`: the store, `actions.ts` (everything a person can do, live or sample), `useLiveSync.ts` (loads rooms and follows the open room's run).
- `src/auth/`: Supabase email and password login.

Deployed on Vercel; `vercel.json` sends every route (including `/snap`) to the app.
