"""The conversation: one message in, the right action out, every turn ends cleanly."""

import json
from io import BytesIO
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.agent import loop
from app.agent.loop import BasketLine, ChatLine, Decision, Turn, _sane
from app.llm import LLMError
from app.main import app
from tests.test_offer import events

DESK = BasketLine(slot="Desk", url="https://www.ikea.gr/proioda/desk/1/", title="MITTZON",
                  price_eur=219, width_cm=140)  # fmt: skip


def turn(**fields: object) -> Turn:
    return Turn(**({"message": "a desk", "budget": 300, "city": "Athens"} | fields))  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("decision", "state", "action"),
    [
        (Decision(action="ask", question="Wall 320 cm?"), turn(), "ask"),
        # never twice, and not when the width is known
        (Decision(action="ask", question="Wall?"),
         turn(history=[ChatLine(role="agent", text="How wide is it?")]), "design"),
        (Decision(action="ask", question="Wall?"), turn(wall_cm=300), "design"),
        # a swap needs that slot in the basket
        (Decision(action="swap", slot="Sofa", say="ok"), turn(basket=[DESK]), "reply"),
        (Decision(action="swap", slot="Desk"), turn(basket=[DESK]), "swap"),
        (Decision(action="swap", slot="Desk"), turn(), "design"),
        # a view needs a rendered room
        (Decision(action="view", say="ok"), turn(basket=[DESK]), "reply"),
        (Decision(action="view"), turn(basket=[DESK], render_url="https://v3.fal.media/x.jpg"), "view"),
        (Decision(action="reply", say=""), turn(), "design"),
    ],
)  # fmt: skip
def test_impossible_actions_become_possible_ones(
    decision: Decision, state: Turn, action: str
) -> None:
    assert _sane(decision, state).action == action


