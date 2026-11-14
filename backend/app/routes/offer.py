"""POST /offer: one photo and a brief in, a real basket out, streamed as it happens.

The demo path: no login and no database. Steps, each one an event on the stream:
  1. the AI reads the photo and brief into 3 to 5 searches (or a word list without the AI),
  2. the scraper finds real products for each search (app/tools/find_products.py),
  3. one product per item is picked to fit the budget; the rest are rejections with reasons,
  4. the room is rendered with those products on fal (skipped without FAL_KEY),
  5. the AI places a box on each product in the render, for the price dots.
Event names and payloads follow docs/API.md, so the front end draws them as a normal run.
"""

import asyncio
import hashlib
import json
import os
import re
from collections.abc import AsyncIterator
from typing import Annotated, Any

import fal_client
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.cache import cached
from app.llm import LLMError, llm, llm_available
from app.tools.find_products import FindResult, find_products
from app.tools.read_product_page import ProductListing
from app.tools.search_products import ProductSpec

router = APIRouter(tags=["offer"])

PHOTO_TYPES = {"image/jpeg", "image/png", "image/webp"}
PHOTO_MAX_BYTES = 8 * 1024 * 1024
MAX_ITEMS = 5
KEEPALIVE_S = 10.0
RENDER_MODEL = os.getenv("FAL_RENDER_MODEL", "fal-ai/nano-banana/edit")
RUNS = asyncio.Semaphore(2)  # each run calls shops and paid models; keep it to two at once

# Without the AI: English and Greek words in the brief mapped to what the shops call things.
WORDS: dict[str, tuple[str, list[str]]] = {
    "desk": ("Desk", ["γραφείο"]),
    "armchair": ("Armchair", ["πολυθρόνα"]),
    "reading chair": ("Armchair", ["πολυθρόνα"]),
    "office chair": ("Office chair", ["καρέκλα γραφείου"]),
    "chair": ("Chair", ["καρέκλα"]),
    "sofa": ("Sofa", ["καναπές"]),
    "couch": ("Sofa", ["καναπές"]),
    "lamp": ("Lamp", ["φωτιστικό"]),
    "light": ("Lamp", ["φωτιστικό"]),
    "rug": ("Rug", ["χαλί"]),
    "carpet": ("Rug", ["χαλί"]),
    "bed": ("Bed", ["κρεβάτι"]),
    "nightstand": ("Bedside table", ["κομοδίνο"]),
    "bedside": ("Bedside table", ["κομοδίνο"]),
    "bookcase": ("Bookcase", ["βιβλιοθήκη"]),
    "shelf": ("Shelf", ["ράφι"]),
    "coffee table": ("Coffee table", ["τραπεζάκι σαλονιού"]),
    "table": ("Table", ["τραπέζι"]),
    "mirror": ("Mirror", ["καθρέφτης"]),
    "wardrobe": ("Wardrobe", ["ντουλάπα"]),
    "curtain": ("Curtains", ["κουρτίνα"]),
    "plant": ("Plant pot", ["γλάστρα"]),
    "γραφείο": ("Desk", ["γραφείο"]),
    "καρέκλα": ("Chair", ["καρέκλα"]),
    "πολυθρόνα": ("Armchair", ["πολυθρόνα"]),
    "καναπέ": ("Sofa", ["καναπές"]),
    "φωτιστικ": ("Lamp", ["φωτιστικό"]),
    "χαλί": ("Rug", ["χαλί"]),
    "κρεβάτι": ("Bed", ["κρεβάτι"]),
}

SPEC_PROMPT = """You furnish a real room from Greek shops (IKEA, JYSK, Leroy Merlin and similar).
The person's brief: "{brief}". Budget: €{budget:g} in total. City: {city}.{wall}
Look at the photo and decide the 3 to {max_items} items the room needs most for this brief,
most important first. For each, write how a Greek shop names it.
Answer JSON only:
{{"items": [{{"slot": "Desk", "item": ["γραφείο"], "keywords": ["δρυς"], "exclude": ["καρέκλα"],
  "max_price_eur": 150, "max_width_cm": 120, "max_depth_cm": null, "max_height_cm": null}}]}}
Rules: slot is a short English name. item, keywords and exclude are Greek words.
max_price_eur values add up to at most the budget. Give max_width_cm only when the photo or
the stated wall width limits it. Use null when unknown."""

BOX_PROMPT = """This is a photo of a furnished room. Find each of these products in it:
{items}
Answer JSON only: {{"boxes": [{{"slot": "<slot as given>", "box_2d": [ymin, xmin, ymax, xmax]}}]}}
with coordinates from 0 to 1000. Leave out a product you cannot see."""


class Spec(BaseModel):
    slot: str
    spec: ProductSpec


class RenderOut(BaseModel):
    image_url: str


