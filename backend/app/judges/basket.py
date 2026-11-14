"""One grounded selection/check pass, using the documented llm judge fallback."""

import asyncio
import json
import math
from decimal import Decimal
from itertools import product as combinations
from pathlib import Path

from pydantic import BaseModel, Field

from app.llm import LLMError, llm
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
    budget_option: int | None = None


def budget_options(
    candidates: dict[str, list[ProductListing]],
    budget: float,
) -> list[dict[str, str]]:
    """Feasible whole baskets in the requested spend range; the model chooses the style."""
    low, high = Decimal(str(budget)) * Decimal("0.5"), Decimal(str(budget)) * Decimal("0.8")
    slots = list(candidates)
    options = []
    for pieces in combinations(*(candidates[slot] for slot in slots)):
        total = sum((Decimal(str(p.price_eur)) for p in pieces), Decimal(0))
        if low <= total <= high and len({p.id for p in pieces}) == len(slots):
            options.append({slot: p.id for slot, p in zip(slots, pieces, strict=True)})
    return options[:: max(1, math.ceil(len(options) / 48))]


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
    options = budget_options(candidates, budget)
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
        + f"\nHard budget limit: €{budget:g}. Target basket total: "
        + f"€{budget * 0.5:.2f}–€{budget * 0.8:.2f}; ideally about €{budget * 0.7:.2f}.\nCandidates:\n"
        + json.dumps(descriptions, ensure_ascii=False)
        + (
            "\nFeasible complete baskets in the target range (zero-based indices):\n"
            + json.dumps(options)
            + '\nChoose exactly ONE of these baskets. Return its index as "budget_option" '
            "alongside text and picks. The picks must match that basket exactly; check their "
            "evidence and explain their relevance as usual."
            if options
            else "\nNo complete shortlist combination fits the target range; choose the closest suitable basket under the hard limit."
        ),
        images=images,
        json_out=True,
    )
    basket = Basket.model_validate(raw)
    if options:
        index = basket.budget_option
        chosen = {pick.slot: pick.product_id for pick in basket.picks}
        if index is None or not 0 <= index < len(options) or chosen != options[index]:
            raise LLMError(
                "The designer couldn't assemble the room within the target budget. Please try again."
            )
    return basket
