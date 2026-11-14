<!-- AGENTS.md is read by other coding agents (Antigravity, Codex, Cursor). Keep it identical to CLAUDE.md below this note. -->

# Roomify

Photograph a room, say what you need and your budget. An agent shops real shops near you, rejects what doesn't fit, renders your own room with exactly the products it chose, checks its picture against the listings, and lets you swap any item by saying what you want instead.

Built in a 36-hour agentic AI hackathon by a team of three. Read `README.md` for the pitch and `docs/TECH_STACK.md` for every technical decision. Keep `AGENTS.md` identical to this file below its header note.

## Hackathon rules
- Judged on usefulness, craft and wow through a live demo and a 3-minute video. The agent working live is the hero.
- No project-specific code before **Saturday 20:00**. Feature freeze **Sunday 15:00**: only fixes and demo polish after. Code freeze around **Sunday 19:00**.
- Get the thin path working end to end first (see "Build order"), then improve it.
- Choose the simplest approach that demos well. No features or abstractions nobody asked for.

## Architecture rules
- Back end: Python 3.12, FastAPI, in `backend/`. Front end: React + Vite + TypeScript + Tailwind + GSAP, in `frontend/`.
- Hosting: database and auth on **Supabase**, front end deployed on **Vercel**, back end deployed on **Render**.
- The agent loop lives in `backend/app/agent/loop.py` and nowhere else.
- **All LLM calls go through `llm()` in `backend/app/llm.py`.** Never import a provider SDK anywhere else.
- **Tools are plain functions** in `backend/app/tools/`, one file per tool or service, with typed inputs and a Pydantic result.
- **fal** calls only through `tools/fal_client.py`. **treg** calls only through `tools/treg_client.py`. **oumi** judges only through `backend/app/judges/`, with configs as YAML next to them.
- Every external call (LLM, treg, fal, oumi) goes through the cache wrapper in `backend/app/cache.py`, keyed by a hash of its inputs. `REPLAY=1` must run the whole demo with no network.
- Agent steps stream to the front end with server-sent events. Event names and payloads are listed in `docs/TECH_STACK.md`; add new ones there first.
- A product may only reach the render if it passed the oumi extraction judge. Never show a price, size or stock claim that was not read from the shop's page.
- Never call the walk-in video "3D". It is a walk-in preview.

## Repo layout (target)
```
backend/app/main.py          FastAPI app, routes, SSE endpoint
backend/app/agent/loop.py    the agent loop and its system prompt
backend/app/llm.py           the one LLM function
backend/app/cache.py         cache + replay
backend/app/models.py        Product, Run, events
backend/app/tools/           analyse_room, search_products, read_product_page, render_room, ...
backend/app/judges/          oumi judge configs and wrappers
eval/extraction/             hand-checked product pages + the oumi eval script
demo/                        catalogue.json, stores.json, cached runs for replay (committed)
frontend/src/                React app: capture, live feed, room view, receipt
docs/                        TECH_STACK.md and other decisions
```

## Code style
- Python: type hints everywhere, Pydantic models for anything that crosses a boundary, `httpx` async, no global mutable state except the run store.
- TypeScript: strict mode, one component per file, event types mirrored from the back end in `frontend/src/types.ts`.
- Every external call has a timeout and returns a readable error event instead of raising into the loop.
- Small functions, no premature abstraction, no unused code.

## Front end
- Art direction is decided once, up front, and recorded in `docs/DESIGN.md`. Follow it.
- The live feed is the most important screen: clear running, done, rejected and failed states, with the rejection reason in plain words.
- Design empty, loading and error states. Large type and high contrast: it must read on a projector.
- Animate transforms and opacity only. In React use `useGSAP` with a scoped ref. Wrap motion in `gsap.matchMedia()` and give `prefers-reduced-motion: reduce` a fade-only version.
- No generic SaaS look: no purple gradients, no card-in-card, no icon tile above every heading.
- Check every demo screen in a real browser at 390px and 1440px wide before calling it done.

## Team git
- Three people, one repo. Small commits with clear messages. Pull before every push. One owner per area (see `README.md`).
- Never rewrite a teammate's files without asking. Never force-push.
- **No AI attribution anywhere:** no mentions of AI assistants or model vendors in commit messages, PR text or pushes, no "Co-Authored-By" lines, no "Generated with" footers. The human committer is the only author.

## Secrets
- Keys live in `.env`, which is gitignored. Every variable name goes in `.env.example` with no value. Never print a key in logs or events.

## Demo reliability
- Handle API errors, rate limits and timeouts with readable messages, never a crash or a blank screen.
- Keep a full cached run of the demo room in `demo/` and test `REPLAY=1` after every significant change.
- Hard timeouts on the demo path: if a live step is too slow, fall back to its cached result and say so in the feed.

## Build order
1. Photo, prompt, budget and one measurement in.
2. Agent loop with search, page reading, oumi extraction judge and oumi decision judge, every step streamed.
3. One render with 3 to 5 real products, then the render check.
4. Room view with price dots and the receipt (shop, price, size, link, total).
5. Cached replay.
6. Then: swap one item, walk-in video in the background, phone capture by QR, nearest-store logic.
7. Stretch: voice for swaps, one product in 3D.

## Explaining
- The team must understand what is built. After each significant change, explain in plain language what changed and why.
- Ask before large refactors or before touching another owner's area.
