# Roomify design

Owner: front end. Rebuilt 2026-11-15 ("the board"). Every screen follows this file; change it here first.

## Direction
- **One board, the room is the hero.** One workspace that changes state; no landing page, no receipt, no basket list.
- **World:** paper and ink. Warm stone ground, white surfaces, near-black ink. The room photo is the only colourful thing on screen.
- **The one hue** `#2d5a45` (pine) marks only what the agent chose: pins, outlines, the budget fill.
- **The agent shows its work on the photo, not in a chat log.** A scan line reads the room, a ruler appears on the wall it measured, found pieces print as tags on the photo, the render wipes in, outlines snap to where each piece landed.
- **Crisp, clean, smooth:** hairline borders, no shadows at rest, no gradients, no glow, no orbs, no sparkle icons. Motion only explains a change of state.

## The screen's one question
"What goes in my room, and does it fit my budget?"
- Biggest block: the room.
- Largest figure: the total against the budget, at the top of the conversation column.

## Layout (1440 × 900)
```
rail 64 | room board (fills)                         | conversation 400
  +     | ┌──────────────────────────────────────┐   | €287.00 of €300.00
  ▣     | │ room, before ◀─||─▶ after, pins      │   | ───────────────
  ▢     | │ steps drawn on the photo             │   | You  …
  ▢     | └──────────────────────────────────────┘   | Roomify  …
        | Reading your room · 1 of 4   [Walk in]   | [▁▃▆ Tell Roomify… 🎙 ↑]
```
- **Rail:** 64px, room thumbnails (3:2), + for a new room. Hover shows name and status. Ctrl B or the top button opens the full list as a panel over the board.
- **Room board:** the room at 3:2, as large as the height allows. Under it one caption line: the current step, or the room's name and size once done, with the room tools on the right.
- **Conversation column:** the total against the budget on top, then the conversation, then the composer pinned at the bottom.
- **Phone (390):** top bar (Rooms, name, New), room full width, caption, conversation below, composer sticky at the bottom.
- **Stage (`?stage=1`):** root font size up 12.5% for the projector.

## The room's states
| State | On the room | Caption |
|---|---|---|
| Empty | Dashed frame: "Drop a photo of your room", "Choose a photo", "Use a sample room" | — |
| Photo, no brief | The photo, "Change photo" | "Now tell Roomify what you need" |
| Asking | Photo dimmed slightly, the question in the conversation | "Waiting for your answer" |
| Reading (planning) | A white scan line sweeps down, corner ticks frame the photo | "Reading your room · 1 of 4" |
| Shopping | Each chosen piece prints as a tag (slot, shop, price) stacked on the photo; a rejected one prints struck through, then fades | "Finding pieces · 2 of 4" |
| Rendering | A soft band travels across the photo | "Drawing your room · 3 of 4" |
| Checking / done | The render wipes in; pine outlines draw around each placed piece, then become pins | "Checking it matches · 4 of 4", then the room name |
| Failed | Photo stays; an error plate with the real reason and "Try again" | — |

Never guess positions: tags float in a stack until a render gives real boxes; a piece without a box gets no pin.

## Before / after
A divider across the room once a render exists. Left of it is your photo, right of it the render. Labels "Before" / "After" sit in the top corners while both are visible. Pins only show on the after side. Drag, click or use the arrow keys. The reveal ends with the whole after showing and the handle parked at the left edge.

## Pins
A pine dot with a white ring on each placed piece. Click: a small card next to it with the listing photo, name (as the shop writes it, often Greek), shop, price, "View in shop ↗" and "Swap". Swap puts "Swap the desk: " in the composer.

## Conversation and voice
- Lines, not bubbles: "You" and "Roomify" as small labels, the text in body size. The agent's question shows as a line with quick answers under it (the suggested value, "Skip").
- First message: "What do you need, and what's the budget?" A budget written in the sentence ("€300") is read from it; otherwise the budget chip above the composer is used (editable).
- **Speak in:** hold the mic button or Space. A thin live waveform of the real microphone level replaces the input text while listening; the words appear as they are heard.

## Walk-in
One "Walk in" button in the caption row once the room is done. It makes a 5 s push-in from the middle of the near edge and plays inside the room frame, labelled "Walk-in preview" (never 3D). While it is being made the button reads "Making walk-in…". Real conversations (offers) don't have walk-ins yet; asking "show it from the door" in words changes the view instead.

## Tokens
Source of truth: `frontend/src/styles/tokens.css`.

| Role | Value |
|---|---|
| Ground | `#f4f3f1` |
| Surface | `#ffffff` |
| Raised / well | `#eeedeb` |
| Border | `#e6e5e3` |
| Control border | `#d4d3d1` |
| Text | `#171717` |
| Muted (4.5:1 on white and ground) | `#636260` |
| Primary fill | `#171717` with white label |
| Chosen (the one hue) | `#2d5a45` (pine) |
| Negative (real failures only) | `#c4242a` |

Type: Manrope variable (has Greek and real tabular figures). Weights 400, 500, 600. Sizes: caption 14, body 16, title 20, total 28. Tabular figures on every number. Radius: board 16, card 10, control 8, pin full.

## Motion
GSAP with `useGSAP` and a scoped ref; every entrance through `enter()` in `frontend/src/lib/motion.ts` (always ends visible, clears inline styles, fade-only under reduced motion). Transform, opacity and `clip-path` only.

| Event | Motion |
|---|---|
| Step caption changes | Old line slides up and out, new one rises in (240 ms) |
| Scan (reading) | 1px white line plus a soft band sweeps top to bottom, loops |
| Piece found | Tag rises 8px and fades in; price counts |
| Piece rejected | Tag prints, a strike draws left to right, then it fades out |
| Render ready | After wipes in from the left with `clip-path`; outlines draw; pins land with a 70 ms stagger |
| Total changes | Figure counts to the new value |
| Voice in | Waveform bars follow the mic level |
| Controls | Press scale 0.97 |

## Rules that hold everywhere
- No gradients, glows, glass or shadows at rest (a pin card over the photo may carry one soft shadow to lift it off the picture).
- Rejections are grey with a strike, never red. Red is one mark, on a real failure.
- Money: `€` with no space, two decimals, tabular. Totals are computed from the pieces, never typed.
- Sentence case. Nothing under 12px. Every text tier at 4.5:1 or better.
- Errors live inside the block that failed, with the real reason and "Try again".
