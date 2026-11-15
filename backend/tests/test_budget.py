"""A furnishing allowance should buy a complete basket in the target spend band."""

from unittest.mock import AsyncMock

from app.judges import basket
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


async def test_picks_follow_the_chosen_budget_option_instead_of_failing_the_run(monkeypatch):
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
    result = await basket.judge_basket(b"photo", "A desk and chair", 500, choices())
    assert {p.slot: p.product_id for p in result.picks} == {"Desk": "upgrade", "Chair": "chair"}
    assert [p.reason for p in result.picks if p.slot == "Chair"] == ["Fits"]


def test_an_empty_slot_is_retried_with_fewer_conditions():
    from app.agent.loop import _wider
    from app.tools.search_products import ProductSpec

    spec = ProductSpec(item=["κάδρο"], keywords=["μπλε"], max_price_eur=40, max_height_cm=60,
                       max_width_cm=120)  # fmt: skip
    wider = _wider(spec, 200)
    assert wider is not None
    assert (wider.keywords, wider.max_price_eur, wider.max_height_cm) == ([], 200, None)
    assert wider.max_width_cm == 120  # a measured wall still counts
    assert _wider(wider, 200) is None  # nothing left to loosen: no second retry


def test_copies_count_in_every_budget_option():
    """Two desks and two chairs at these prices: only the cheap desk keeps 2000 in the band."""
    assert basket.budget_options(choices(), 1000, {"Desk": 2, "Chair": 2}) == [
        {"Desk": "upgrade", "Chair": "chair"}
    ]
    assert basket.budget_options(choices(), 500, {"Desk": 3, "Chair": 6}) == []


async def test_one_pick_per_copy_no_longer_crashes_the_run(monkeypatch):
    """Asked for 3 tables and 6 chairs, the judge answered with nine picks and the run died
    with "The design couldn't be completed"."""
    monkeypatch.setattr(basket, "image_data", AsyncMock(return_value=b"image"))
    picks = [{"slot": "Chair", "product_id": "chair", "passed": True, "reason": "Fits"}] * 9
    monkeypatch.setattr(basket, "llm", AsyncMock(return_value={"text": "Design", "picks": picks}))
    result = await basket.judge_basket(b"photo", "6 chairs", 5000, choices(), counts={"Chair": 6})
    assert [p.slot for p in result.picks] == ["Chair"]
