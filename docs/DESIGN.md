# Roomify design

Owner: front end. Decided 2026-11-14 before the build window. Every screen follows this file; change it here first.

## Direction
- **Style:** Achromatic ledger (light), dealt by the `design-taste-frontend` skill, seed 2041574039. Screen pattern: builder canvas.
- **World:** paper and ink. No colour in the chrome. The room photo is the only colourful thing on screen.
- **The move:** the one primary action is near-black; the one hue marks only what the agent chose; everything else is ink and grey.
- **Mode:** Operate. One workspace that changes state. The only page outside it is the landing page, shown before login.

## The screen's one question
"What goes in my room, and does it fit my budget?"
- Biggest block: the room.
- Largest figure: the total against the budget (30px, 700, the only bold besides money in rows).
- Finding under the title: "€287.00 of €300.00 · 4 items · 2 shops, one trip".
- Most frequent job, one click away: swap an item.

## The face
- **Ground** `#f4f3f1`, a shop stone, instead of stock `#f8f8f8`. Panels white.
- **The one hue** `#1d5fbf` on the agent's choices only: price dots on the room, the chosen marker on receipt lines, the budget track's fill. Under 1% of the screen.
- **Signature element:** the receipt. The agent's feed prints like a till receipt while it shops. Every decision is a line; rejected candidates stay, struck through in grey, with the reason in ink under them.
- **Dimension line:** the one measurement the user gave ("140 cm") drawn under the room like an architect's ruler.
- **Words of the trade:** "Looked at", "Rejected", "In the basket", "One trip", "Walk in". Never "Items", "Status", "Records".

## Tokens
Source of truth: `frontend/src/styles/tokens.css`.

| Role | Value |
|---|---|
| Ground | `#f4f3f1` |
| Surface (panels, cards) | `#ffffff` |
| Raised / well | `#eeedeb` |
| Border | `#e6e5e3` |
| Row rule | `#f0efed` |
| Control border | `#d4d3d1` |
| Text | `#0a0a0a` |
| Muted (4.5:1 on white and ground) | `#636260` |
| Primary fill | `#141414` with white label |
| Secondary fill | `#e5e5e5` with ink label |
| Chosen (the one hue) | `#1d5fbf` |
| Positive | `#2e7d32` |
| Negative (real failures only) | `#c4242a` |
| Warning pill | `#fffbeb` / `#92400e` |

Radius: panel 16, card 8, control 6, dot full. Gap 12 everywhere. Control height 36. Row height 44.
Type: Manrope variable, self-hosted (`@fontsource-variable/manrope`). Weights 400, 500, 700 (700 for money only). Sizes: title 24, section 16, total 30, body 16 on the canvas and receipt, 14 in the chrome, small 12. Tabular figures on every number. No monospace.

Why not the dealt Geist: product names, shops and delivery text arrive in Greek, and Geist has no Greek glyphs. Commissioner was tested and rejected: it has Greek but no tabular figures, so prices jitter while they count. IBM Plex Sans and Roboto Flex were rejected because their figures are fixed-width even in running text. Manrope has Greek, proportional figures in text, and real tabular figures when `tabular-nums` is set (checked by measuring digit widths in the browser).

## Layout (1440 × 900)
```
top bar 44, on the ground, no rule
two panels, 8 outer margin, 12 gap, 1px border, radius 16, no shadow:
  1424 = stage panel 968 + 12 + receipt panel 444
stage panel: 16 padding; room 936 × 624 (3:2); 12; shelf fills the rest (about 160)
receipt panel: full height; Now line on top, sections, totals pinned at the bottom
```
Phone (390): top bar, room full width, shelf scrolls sideways, receipt below, total in a sticky bottom bar. 16px margins, 44px touch targets.
Stage (`?stage=1`): the root font size goes up 12.5% for the projector; layout uses rem so nothing else changes.