async def test_a_silent_model_still_designs(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(loop, "llm", AsyncMock(side_effect=LLMError("down")))
    assert (await loop.decide(b"photo", turn())).action == "design"


def post(fields: dict[str, str]):  # type: ignore[no-untyped-def]
    image = BytesIO()
    Image.new("RGB", (30, 20)).save(image, "JPEG")
    with TestClient(app) as client:
        return client.post("/turn", files={"photo": ("room.jpg", image.getvalue(), "image/jpeg")},
                           data={"message": "a desk", "budget": "300"} | fields)  # fmt: skip


@pytest.fixture
def model(monkeypatch: pytest.MonkeyPatch):  # type: ignore[no-untyped-def]
    monkeypatch.setenv("FAL_KEY", "test-only")

    def answer(decision: dict[str, object]) -> None:
        monkeypatch.setattr(loop, "llm", AsyncMock(return_value=decision))

    return answer


def test_ask_proposes_a_number_and_waits(model) -> None:  # type: ignore[no-untyped-def]
    model({"action": "ask", "say": "One thing first.", "question": "This wall looks about 320 cm. Right?",
           "unit": "cm", "suggestion": 320})  # fmt: skip
    stream = events(post({}))
    assert stream == [
        ("message", {"text": "One thing first.", "action": "ask"}),
        (
            "ask",
            {"question": "This wall looks about 320 cm. Right?", "unit": "cm", "suggestion": 320},
        ),
        ("run.status", {"status": "waiting_for_user"}),
    ]


def test_reply_answers_from_the_basket(model) -> None:  # type: ignore[no-untyped-def]
    model({"action": "reply", "say": "The desk is 140 cm, so it fits your 160 cm wall."})
    stream = events(post({"basket": json.dumps([DESK.model_dump()])}))
    assert stream[0] == (
        "message",
        {"text": "The desk is 140 cm, so it fits your 160 cm wall.", "action": "reply"},
    )
    assert stream[-1] == ("done", {"total_eur": 219, "currency": "EUR"})


def test_design_uses_the_whole_conversation_and_the_confirmed_width(  # type: ignore[no-untyped-def]
    model, monkeypatch: pytest.MonkeyPatch
) -> None:
    model(
        {
            "action": "design",
            "say": "On it.",
            "wall_cm": 320,
            "brief": None,
            "remove": ["the potted plant on the right"],
        }
    )
    design = AsyncMock()
    monkeypatch.setattr(loop, "_design", design)
    history = [{"role": "user", "text": "a calm reading corner"},
               {"role": "agent", "text": "This wall looks about 320 cm. Right?"}]  # fmt: skip
    events(post({"message": "yes", "history": json.dumps(history)}))
    _, brief, budget, _, wall, _, remove = design.call_args.args
    assert brief == "a calm reading corner yes" and wall == 320 and budget == 300
    assert remove == ["the potted plant on the right"]


def test_a_broken_conversation_is_a_422() -> None:
    assert post({"history": "not json"}).status_code == 422


async def test_a_view_only_turns_pictures_roomify_made() -> None:
    state = turn(basket=[DESK], render_url="https://evil.example.com/x.jpg")
    with pytest.raises(LLMError, match="isn't one Roomify made"):
        await loop._view(b"photo", state, Decision(action="view"), lambda e: None)


def test_adding_needs_pieces() -> None:
    assert _sane(Decision(action="add"), turn(basket=[DESK])).action == "add"
    assert _sane(Decision(action="add"), turn()).action == "design"


async def test_add_keeps_the_basket_and_shops_only_the_new_piece(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.judges.basket import Basket, Pick
    from app.tools.find_products import FindResult
    from tests.test_offer import extract_listing, fixture

    desk = extract_listing(*fixture("ikea_mittzon_desk"))
    lamp = desk.model_copy(update={"id": "lamp", "title": "Floor lamp", "price_eur": 40.0})
    spec = loop.Spec(
        slot="Desk", spec=loop.ProductSpec(item=["lamp"])
    )  # same slot name as the desk
    specs = AsyncMock(return_value=("", [spec]))
    shop = AsyncMock(return_value=FindResult(candidates=[lamp], rejected=[], searched=1, note=None))
    judge = AsyncMock(
        return_value=Basket(
            text="ok", picks=[Pick(slot="Desk 2", product_id="lamp", passed=True, reason="fits")]
        )
    )
    edited = AsyncMock(return_value=True)
    monkeypatch.setattr(loop, "_reread", AsyncMock(return_value={"Desk": desk}))
    monkeypatch.setattr(loop, "_specs", specs)
    monkeypatch.setattr(loop, "_shop", shop)
    monkeypatch.setattr(loop, "judge_basket", judge)
    monkeypatch.setattr(loop, "_add_in_place", edited)
    sent: list[tuple[str, dict[str, object]]] = []
    state = turn(basket=[DESK], budget=400, render_url="https://v3.fal.media/old.jpg")
    await loop._add(
        b"photo", state, Decision(action="add", instruction="a floor lamp"), sent.append
    )
    request, left = specs.await_args.args[1], specs.await_args.args[2]
    assert "a floor lamp" in request and desk.title in request and left == 400 - desk.price_eur
    assert shop.await_count == 1  # the desk is not shopped again
    added, chosen = edited.await_args.args[1], edited.await_args.args[2]
    assert added == {"Desk 2": lamp} and chosen == {"Desk": desk, "Desk 2": lamp}
    chosen_events = [d for k, d in sent if k == "product.chosen"]
    assert [d["slot"] for d in chosen_events] == ["Desk 2"]
    assert sent[-1] == ("done", {"total_eur": desk.price_eur + 40.0, "currency": desk.currency})


async def test_an_added_piece_goes_into_the_latest_picture(monkeypatch: pytest.MonkeyPatch) -> None:
    from tests.test_offer import _check_result

    desk, lamp, edit, _, state = _swap_setup(monkeypatch, None)  # type: ignore[arg-type]
    check = _check_result(desk.id)
    check = check.model_copy(update={"products": [
        *check.products, check.products[0].model_copy(update={"product_id": lamp.id})]})  # fmt: skip
    monkeypatch.setattr(loop, "_check", AsyncMock(return_value=check))
    sent: list[tuple[str, dict[str, object]]] = []
    chosen = {"Desk": desk, "Lamp": lamp}
    assert await loop._add_in_place(state, {"Lamp": lamp}, chosen, "by the desk", [], sent.append)
    prompt, refs = edit.await_args.args
    assert refs == ["https://v3.fal.media/old.jpg", lamp.image_url]
    assert "Add only these pieces" in prompt and "by the desk" in prompt
    assert any(k == "render.ready" for k, _ in sent)


def test_dropping_needs_that_piece() -> None:
    assert _sane(Decision(action="drop", slot="Desk"), turn(basket=[DESK])).action == "drop"
    assert (
        _sane(Decision(action="drop", slot="Rug", say="ok"), turn(basket=[DESK])).action == "reply"
    )
    # something of the photo, not a piece: every piece stays, only that is taken out
    photo_thing = Decision(action="drop", slot="the plant", remove=["the plant in the corner"])
    assert _sane(photo_thing, turn(basket=[DESK])) == photo_thing.model_copy(update={"slot": None})


async def test_drop_takes_one_piece_out_and_keeps_the_rest(monkeypatch: pytest.MonkeyPatch) -> None:
    from tests.test_offer import extract_listing, fixture

    desk = extract_listing(*fixture("ikea_mittzon_desk"))
    lamp = BasketLine(slot="Lamp", url="https://www.ikea.gr/proioda/lamp/2/", title="NYMÅNE",
                      price_eur=30)  # fmt: skip
    reread = AsyncMock(return_value={"Desk": desk})
    edited = AsyncMock(return_value=True)
    monkeypatch.setattr(loop, "_reread", reread)
    monkeypatch.setattr(loop, "_drop_in_place", edited)
    sent: list[tuple[str, dict[str, object]]] = []
    state = turn(basket=[DESK, lamp], render_url="https://v3.fal.media/old.jpg")
    await loop._drop(b"photo", state, Decision(action="drop", slot="Lamp"), sent.append)
    assert reread.await_args.args[0] == [DESK]  # the lamp's page is not read again
    assert ("product.removed", {"slot": "Lamp", "url": lamp.url}) in sent
    assert edited.await_args.args[2] == {"Desk": desk}
    assert sent[-1] == ("done", {"total_eur": desk.price_eur, "currency": "EUR"})


async def test_dropping_the_last_piece_empties_the_basket(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[tuple[str, dict[str, object]]] = []
    await loop._drop(
        b"photo", turn(basket=[DESK]), Decision(action="drop", slot="Desk"), sent.append
    )
    assert ("product.removed", {"slot": "Desk", "url": DESK.url}) in sent
    assert sent[-1] == ("done", {"total_eur": 0.0, "currency": "EUR"})


def test_arranging_needs_pieces() -> None:
    assert _sane(Decision(action="arrange"), turn(basket=[DESK])).action == "arrange"
    assert _sane(Decision(action="arrange"), turn()).action == "design"


async def test_arrange_moves_the_same_pieces_and_buys_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tests.test_offer import extract_listing, fixture

    desk = extract_listing(*fixture("ikea_mittzon_desk"))
    shop, picture = AsyncMock(), AsyncMock(return_value=True)
    monkeypatch.setattr(loop, "_reread", AsyncMock(return_value={"Desk": desk}))
    monkeypatch.setattr(loop, "_shop", shop)
    monkeypatch.setattr(loop, "_picture", picture)
    sent: list[tuple[str, dict[str, object]]] = []
    decision = Decision(action="arrange", instruction="desk under the window")
    await loop._arrange(b"photo", turn(basket=[DESK]), decision, sent.append)
    shop.assert_not_awaited()
    chosen, brief = picture.await_args.args[1], picture.await_args.args[2]
    assert chosen == {"Desk": desk} and "desk under the window" in brief
    assert sent[-1] == ("done", {"total_eur": desk.price_eur, "currency": desk.currency})


def test_a_missing_piece_names_why_its_pages_failed_not_a_turned_away_name() -> None:
    from app.tools.find_products import FindResult, Rejection

    def r(reason: str, stage: str = "page") -> Rejection:
        return Rejection(url="u", shop_name="IKEA", title="t", reason=reason, stage=stage)  # type: ignore[arg-type]

    refused = "ikea.gr refused the request (HTTP 403)"
    result = FindResult(candidates=[], searched=3, note=None,
                        rejected=[r("Storage board, not wall art", "name"), r(refused), r(refused),
                                  r("€90, over the €60 budget")])  # fmt: skip
    assert loop._why_missing(result) == f"{refused} (2 of 3 pages)"


def _swap_setup(monkeypatch: pytest.MonkeyPatch, check: "loop.RenderCheck | Exception"):  # type: ignore[no-untyped-def]
    from tests.test_offer import extract_listing, fixture

    desk = extract_listing(*fixture("ikea_mittzon_desk"))
    new = desk.model_copy(update={"id": "new-desk", "title": "LINTRUP desk"})
    edit, picture = (
        AsyncMock(return_value="https://v3.fal.media/new.jpg"),
        AsyncMock(return_value=True),
    )
    monkeypatch.setattr(loop, "_fal_edit", edit)
    monkeypatch.setattr(loop, "_picture", picture)
    monkeypatch.setattr(loop, "image_data", AsyncMock(return_value=b"before"))
    effect = {"side_effect": check} if isinstance(check, Exception) else {"return_value": check}
    monkeypatch.setattr(loop, "_check", AsyncMock(**effect))
    state = turn(basket=[DESK], render_url="https://v3.fal.media/old.jpg")
    return desk, new, edit, picture, state


async def test_a_swap_edits_only_that_piece_in_the_latest_picture(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tests.test_offer import _check_result

    desk, new, edit, _, state = _swap_setup(monkeypatch, None)  # type: ignore[arg-type]
    monkeypatch.setattr(loop, "_check", AsyncMock(return_value=_check_result(new.id)))
    sent: list[tuple[str, dict[str, object]]] = []
    assert await loop._swap_in_place(state, "Desk", desk, {"Desk": new}, sent.append)
    prompt, refs = edit.await_args.args
    assert refs == ["https://v3.fal.media/old.jpg", new.image_url, desk.image_url]
    assert "Replace only the desk" in prompt and "Change nothing else" in prompt
    ready = next(d for k, d in sent if k == "render.ready")
    assert ready["image_url"] == "https://v3.fal.media/new.jpg" and ready["items"]


async def test_an_unfaithful_swap_edit_falls_back_to_redrawing_the_room(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tests.test_offer import _check_result

    desk, new, _, _, state = _swap_setup(monkeypatch, None)  # type: ignore[arg-type]
    extra = _check_result(new.id).model_copy(update={"no_extra_products": False})
    monkeypatch.setattr(loop, "_check", AsyncMock(return_value=extra))
    sent: list[tuple[str, dict[str, object]]] = []
    assert not await loop._swap_in_place(state, "Desk", desk, {"Desk": new}, sent.append)
    assert not any(k == "render.ready" for k, _ in sent)
    no_picture = turn(basket=[DESK])  # nothing to edit yet
    assert not await loop._swap_in_place(no_picture, "Desk", desk, {"Desk": new}, sent.append)


async def test_moving_a_piece_edits_the_latest_picture_instead_of_redrawing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The live failure: "put the bed vertically against the wall" redrew the whole room from
    the original photo, and the wish only reached the image model through the layout plan."""
    from tests.test_offer import _check_result

    desk, _, edit, picture, state = _swap_setup(monkeypatch, None)  # type: ignore[arg-type]
    monkeypatch.setattr(loop, "_check", AsyncMock(return_value=_check_result(desk.id)))
    monkeypatch.setattr(loop, "_reread", AsyncMock(return_value={"Desk": desk}))
    sent: list[tuple[str, dict[str, object]]] = []
    decision = Decision(action="arrange", instruction="desk under the window")
    await loop._arrange(b"photo", state, decision, sent.append)
    picture.assert_not_awaited()
    prompt, refs = edit.await_args.args
    assert refs == ["https://v3.fal.media/old.jpg", desk.image_url]
    assert "desk under the window" in prompt and "Change nothing else" in prompt
    assert any(k == "render.ready" for k, _ in sent)
