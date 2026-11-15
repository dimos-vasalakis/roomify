"""Explicit item replacement: no match preserves the current room and offers a choice."""

import asyncio
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.agent import loop
from app.judges.basket import Basket, Pick
from app.llm import LLMError
from app.main import app
from app.tools.find_products import FindResult
from tests.test_offer import extract_listing, fixture
from tests.test_turn import post


@pytest.fixture
def replacement(monkeypatch: pytest.MonkeyPatch):  # type: ignore[no-untyped-def]
    old = extract_listing(*fixture("ikea_mittzon_desk"))
    new = old.model_copy(update={"id": "oak-desk", "url": old.url + "?oak", "price_eur": 199})
    lines = [
        loop.BasketLine(slot=s, url=old.url, title=old.title, price_eur=old.price_eur)
        for s in ["Desk", "Desk 2"]
    ]
    state = loop.Turn(
        message="Replace the second desk",
        budget=600,
        city="Athens",
        basket=lines,
        intent=loop.Intent(action="swap", slot="Desk 2", instruction="warmer oak"),
    )
    spec = loop.Spec(slot="Desk", spec=loop.ProductSpec(item=["desk"]))
    monkeypatch.setattr(loop, "_reread", AsyncMock(return_value={"Desk": old, "Desk 2": old}))
    monkeypatch.setattr(loop, "_specs", AsyncMock(return_value=("", [spec])))
    shop = AsyncMock(return_value=FindResult(candidates=[new], rejected=[], searched=1, note=None))
    monkeypatch.setattr(loop, "_shop", shop)
    judge = AsyncMock(
        return_value=Basket(
            text="A warmer desk",
            picks=[
                Pick(slot="Desk 2", product_id=new.id, passed=True, reason="Matches the request")
            ],
        )
    )
    monkeypatch.setattr(loop, "judge_basket", judge)
    picture = AsyncMock(return_value=True)
    edit = AsyncMock(return_value=True)
    monkeypatch.setattr(loop, "_picture", picture)
    monkeypatch.setattr(loop, "_swap_in_place", edit)
    return old, new, state, shop, judge, picture, edit


@pytest.mark.parametrize("outcome", ["none", "same listing", "judge rejected", "over budget"])
async def test_no_suitable_alternative_keeps_basket_and_render(
    replacement,
    outcome: str,  # type: ignore[no-untyped-def]
) -> None:
    old, new, state, shop, judge, picture, edit = replacement
    if outcome == "none":
        shop.return_value = FindResult(candidates=[], rejected=[], searched=1, note=None)
    elif outcome == "same listing":
        shop.return_value = FindResult(candidates=[old], rejected=[], searched=1, note=None)
    elif outcome == "judge rejected":
        judge.return_value = Basket(text="Does not meet the criteria", picks=[])
    else:
        shop.return_value = FindResult(
            candidates=[new.model_copy(update={"price_eur": 500})],
            rejected=[],
            searched=1,
            note=None,
        )
    sent: list[tuple[str, dict[str, object]]] = []
    await loop._swap(b"photo", state, loop._pressed(state.intent, state), sent.append)
    assert not any(
        k in {"product.chosen", "product.removed", "render.ready", "error"} for k, _ in sent
    )
    miss = next(d for k, d in sent if k == "replacement.unavailable")
    assert miss["slot"] == "Desk 2" and miss["current_url"] == old.url
    assert miss["instruction"] == "warmer oak" and miss["reason"]
    assert sent[-1] == ("done", {"total_eur": old.price_eur * 2, "currency": "EUR"})
    picture.assert_not_awaited()
    edit.assert_not_awaited()


async def test_replace_button_changes_only_selected_copy(replacement) -> None:  # type: ignore[no-untyped-def]
    old, new, state, shop, judge, _picture, edit = replacement
    sent: list[tuple[str, dict[str, object]]] = []
    await loop._swap(b"photo", state, loop._pressed(state.intent, state), sent.append)
    assert shop.await_args.args[1] == 600 - old.price_eur
    assert judge.await_args.args[-1] == {"Desk 2": 1}
    assert [d["slot"] for k, d in sent if k == "product.chosen"] == ["Desk 2"]
    assert not any(k == "product.removed" for k, _ in sent)
    assert edit.await_args.args[3] == {"Desk": old, "Desk 2": new}
    assert sent[-1] == ("done", {"total_eur": old.price_eur + 199, "currency": "EUR"})


