"""Local browser-test server. Only external design services are deterministic fixtures.

Never deploy this module. Production routes, validation, agent loop and SSE remain real.
"""

import os
from io import BytesIO
from unittest.mock import AsyncMock

# Disable database, catalogue refresh, credentials and provider traffic before app imports.
os.environ.update(
    REPLAY="1",
    REFRESH_CATALOGUES="0",
    FAL_KEY="browser-test-only",
    GEMINI_API_KEY="",
    FRONTEND_ORIGINS="http://127.0.0.1:4173",
)

from fastapi.responses import Response
from PIL import Image

from app.agent import loop
from app.judges.basket import Basket, Pick
from app.main import app
from app.routes import speech
from app.tools.find_products import FindResult
from app.tools.read_product_page import PageRead, ProductListing, extract_listing
from app.tools.search_products import ProductSpec
from app.tools.transcribe import Transcript
from tests.test_read_product_page import fixture

url, html = fixture("ikea_mittzon_desk")
product = extract_listing(url, html)
loop._layout = AsyncMock(return_value=None)

# Replacement fixtures still exercise the production intent, search, judge and render flow.
replacement = product.model_copy(
    update={
        "id": "replacement-desk",
        "url": product.url + "?replacement=1",
        "title": "Oak desk",
        "price_eur": 199,
    }
)


async def _specs(photo: bytes, brief: str, *args: object) -> tuple[str, list[loop.Spec]]:
    if "Replace only" in brief:
        item = "fixture-no-match" if "no matching" in brief.lower() else "fixture-replacement"
    else:
        item = "γραφείο"
    return "A calm workspace", [loop.Spec(slot="Desk", spec=ProductSpec(item=[item]))]


async def _find(spec: ProductSpec, *args: object, **kwargs: object) -> FindResult:
    if "fixture-no-match" in spec.item:
        candidates = []
    else:
        candidates = [replacement if "fixture-replacement" in spec.item else product]
    return FindResult(candidates=candidates, rejected=[], searched=1, note=None)


async def _read(url: str) -> PageRead:
    return PageRead(url=url, listing=replacement if "replacement=1" in url else product, error=None)


async def _judge(
    photo: bytes,
    brief: str,
    budget: float,
    candidates: dict[str, list[ProductListing]],
    *args: object,
) -> Basket:
    return Basket(
        text="A calm workspace",
        picks=[
            Pick(
                slot=slot,
                product_id=pieces[0].id,
                passed=True,
                reason="Meets the requested criteria",
            )
            for slot, pieces in candidates.items()
            if pieces
        ],
    )


async def _render(
    photo: bytes, chosen: dict[str, ProductListing], *args: object, **kwargs: object
) -> str:
    suffix = (
        "?replacement=1"
        if any(p.id == replacement.id for p in chosen.values())
        else "?empty=1"
        if not chosen
        else ""
    )
    return "http://127.0.0.1:8173/test-room.jpg" + suffix


async def _check(
    photo: bytes, url: str, chosen: dict[str, ProductListing], *args: object, **kwargs: object
) -> loop.RenderCheck:
    return loop.RenderCheck(
        room_preserved=True,
        no_extra_products=True,
        products=[
            loop.BoxCheck(product_id=p.id, match=True, note="Matches", box_2d=[200, 100, 600, 600])
            for p in chosen.values()
        ],
    )


loop._specs = _specs
loop.find_products = _find
loop.read_product_page = _read
loop.judge_basket = _judge
loop._render = _render
loop._check = _check


async def _decide(photo: bytes, turn: loop.Turn) -> loop.Decision:
    """Scripted conversation: a question is answered from the basket, anything else designs."""
    if "budget" in turn.message.lower() and turn.basket:
        return loop.Decision(action="reply", say="Sure.")  # the server works the figure out
    if turn.message.rstrip().endswith("?") and turn.basket:
        return loop.Decision(action="reply", say=f"The desk is {product.width_cm:g} cm wide.")
    return loop.Decision(action="design", say="Let me find pieces for that.")


loop.decide = _decide
# The mic's fallback: whatever was recorded, Whisper "heard" a question about the basket.
speech.transcribe = AsyncMock(return_value=Transcript(text="How wide is the desk?"))


@app.get("/test-room.jpg")
async def room_image() -> Response:
    image = BytesIO()
    Image.new("RGB", (600, 400), "#d6cbb9").save(image, "JPEG")
    return Response(image.getvalue(), media_type="image/jpeg")
