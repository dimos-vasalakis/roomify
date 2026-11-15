# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Anyone furnishing a room: people moving in, renters, students, homeowners redoing one space, small offices. They have a real room, a budget and a deadline, and they want things they can actually buy and get soon, not inspiration. The demo tells the story through one scene (an empty room, a fixed budget, a city in Greece), but the product is not limited to students.

A second audience matters during the hackathon: judges watching a 3-minute video and a live stage demo on a projector. They must understand what the agent is doing without narration.

## Product Purpose
The user sends one photo of a space, says what they need and the budget. An agent shops real retailers first, reads each product page, rejects what does not fit the space, the budget or the page's own facts, and then renders the user's own room with exactly the products it chose. It checks its render against each listing and lets the user swap any item by saying what they want instead. The finished room can be looked around in 3D.

Success: the user ends with a room they can see and a basket they can buy, under budget, with every price, size and link traceable to the shop's own page.

## Positioning
Other room tools draw a nice room first and then look for look-alike products. Roomify buys first, draws second, then proves the picture matches the basket. Its decisions are visible: every candidate it looked at and rejected stays on screen with the reason.

## Operating Context
- One workspace that changes state as the agent works: start, the agent's one question (usually a wall width), live shopping, rendering, checking, result, swap, 3D.
- A phone page (`/snap`) opened by QR code lets someone photograph a real space and send it to the big screen.
- The agent's steps arrive as a stream of server-sent events; the interface must also replay a recorded run with no network for the demo.
- Retailers are Greek (for example IKEA Greece, JYSK, Leroy Merlin); prices in euros.

## Capabilities and Constraints
- Interface language: English. Product names, shop names, delivery text and prices appear exactly as the retailer writes them, often in Greek, so every text style must render Greek.
- A price, size, stock or delivery claim is shown only if it was read from the shop's page and passed the extraction check. Nothing is invented to fill a gap.
- The rendered room is a preview, not a product photo; the listing photo is always one interaction away.
- "Near you" means what the data supports: delivery text from the listing, distance to the chain's nearest store, number of shops in the basket. No live per-store stock claims.
- Checkout and payment are out of scope.
- Front end deploys to Vercel; back end on Render; Supabase for database and auth (login is not on the demo path).

## Brand Commitments
- Name on screen: Roomify, held in one constant so it can change. A different live product named Roomify exists; the team accepted the clash for now.

## Evidence on Hand
None confirmed yet. No real room photo, no verified product listings and no physical product exist today. Until they do, the interface runs on clearly sample data, and no screen, caption or video may present sample material as a real customer, room, product or result.

## Product Principles
1. Decisions over decoration: what the agent chose and rejected, with reasons, matters more than the picture.
2. Every number is traceable to a shop's page, and every total is the sum of what is shown.
3. The budget is a hard line, not a suggestion.
4. One question at a time: the agent asks only what it cannot infer, then gets on with it.
5. Works live or replayed, identically, so the demo cannot be broken by a network.

## Accessibility & Inclusion
- Must read on a projector from the back of a room: large text, high contrast, no thin grey text.
- All text at 4.5:1 contrast or better; full keyboard use; visible focus.
- Motion respects `prefers-reduced-motion`: content stays, travel is removed.