class BoxesOut(BaseModel):
    boxes: dict[str, list[float]]  # slot -> [x, y, w, h], 0 to 1


def _event(seq: int, type_: str, data: dict[str, Any]) -> str:
    return f"id: {seq}\nevent: {type_}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _rule(reason: str) -> str:
    text = reason.lower()
    if "budget" in text or "€" in text:
        return "budget"
    if "allows" in text or "cm" in text:
        return "size"
    return "page-check"


def _product_out(p: ProductListing) -> dict[str, Any]:
    return {
        "id": p.id, "url": p.url, "retailer": p.retailer, "title": p.title,
        "image_url": p.image_url, "price_eur": p.price_eur, "width_cm": p.width_cm,
        "depth_cm": p.depth_cm, "height_cm": p.height_cm, "delivery_text": p.delivery_text,
        "in_stock": p.in_stock,
    }  # fmt: skip


def _specs_from_words(brief: str, budget: float, wall_cm: float | None) -> list[Spec]:
    text = brief.lower()
    found: list[Spec] = []
    used: set[str] = set()
    for word, (slot, item) in WORDS.items():  # longer phrases come first in the table
        if word in text and slot not in used:
            used.add(slot)
            text = text.replace(word, " ")
            found.append(Spec(slot=slot, spec=ProductSpec(item=item, max_width_cm=wall_cm if slot in {"Desk", "Sofa", "Bed", "Bookcase", "Wardrobe"} else None)))
    if not found:
        found = [Spec(slot="Armchair", spec=ProductSpec(item=["πολυθρόνα"])), Spec(slot="Lamp", spec=ProductSpec(item=["φωτιστικό"]))]
    found = found[:MAX_ITEMS]
    share = round(budget / len(found), 2)
    for s in found:
        s.spec.max_price_eur = round(share * 1.6)  # room to trade between items; the picker keeps the total
    return found


async def _specs(photo: bytes, mime: str, brief: str, budget: float, city: str, wall_cm: float | None) -> list[Spec]:
    if not llm_available():
        return _specs_from_words(brief, budget, wall_cm)
    wall = f" The main wall is {wall_cm:g} cm wide." if wall_cm else ""
    prompt = SPEC_PROMPT.format(brief=brief, budget=budget, city=city, wall=wall, max_items=MAX_ITEMS)

    async def ask() -> list[Spec]:
        answer = await llm(prompt, images=[(photo, mime)], json_out=True)
        specs = []
        for raw in (answer.get("items") or [])[:MAX_ITEMS]:
            slot = str(raw.pop("slot", "Item"))[:40]
            try:
                specs.append(Spec(slot=slot, spec=ProductSpec.model_validate(raw)))
            except ValueError:
                continue
        if not specs:
            raise LLMError("The AI did not name any items.")
        return specs

    inputs = {"photo": hashlib.sha256(photo).hexdigest(), "brief": brief, "budget": budget, "wall": wall_cm}
    try:
        return await cached("offer-specs", inputs, ask, list[Spec])
    except LLMError:
        return _specs_from_words(brief, budget, wall_cm)


def _pick(results: list[tuple[Spec, FindResult]], budget: float) -> tuple[dict[str, ProductListing], list[tuple[str, ProductListing, str]]]:
    """One product per item, as good as the budget allows: each item gets an even share of
    what is left, and the dearest product inside that share wins (dearer usually means sturdier)."""
    chosen: dict[str, ProductListing] = {}
    turned: list[tuple[str, ProductListing, str]] = []
    left = budget
    pending = [(s, r) for s, r in results if r.candidates]
    for i, (spec, result) in enumerate(pending):
        others = pending[i + 1 :]
        reserve = sum(min(c.price_eur for c in r.candidates) for _, r in others)
        share = max((left - reserve) / (len(others) + 1) * 1.5, 0)
        cap = left - reserve
        by_price = sorted(result.candidates, key=lambda c: c.price_eur)
        fits = [c for c in by_price if c.price_eur <= min(share, cap)] or [c for c in by_price if c.price_eur <= cap]
        if not fits:
            cheapest = by_price[0]
            turned.append((spec.slot, cheapest, f"€{cheapest.price_eur:g} would put the basket over the €{budget:g} budget"))
            continue
        pick = fits[-1]
        chosen[spec.slot] = pick
        left = round(left - pick.price_eur, 2)
        for c in by_price:
            if c.price_eur > cap and c is not pick and len(turned) < 12:
                turned.append((spec.slot, c, f"€{c.price_eur:g} would leave too little for the other items"))
                break
    return chosen, turned


