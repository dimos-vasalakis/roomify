"""One grounded selection/check pass, using the documented llm judge fallback."""

import asyncio
import json
from pathlib import Path

from pydantic import BaseModel, Field

from app.llm import llm
from app.tools.image_data import image_data
from app.tools.read_product_page import ProductListing


class Pick(BaseModel):
    slot: str
    product_id: str
    passed: bool
    reason: str


class Basket(BaseModel):
    text: str
    picks: list[Pick] = Field(max_length=5)


async def judge_basket(
    photo: bytes,
    brief: str,
    budget: float,
    candidates: dict[str, list[ProductListing]],
) -> Basket:
    flat = [(slot, p) for slot, products in candidates.items() for p in products]
    downloads = await asyncio.gather(
        *(image_data(p.image_url) for _, p in flat), return_exceptions=True
    )
    images = [(photo, "image/jpeg")]
    descriptions = []
    for (slot, product), picture in zip(flat, downloads, strict=True):
        entry = product.model_dump(exclude={"image_urls", "page_text"}) | {"slot": slot}
        if isinstance(picture, bytes):
            images.append((picture, "image/jpeg"))
            entry["reference_image"] = len(images)
        descriptions.append(entry)
    raw = await llm(
        Path(__file__).with_suffix(".yaml").read_text()
        + "\nImage 1 is the room.\nUser brief: "
        + json.dumps(brief)
        + f"\nBudget: €{budget:g}\nCandidates:\n"
        + json.dumps(descriptions, ensure_ascii=False),
        images=images,
        json_out=True,
    )
    return Basket.model_validate(raw)
