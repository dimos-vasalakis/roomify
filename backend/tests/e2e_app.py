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
from app.tools.read_product_page import extract_listing
from app.tools.search_products import ProductSpec
from app.tools.transcribe import Transcript
from tests.test_read_product_page import fixture

url, html = fixture("ikea_mittzon_desk")
product = extract_listing(url, html)
loop._specs = AsyncMock(
    return_value=("A calm workspace", [loop.Spec(slot="Desk", spec=ProductSpec(item=["γραφείο"]))])
)
loop.find_products = AsyncMock(
    return_value=FindResult(candidates=[product], rejected=[], searched=1, note=None)
)
loop.judge_basket = AsyncMock(
    return_value=Basket(
        text="A calm workspace",
        picks=[
            Pick(
                slot="Desk",
                product_id=product.id,
                passed=True,
                reason="A desk sized for your work corner.",
            )
        ],
    )
)
loop._layout = AsyncMock(return_value=None)
loop._render = AsyncMock(return_value="http://127.0.0.1:8173/test-room.jpg")
loop._check = AsyncMock(
    return_value=loop.RenderCheck(
        room_preserved=True,
        no_extra_products=True,
        products=[
            loop.BoxCheck(
                product_id=product.id, match=True, note="Matches", box_2d=[200, 100, 600, 600]
            )
        ],
    )
)


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