async def _render(photo: bytes, mime: str, chosen: dict[str, ProductListing]) -> str | None:
    if not os.getenv("FAL_KEY") or not chosen:
        return None
    items = list(chosen.items())
    lines = "\n".join(f"Image {i + 2} is the {slot.lower()}: {p.title}." for i, (slot, p) in enumerate(items))
    prompt = (
        "Image 1 is a photo of a room. Place the products shown in the other images into this room, "
        "each where it naturally belongs, at a believable real-world size.\n"
        f"{lines}\nKeep the walls, windows, doors, floor, camera angle and light exactly as in image 1. "
        "Keep each product's shape, colour and material exactly as in its image. Photorealistic."
    )

    async def call() -> RenderOut:
        room_url = await fal_client.upload_async(photo, mime)
        result = await asyncio.wait_for(
            fal_client.subscribe_async(
                RENDER_MODEL,
                arguments={"prompt": prompt, "image_urls": [room_url, *[p.image_url for _, p in items]], "num_images": 1},
            ),
            120,
        )
        return RenderOut(image_url=result["images"][0]["url"])

    inputs = {"photo": hashlib.sha256(photo).hexdigest(), "products": [p.id for _, p in items], "model": RENDER_MODEL}
    return (await cached("offer-render", inputs, call, RenderOut)).image_url


async def _boxes(image_url: str, chosen: dict[str, ProductListing]) -> dict[str, list[float]]:
    slots = list(chosen)
    fallback = {slot: [0.12 + i * (0.76 / max(len(slots), 1)), 0.55, 0.1, 0.12] for i, slot in enumerate(slots)}
    if not llm_available():
        return fallback

    async def call() -> BoxesOut:
        import httpx

        async with httpx.AsyncClient(timeout=30) as client:
            image = (await client.get(image_url)).content
        items = "\n".join(f"- {slot}: {p.title}" for slot, p in chosen.items())
        answer = await llm(BOX_PROMPT.format(items=items), images=[(image, "image/jpeg")], json_out=True)
        boxes: dict[str, list[float]] = {}
        for raw in answer.get("boxes") or []:
            slot, box = raw.get("slot"), raw.get("box_2d")
            if slot in chosen and isinstance(box, list) and len(box) == 4:
                y0, x0, y1, x1 = (max(0.0, min(1000.0, float(v))) / 1000 for v in box)
                if x1 > x0 and y1 > y0:
                    boxes[slot] = [x0, y0, x1 - x0, y1 - y0]
        return BoxesOut(boxes=boxes)

    try:
        found = (await cached("offer-boxes", {"image": image_url, "slots": slots}, call, BoxesOut)).boxes
    except Exception:  # noqa: BLE001  boxes are a nicety; never fail the offer for them
        found = {}
    return {slot: found.get(slot, fallback[slot]) for slot in slots}


async def _run(photo: bytes, mime: str, brief: str, budget: float, city: str, wall_cm: float | None, out: asyncio.Queue[tuple[str, dict[str, Any]] | None]) -> None:
    send = out.put_nowait
    try:
        send(("run.status", {"status": "running"}))
        send(("step.started", {"text": "Reading your photo and your brief"}))
        specs = await _specs(photo, mime, brief, budget, city, wall_cm)
        send(("step.started", {"text": f"Searching Greek shops for {', '.join(s.slot.lower() for s in specs)}"}))

        async def one(s: Spec) -> tuple[Spec, FindResult]:
            return s, await find_products(s.spec, want=6)

        results: list[tuple[Spec, FindResult]] = []
        for task in asyncio.as_completed([one(s) for s in specs]):
            spec, result = await task
            results.append((spec, result))
            shown = [r for r in result.rejected if not r.reason.startswith("Same product")][:3]
            for r in shown:
                reason = re.sub(r"over the €[\d.,]+ budget", f"more than this item's share of your €{budget:g} budget", r.reason)
                send(("candidate.rejected", {"slot": spec.slot, "product": {"title": r.title, "retailer": r.shop_name, "url": r.url, "price_eur": None}, "rule": _rule(r.reason), "reason": reason}))
            found = len(result.candidates)
            send(("step.started", {"text": f"{spec.slot}: {found} that fit, out of {result.searched} pages read" if found else f"{spec.slot}: nothing fits yet. {result.note or ''}".strip()}))

        order = {s.slot: i for i, s in enumerate(specs)}
        results.sort(key=lambda sr: order[sr[0].slot])
        chosen, turned = _pick(results, budget)
        for slot, p, reason in turned:
            send(("candidate.rejected", {"slot": slot, "product": {"title": p.title, "retailer": p.retailer, "url": p.url, "price_eur": p.price_eur}, "rule": "budget", "reason": reason}))
        for slot, p in chosen.items():
            send(("product.chosen", {"slot": slot, "product": _product_out(p)}))
        if not chosen:
            send(("error", {"message": "No product fit the brief and budget. Try a bigger budget or fewer items.", "retryable": True}))
            return

        if os.getenv("FAL_KEY"):
            send(("step.started", {"text": f"Drawing your room with the {len(chosen)} products it chose"}))
            try:
                image_url = await _render(photo, mime, chosen)
            except Exception:  # noqa: BLE001  the basket stands without the picture
                image_url = None
                send(("step.started", {"text": "Couldn't draw the room this time. Your basket is ready."}))
            if image_url:
                boxes = await _boxes(image_url, chosen)
                items = [{"product_id": p.id, "box": dict(zip(("x", "y", "w", "h"), boxes[slot], strict=True))} for slot, p in chosen.items()]
                send(("render.ready", {"render_id": hashlib.sha256(image_url.encode()).hexdigest()[:12], "kind": "render", "image_url": image_url, "items": items}))

        total = round(sum(p.price_eur for p in chosen.values()), 2)
        send(("done", {"total_eur": total}))
        send(("run.status", {"status": "done"}))
    except Exception as exc:  # noqa: BLE001  the stream must end with a readable error, never a crash
        send(("error", {"message": f"Something went wrong while shopping ({exc.__class__.__name__}). Try again.", "retryable": True}))
    finally:
        send(None)


