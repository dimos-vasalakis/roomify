"""One grounded selection/check pass, using the documented llm judge fallback."""

import asyncio
import json
import math
from decimal import Decimal
from itertools import product as combinations
from pathlib import Path

from pydantic import BaseModel, Field, ValidationError

from app.llm import LLMError, llm
from app.tools.image_data import image_data
from app.tools.money import money
from app.tools.read_product_page import ProductListing


class Pick(BaseModel):
    slot: str
    product_id: str
    passed: bool
    reason: str


class Basket(BaseModel):
    text: str
    picks: list[Pick] = Field(max_length=8)
    budget_option: int | None = None


def budget_options(
    candidates: dict[str, list[ProductListing]],
    budget: float,
    counts: dict[str, int] | None = None,
) -> list[dict[str, str]]:
    """Feasible whole baskets in the requested spend range; the model chooses the style.
    `counts`: copies of a piece ("3 tables"), each paid for."""
    low, high = Decimal(str(budget)) * Decimal("0.5"), Decimal(str(budget)) * Decimal("0.8")
    slots = list(candidates)
    many = [Decimal((counts or {}).get(slot, 1)) for slot in slots]
    options = []
    for pieces in combinations(*(candidates[slot] for slot in slots)):
        total = sum((Decimal(str(p.price_eur)) * n for p, n in zip(pieces, many, strict=True)),
                    Decimal(0))  # fmt: skip
        if low <= total <= high and len({p.id for p in pieces}) == len(slots):
            options.append({slot: p.id for slot, p in zip(slots, pieces, strict=True)})
    return options[:: max(1, math.ceil(len(options) / 48))]


async def judge_basket(
    photo: bytes,
    brief: str,
    budget: float,
    candidates: dict[str, list[ProductListing]],
    currency: str = "EUR",
    counts: dict[str, int] | None = None,
) -> Basket:
    """One pick per slot. `counts`: how many identical copies of a slot's piece are bought;
    the budget counts every copy."""
    counts = counts or {}
    flat = [(slot, p) for slot, products in candidates.items() for p in products]
    downloads = await asyncio.gather(
        *(image_data(p.image_url) for _, p in flat), return_exceptions=True
    )
    images = [(photo, "image/jpeg")]
    descriptions = []
    options = budget_options(candidates, budget, counts)
    for (slot, product), picture in zip(flat, downloads, strict=True):
        entry = product.model_dump(exclude={"image_urls", "page_text"}) | {"slot": slot}
        if counts.get(slot, 1) > 1:
            entry["quantity_bought"] = counts[slot]
        if isinstance(picture, bytes):
            images.append((picture, "image/jpeg"))
            entry["reference_image"] = len(images)
        descriptions.append(entry)
    raw = await llm(
        Path(__file__).with_suffix(".yaml").read_text()
        + "\nImage 1 is the room.\nUser brief: "
        + json.dumps(brief)
        + f"\nHard budget limit: {money(budget, currency)}. Target basket total: "
        + f"{money(budget * 0.5, currency)}–{money(budget * 0.8, currency)}; "
        + f"ideally about {money(budget * 0.7, currency)}. Prices are in {currency}.\nCandidates:\n"
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
        vision=True,
    )
    if isinstance(raw, dict) and isinstance(raw.get("picks"), list):
        # One pick per slot: asked for "3 tables", it answered once per table, and a ninth
        # pick crashed the whole run.
        firsts: dict[object, object] = {}
        for pick in raw["picks"]:
            if isinstance(pick, dict):
                firsts.setdefault(pick.get("slot"), pick)
        raw["picks"] = list(firsts.values())
    try:
        basket = Basket.model_validate(raw)
    except ValidationError as exc:
        raise LLMError("The basket check answered in a shape we couldn't read. Try again.") from exc
    index = basket.budget_option
    if options and index is not None and 0 <= index < len(options):
        # The basket index is the decision; picks that drift from it follow the index,
        # so one slip in the answer never costs the whole room. Without a valid index the
        # picks stand and the loop still enforces the hard budget.
        reasons = {pick.slot: pick.reason for pick in basket.picks}
        basket.picks = [
            Pick(slot=slot, product_id=pid, passed=True,
                 reason=reasons.get(slot) or "Fits the room and keeps the basket in budget")
            for slot, pid in options[index].items()
        ]  # fmt: skip
    return basket
