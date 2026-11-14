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
from app.tools.find_products import FindResult
from app.tools.read_product_page import extract_listing
from app.tools.search_products import ProductSpec
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


@app.get("/test-room.jpg")
async def room_image() -> Response:
    image = BytesIO()
    Image.new("RGB", (600, 400), "#d6cbb9").save(image, "JPEG")
    return Response(image.getvalue(), media_type="image/jpeg")