@router.post("/offer")
async def offer(
    photo: Annotated[UploadFile, File()],
    brief: Annotated[str, Form(min_length=3, max_length=500)],
    budget_eur: Annotated[float, Form(gt=0, le=100_000)],
    city: Annotated[str, Form(max_length=80)] = "Athens",
    wall_cm: Annotated[float | None, Form(gt=0, le=5000)] = None,
) -> StreamingResponse:
    if photo.content_type not in PHOTO_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Use a JPEG, PNG or WebP photo.")
    data = await photo.read(PHOTO_MAX_BYTES + 1)
    if len(data) > PHOTO_MAX_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "The photo must be under 8 MB.")
    if RUNS.locked():
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Two rooms are being furnished right now. Try again in a minute.")
    brief = re.sub(r"\s+", " ", brief).strip()

    async def stream() -> AsyncIterator[str]:
        async with RUNS:
            queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue()
            task = asyncio.create_task(_run(data, photo.content_type or "image/jpeg", brief, budget_eur, city, wall_cm, queue))
            seq = 0
            try:
                while True:
                    try:
                        item = await asyncio.wait_for(queue.get(), KEEPALIVE_S)
                    except TimeoutError:
                        yield ": keepalive\n\n"
                        continue
                    if item is None:
                        break
                    seq += 1
                    yield _event(seq, *item)
            finally:
                task.cancel()

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


SWAP_PROMPT = """A person is furnishing a room from Greek shops. They have this {slot}: "{title}" (€{price:g}).
They said: "{instruction}". Write the search for its replacement, the way a Greek shop names things.
Answer JSON only: {{"item": ["καρέκλα"], "keywords": ["μπλε"], "exclude": []}}"""


class SwapIn(BaseModel):
    slot: str
    title: str
    price_eur: float
    instruction: str
    budget_left_eur: float = 0
    wall_cm: float | None = None
    product_id: str


@router.post("/offer/swap")
async def swap(body: SwapIn) -> dict[str, Any]:
    """One item, replaced by what the person asked for. Same scraper, same fit checks.
    Answers with a `product.swapped` payload (docs/API.md), or 404 with the reason."""
    cap = round(body.price_eur + max(body.budget_left_eur, 0), 2)
    if "cheap" in body.instruction.lower() or "φθην" in body.instruction.lower():
        cap = min(cap, round(body.price_eur * 0.95, 2))
    words = next((item for slot, item in WORDS.values() if slot.lower() == body.slot.lower()), None)
    spec = ProductSpec(item=words or [body.slot.lower()], max_price_eur=cap, max_width_cm=body.wall_cm if body.slot in {"Desk", "Sofa", "Bed"} else None)
    if llm_available():
        try:
            raw = await llm(SWAP_PROMPT.format(slot=body.slot, title=body.title, price=body.price_eur, instruction=body.instruction), json_out=True)
            spec = ProductSpec(item=raw.get("item") or spec.item, keywords=raw.get("keywords") or [], exclude=raw.get("exclude") or [],
                               max_price_eur=cap, max_width_cm=spec.max_width_cm)  # fmt: skip
        except (LLMError, ValueError):
            pass
    result = await find_products(spec, want=6)
    options = [c for c in result.candidates if c.id != body.product_id and c.title.casefold() != body.title.casefold()]
    if not options:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Nothing in the shops matched “{body.instruction}” within €{cap:g}. Try other words.")
    pick = max(options, key=lambda c: c.price_eur) if "cheap" not in body.instruction.lower() else min(options, key=lambda c: c.price_eur)
    return {"slot": body.slot, "old_product_id": body.product_id, "product": _product_out(pick), "reason": f"Swapped out: you asked for “{body.instruction}”"}
