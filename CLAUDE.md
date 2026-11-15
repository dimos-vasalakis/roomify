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
Owner: Fanis. The front end lives in `frontend/`; read `frontend/README.md` to run it and `docs/API.md` for what it expects from the back end.

### Sources of truth
- `PRODUCT.md`: who it is for, what it does, what may never be faked.
- `docs/DESIGN.md`: the art direction (paper and ink, one blue for what the agent chose), tokens, layout grid, motion. Change it there first.
- `frontend/src/styles/tokens.css`: the tokens in code. Use them; no raw colours or sizes in components.

### Design workflow (follow in order)
1. Art direction: the `design-taste-frontend` skill. Already decided for this project; reuse `docs/DESIGN.md` instead of dealing a new one.
2. Product truth: `/impeccable init` wrote `PRODUCT.md`. Use `/impeccable shape <screen>` before building a new screen.
3. Build.
4. Check in a real browser (Playwright MCP): screenshots at 390px and 1440px wide. Do not call a screen done from code alone.
5. Interaction polish: the `emil-design-eng` skill for motion, easing and small details.
6. Final pass: `/impeccable critique`, then `/impeccable polish`.

During the hackathon, compress this: build, one screenshot check at both widths, polish only the screens the demo shows.

### Rules
- The agent working live is the hero. Show its steps as they stream in, with clear running, done, rejected and failed states, and the rejection reason in plain words.
- Design empty, loading and error states. Errors appear inside the block that failed, never as a full-screen banner.
- Large type and high contrast: it must read on a projector.
- No generic SaaS look: no gradients, no glows, no glass, no card-in-card, no icon tile above every heading, no purple.
- Respect `prefers-reduced-motion`.

### Motion with GSAP
- Use the GSAP skills (`gsap-core`, `gsap-timeline`, `gsap-react`, `gsap-plugins`, `gsap-performance`, `gsap-utils`, `gsap-scrolltrigger`, `gsap-frameworks`) for anything beyond a simple CSS transition.
- Animate transforms, opacity and `clip-path` only. In React use `useGSAP` with a scoped ref.
- Every entrance goes through `enter()` in `frontend/src/lib/motion.ts`: it always ends visible and fades only under reduced motion.
- Sequence multi-step reveals with a timeline rather than chained delays.

### Tools in this repo
| What | Where | Notes |
|---|---|---|
| `design-taste-frontend`, `emil-design-eng`, `impeccable` skills | `.claude/skills/` (Claude Code), `.agents/skills/` (Antigravity and others) | Sources in `skills-lock.json` |
| GSAP skills | Claude Code plugin `gsap-skills` from the marketplace in `.claude/settings.json` (accept the prompt); copies in `.agents/skills/` | MIT licence, GreenSock |
| impeccable sub-agents | `.claude/agents/` | Used by impeccable's commands |
| Design check hooks | `.claude/settings.json` | Run impeccable's detector after edits. The engine downloads once on first use (about 16 MB) |
| Playwright and Figma MCP | `.mcp.json` (Claude Code), `.agents/mcp_config.json` (Antigravity) | Playwright for browser screenshots; Figma when a Figma link is given |

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
6. Then: swap one item, phone capture by QR, nearest-store logic.
7. Stretch: voice for swaps, one product in 3D.

## Explaining
- The team must understand what is built. After each significant change, explain in plain language what changed and why.
- Ask before large refactors or before touching another owner's area.
