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
