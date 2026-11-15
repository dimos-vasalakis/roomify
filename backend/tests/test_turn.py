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
