"""A furnishing allowance should buy a complete basket in the target spend band."""

from unittest.mock import AsyncMock

import pytest

from app.judges import basket
from app.llm import LLMError
from tests.test_find_products import listing


def choices():
    return {
        "Desk": [
            listing("https://jysk.gr/cheap", id="cheap", price_eur=100),
            listing("https://jysk.gr/upgrade", id="upgrade", price_eur=175),
        ],
        "Chair": [listing("https://jysk.gr/chair", id="chair", price_eur=99)],
    }


def test_budget_band_excludes_tiny_basket_when_suitable_upgrade_is_available():
    assert basket.budget_options(choices(), 500) == [{"Desk": "upgrade", "Chair": "chair"}]


def test_unreachable_band_does_not_invent_products_or_prices():
    assert basket.budget_options(choices(), 2000) == []


async def test_model_cannot_return_low_spend_instead_of_its_budget_option(monkeypatch):
    monkeypatch.setattr(basket, "image_data", AsyncMock(return_value=b"image"))
    monkeypatch.setattr(
        basket,
        "llm",
        AsyncMock(
            return_value={
                "text": "Design",
                "budget_option": 0,
                "picks": [
                    {"slot": "Desk", "product_id": "cheap", "passed": True, "reason": "Cheap"},
                    {"slot": "Chair", "product_id": "chair", "passed": True, "reason": "Fits"},
                ],
            }
        ),
    )
    with pytest.raises(LLMError, match="target budget"):
        await basket.judge_basket(b"photo", "A desk and chair", 500, choices())
