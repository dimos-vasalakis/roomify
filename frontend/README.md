# Roomify front end

React + Vite + TypeScript + Tailwind v4 + GSAP. Design rules: [../docs/DESIGN.md](../docs/DESIGN.md).

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # type-check and production build
```

- `?replay=1` plays the recorded demo run with no back end.
- `?stage=1` scales everything up 12.5% for a projector.
- Set `VITE_API_URL` in `.env` (see `.env.example`) to stream a live run from the back end.

Deployed on Vercel; `vercel.json` sends every route (including `/snap`) to the app.