async def test_service_failure_is_retryable_and_not_a_no_match(
    replacement,  # type: ignore[no-untyped-def]
) -> None:
    _old, _new, state, shop, _judge, _picture, _edit = replacement
    shop.side_effect = LLMError("The shop service is unavailable. Try again.")
    out: asyncio.Queue = asyncio.Queue()
    await loop.run_turn(b"photo", state, out)
    sent = []
    while not out.empty():
        sent.append(out.get_nowait())
    assert any(e and e[0] == "error" and e[1]["retryable"] for e in sent)
    assert not any(e and e[0] in {"replacement.unavailable", "product.chosen"} for e in sent)


def test_replace_intent_bypasses_model_routing(monkeypatch: pytest.MonkeyPatch) -> None:
    import json

    monkeypatch.setenv("FAL_KEY", "test-only")
    never = AsyncMock(side_effect=AssertionError("Buttons must route exactly"))
    swap = AsyncMock()
    monkeypatch.setattr(loop, "decide", never)
    monkeypatch.setattr(loop, "_swap", swap)
    got = post(
        {
            "basket": json.dumps([{"slot": "Desk", "url": "https://ikea.gr/desk"}]),
            "intent": json.dumps({"action": "swap", "slot": "Desk", "instruction": "oak"}),
        }
    )
    assert got.status_code == 200
    never.assert_not_awaited()
    assert swap.call_args.args[2].slot == "Desk"
    assert swap.call_args.args[2].instruction == "oak"


def test_video_generation_is_not_exposed() -> None:
    with TestClient(app) as client:
        assert (
            client.post("/walkin", json={"render_url": "https://v3.fal.media/a.jpg"}).status_code
            == 404
        )


def test_a_replacement_copy_gets_an_unused_id() -> None:
    product = extract_listing(*fixture("ikea_mittzon_desk"))
    earlier = [product, product.model_copy(update={"id": product.id + "-3"})]
    copy = loop._copy_of(product, "Desk", earlier)
    assert copy.id not in {p.id for p in earlier}
    assert copy.id == product.id + "-4"


async def test_reading_a_remaining_copy_preserves_its_browser_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.tools.read_product_page import PageRead

    product = extract_listing(*fixture("ikea_mittzon_desk"))
    monkeypatch.setattr(
        loop,
        "read_product_page",
        AsyncMock(return_value=PageRead(url=product.url, listing=product, error=None)),
    )
    line = loop.BasketLine(id=product.id + "-2", slot="Desk 2", url=product.url)
    got = await loop._reread([line], lambda _: None)
    assert got["Desk 2"].id == line.id
    assert got["Desk 2"].price_eur == product.price_eur


async def test_replacement_edit_identifies_the_selected_physical_copy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tests.test_turn import _swap_setup

    old, new, edit, _picture, state = _swap_setup(
        monkeypatch,
        loop.RenderCheck(
            room_preserved=True,
            no_extra_products=True,
            products=[
                loop.BoxCheck(
                    product_id="new-desk", match=True, note="Matches", box_2d=[200, 100, 600, 600]
                )
            ],
        ),
    )
    state = state.model_copy(
        update={
            "intent": loop.Intent(
                action="swap",
                slot="Desk",
                instruction="oak",
                box=loop.TargetBox(x=0.6, y=0.4, w=0.2, h=0.3),
            )
        }
    )
    assert await loop._swap_in_place(state, "Desk", old, {"Desk": new}, lambda _: None)
    prompt = edit.await_args.args[0]
    assert "70.0% from the LEFT" in prompt
    assert "55.0% from the TOP" in prompt
    assert "identical pieces elsewhere stay unchanged" in prompt


async def test_removal_edit_identifies_the_selected_physical_copy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(loop, "_latest", AsyncMock(return_value=b"photo"))
    edit = AsyncMock(return_value=True)
    monkeypatch.setattr(loop, "_edit_in_place", edit)
    state = loop.Turn(
        message="remove",
        city="Athens",
        budget=500,
        render_url="https://v3.fal.media/room.jpg",
        intent=loop.Intent(
            action="drop", slot="Chair 2", box=loop.TargetBox(x=0.6, y=0.4, w=0.2, h=0.3)
        ),
    )
    await loop._drop_in_place(state, "Chair 2", {}, ["Chair 2"], lambda _: None)
    assert "70.0% from the LEFT" in edit.await_args.args[3]