## Landing (before login)
One page that says what Roomify does and leads to login. Same paper and ink as the app; no hero gradients, no stock photos, no icon tiles.
- **Top bar:** the mark on the left; "Create account" (text link) and "Log in" (secondary fill) on the right. The one primary (near-black) button is the "Log in" under the opening line.
- **Opening:** the promise in title type ("Photograph a room. Get a basket you can actually buy."), one sentence of how, then "Log in" and "Create an account".
- **Signature:** an example receipt beside the opening (below it on a phone), printing line by line like the app's feed: chosen lines with the one hue, rejected lines struck through in grey with the reason in ink. It is labelled "Example" and its total is computed from its lines.
- **How it works:** four numbered steps in plain words, as a ledger (number, line, sentence), not cards.
- **Shops it reads:** the shop names as plain text, priority shops first.
- **Close:** the trust line ("Every price, size and link is read from the shop's own page") and "Log in" again.
- Without a back end (sample mode) the buttons read "Open the sample rooms" and go straight into the app.

## Rooms (sessions)
Each room is one session, like a chat in a chatbot.
- **Desktop:** a sidebar on the ground (256px, no border), grouped Today / Yesterday / Last week. Each row is a 3:2 thumbnail of the room, its name, and one status line in plain words ("€832.88 of €1,000.00", "Shopping, 2 in the basket", "Waiting for your answer", "Couldn't finish"). The active room is a grey pill. "New room" sits at the top.
- **Collapsed** (Ctrl B or the panel button): a 64px rail of room thumbnails; the active one has an ink outline. The room gets the extra width.
- **Phone:** a top bar with "Rooms" (with a count of rooms waiting for an answer), the mark, and New room. Rooms open as a full-screen sheet.

## Walk-in from any spot
- "Walk in" (or W) turns the room into a viewfinder: click where you want to stand, drag to aim. A camera dot with a field-of-view cone shows the spot and the direction.
- A card docked in the opposite corner (bottom sheet on a phone) picks the move (Push in, Orbit, Rise) and the length (5 or 8 s), then "Make walk-in".
- Clips appear under the room in the Walk-ins tab, with a progress bar while they are made, then a play button. Earlier spots show as small markers while placing a new one.
- The clip plays on the stage over a dark scrim, labelled "Walk-in preview". Never called 3D.
- Contract for the back end: `POST /runs/{id}/walkin {from: {x, y}, aim_deg, move, seconds}`; `x` and `y` are 0 to 1 of the render, `aim_deg` 0 is up the image, 90 is right.

## Motion
State changes only; no entrance on chrome. GSAP with `useGSAP` and a scoped ref. Every entrance goes through `enter()` in `frontend/src/lib/motion.ts`: it always ends fully visible and clears its inline styles (a plain `gsap.from` left cards stuck invisible when React re-ran effects), and under `prefers-reduced-motion` it fades only. Transform, opacity and `clip-path` only.

| Token | Value |
|---|---|
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` entering |
| `--ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` moving on screen |
| `--dur-fast` | 160ms (exits, presses) |
| `--dur` | 240ms (enters) |
| `--dur-slow` | 600ms (render wipe) |
| Stagger | 70ms |

| Event | Motion |
|---|---|
| Candidate found | Card rises 16px with opacity |
| Candidate rejected | Strike draws left to right, card dims, reason appears |
| Product chosen | Thumbnail travels from shelf to receipt (Flip); a price dot lands on the room |
| Budget update | Figures count to the new value; track scales on X |
| Render ready | After image wipes over before with `clip-path: inset()`; dots follow |
| Swap | Only that item's region crossfades; its receipt line reprints |
| Walk-in | Scrim to dark, video fades in |
| Controls | Press scale 0.97; hover and focus-visible |

## Rules that hold everywhere
- No gradients, glows, glass, or shadows on anything at rest. A border or a tone step, never both a border and a shadow.
- Rejections are grey with a strike, never red. Red is one mark, on a real failure.
- Money: `€` with no space, two decimals, tabular, right-aligned. Totals are computed from the lines, never typed.
- Sentence case. Nothing under 11px. Every text tier at 4.5:1 or better.
- Loading keeps the final layout with flat grey bars at real size, no shimmer. Errors live inside the block that failed, with when the data was last good and "Try again".
- Price dots carry a white ring and an ink label so they read on any photo.
