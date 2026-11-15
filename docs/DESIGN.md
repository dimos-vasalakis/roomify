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

## Layout (1440 × 900): one drawing sheet
```
[mark] | [room thumb · ROOM 01 · name ▾] [+ New room]            TOTAL / BUDGET €295.50 / €500.00 [scale bar]
┌ crop marks ─────────────────────────────────────────┐  ┌ SCHEDULE OF PIECES ───── 3 ITEMS ┐
│ the room, before ◀─||─▶ after                        │  │ (01) [photo] DESK  title   €129 │
│ numbered callouts (01)(02)(03) on the pieces         │  │      shop · 160×80×75 cm  Shop↗ │
│                                                      │  │      [Move] [Another like it] [Remove]
└──────────────────────────────────────────────────────┘  │ TOTAL                    €295.50 │
 Title block: room name · 3 PIECES · 2 SHOPS | WALL 300 CM │ TURNED DOWN · 7  ▾               │
                       [Undo] [↺] [Look around in 3D]      │ ● agent's latest word      Log  │
                                                           │ [ anything else…      🎙  ↑ ]   │
```
- **Interaction is hybrid:** every chosen piece has its own buttons (Move with presets or a place in words, Another like it, Remove). They are sent as an exact `intent` to `POST /turn`, so no model guesses what a button meant. One command line stays for anything else, by voice or text. The full conversation is the Log, one tap away; the footer shows only the agent's latest word or the question it is waiting on, with its quick answers.
- **The room is the hero.** Pieces are numbered callouts (a circle with the number, the name on a leader line on hover or when picked); the same number leads its line in the schedule. Picking either selects both.
- **Top bar** replaces the rooms rail and the phone bar: the open room (its thumbnail and name open the rooms list), New room, and the total against the budget, editable in place, with a scale bar.
- **While the agent works** the schedule's head is the live log: step n/4, what it is doing now, and how many it looked at, turned down and chose. **Turned down** lists every rejection with its reason.
- **Before a brief** the column is the Brief: the question, one line on what happens, and three example briefs that fill the command line.
- **Type:** Manrope for words, IBM Plex Mono for every number, size and the small capital labels of a title block. Square corners (3–4px), hairline rules, a drafting grid behind.
- **Phone (390):** the same sheet stacked: top bar, room, title block, schedule with its command line.

## The room's states
| State | On the room | Caption |
|---|---|---|
| Empty | Dashed frame: "Drop a photo of your room", "Choose a photo", "Use a sample room", and "Or use your phone" with a QR code. The phone's page (`/snap/<code>`) takes one photo and sends it here; a retake replaces it until the brief is sent | — |
| Photo, no brief | The photo, "Change photo" | "Now tell Roomify what you need" |
| Asking | Photo dimmed slightly, the question in the conversation | "Waiting for your answer" |
| Reading (planning) | A white scan line sweeps down, corner ticks frame the photo | "Reading your room · 1 of 4" |
| Shopping | Each chosen piece prints as a tag (slot, shop, price) stacked on the photo while the agent works; the tags go when it finishes or fails | "Finding pieces · 2 of 4" |
| Rendering | A soft band travels across the photo | "Drawing your room · 3 of 4" |
| Checking / done | The render wipes in; pine outlines draw around each placed piece, then become pins | "Checking it matches · 4 of 4", then the room name |
| Failed | Photo stays; an error plate with the real reason and "Try again" | — |

Never guess positions: tags float in a stack until a render gives real boxes; a piece without a box gets no pin.

## Before / after
A divider across the room once a render exists. Left of it is your photo, right of it the render. Labels "Before" / "After" sit in the top corners while both are visible. Pins only show on the after side. Drag, click or use the arrow keys. The reveal ends with the whole after showing and the handle parked at the left edge.

## Pins
A pine dot with a white ring on each placed piece. Click: a small card next to it with the listing photo, name (as the shop writes it, often Greek), shop, price, "View in shop ↗" and "Swap". Swap puts "Swap the desk: " in the composer.

## Conversation and voice
- A work log, not bubbles: your lines open with a hollow ink ring and sit in medium weight, Roomify's open with a filled pine dot. The conversation starts under the total and grows downward, so nothing above moves when a line arrives; it follows new lines only if you are already at the end. The header keeps one height in every state (room name before pieces, then the total with "€x left" on the budget bar). The agent's question shows as a line with quick answers under it (the suggested value, "Skip").
- First message: "What do you need, and what's the budget?" A budget written in the sentence ("€300") is read from it; otherwise the budget chip above the composer is used (editable).
- **Speak in:** tap the mic and talk (it sends by itself a moment after you stop), or hold Space and let go. A thin live waveform of the real microphone level replaces the input text while listening; in Chrome and Edge the words appear as they are heard. Browsers without their own speech recognition (Firefox, Brave, Safari, in-app browsers, phones) send the recording to `POST /transcribe` and show “Writing down what you said…” for a second. Escape throws the sentence away.

## Nothing is ever a dead end
Every mistake and every failure has a way back. Keep it that way when adding anything.
- **Undo (Ctrl Z):** each message saves the room as it was (last five). "Undo" in the caption goes back one step and puts the message back in the composer to edit.
- **Stop:** while Roomify works, the send button becomes Stop. It ends the run and restores the room as it was, message back in the box. You can type the next message while it works.
- **Failures:** a run that fails halfway keeps "Back to the last room" next to "Try again". A message that never reached the agent comes back to the composer.
- **Budget:** click the budget in the header at any time and type a new one (from €20). Over budget shows "Bring it under €x" (asks the agent for the same room for less) and "Raise budget to €y".
- **Deleting a room:** gone at once with "Undo" in a toast for six seconds; the server only deletes after that.
- **Reloads:** rooms with a photo survive a reload. A room that was mid-run comes back as "The page was reloaded before Roomify finished", with Back and Try again; the browser asks before leaving while Roomify works.
- **Input:** drafts are kept per room; a wall width reads "160", "160 cm", "1.6 m" or "3,2m"; a file that isn't a photo is named in the error; a pin's Swap goes in front of what you typed, never over it; the same message can't be sent twice by a double press.

## The 3D room
"Look around in 3D" once a room is done. It is a real 3D scene, not a warped picture:
- **Your room** is your own empty photo, pushed back by its depth with straight walls and a flat floor; its edges fade into the dark once the camera moves, so nothing is invented beyond what the photo saw.
- **Every piece** is a 3D model made from its shop photo, at its listed size, where the preview put it; soft shadows on the floor. While a model is being made its real-size outline shows in pine and the caption says "Modelling the desk in 3D…"; a piece without a model stands in flat, and the caption says so.
- **Opening:** the preview you just saw dissolves into the 3D room from the same viewpoint, then the camera swings round and sways until you drag. Front / Left / Right / Above, drag to walk round (about 50° each way), scroll to come closer; Escape closes. Price pins stay on their pieces.
- Never call the walk-in video 3D; this view is the 3D room.

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
| Rail hide | Rail slides out and its width closes (500 ms, in-out) |
| Controls | Press scale 0.97 |

## Rules that hold everywhere
- No gradients, glows, glass or shadows at rest (a pin card over the photo may carry one soft shadow to lift it off the picture).
- Rejections are grey with a strike, never red. Red is one mark, on a real failure.
- Money: `€` with no space, two decimals, tabular. Totals are computed from the pieces, never typed.
- Sentence case. Nothing under 12px. Every text tier at 4.5:1 or better.
- Errors live inside the block that failed, with the real reason and "Try again".
