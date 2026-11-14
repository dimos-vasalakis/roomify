# Roomify

**Photograph an empty corner. An agent shops real stores near you, to your budget, and shows you your own room furnished with exactly what it chose. Nothing is in the picture that you can't buy.**

## The problem
You get the keys to a student flat. One empty room, €400, and forty browser tabs. You guess whether the desk fits, whether the lamp matches and whether it all adds up. You buy something, it arrives, and it is too big.

## What Roomify does
1. **Send one photo** and say what you need: "a study corner, €300, I'm in Athens". The agent asks one thing back: how wide is that wall?
2. **The agent shops first.** It decides what the room needs, searches real Greek retailers, opens each product page and reads the price, size and delivery.
3. **It checks what it read.** Every extracted product is judged against the page it came from. Anything it can't prove is dropped.
4. **It decides out loud.** "Desk 160 cm, your wall is 140. Rejected." "Rug from the same shop as the desk, so it's one trip." Every decision streams live.
5. **It renders your room with those exact products**, using their real listing photos.
6. **It checks its own picture** against each listing and re-renders if something came out wrong.
7. **You get the room and the receipt:** price dots on each object, shop, size, link, delivery, and a total under your budget.
8. **Tap any item and say what you want instead** ("warmer, and cheaper"). Only that item changes.
9. **Ask for the walk-in:** a short camera move into your furnished room.

**Other tools draw a nice room, then look for look-alike products. Roomify buys first, draws second, then proves the picture matches the basket.**

## How it works
| Part | What we use |
|---|---|
| Agent brain and vision | Gemini Flash with function calling |
| Shop search, page scraping, maps | treg (one token for many APIs), with direct fallbacks |
| Trust and decisions | oumi judges: checks every extracted product against its page, and scores candidates on fit, budget, style and convenience |
| Render, swap, walk-in video | fal (Nano Banana 2.1 edit, MiniMax camera controls) |
| App | FastAPI back end, React + Vite + TypeScript + Tailwind + GSAP front end, live steps over server-sent events |

Full details, model IDs, fallbacks and costs: [docs/TECH_STACK.md](docs/TECH_STACK.md).

## Tracks
Content & Digital Art (fal). Open as backup.

## Running it locally
```bash
cp backend/.env.example backend/.env   # then fill in the keys

# back end (Python 3.12)
cd backend
python3.12 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/uvicorn app.main:app --reload --port 8000   # http://localhost:8000/health
```

Front end steps land here once `frontend/` exists.

`REPLAY=1` runs the full demo from cached results with no network.

## Team
| Area | Owner |
|---|---|
| Agent loop, LLM, oumi judges, eval | TBD at kickoff |
| Tools: search, page reading, treg, stores | TBD at kickoff |
| fal rendering, front end, demo | TBD at kickoff |

## Rules for contributors and coding agents
See [CLAUDE.md](CLAUDE.md) (identical copy in [AGENTS.md](AGENTS.md)).

## License
MIT. See [LICENSE](LICENSE).
