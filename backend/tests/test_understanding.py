"""What a message plainly says wins over a model's slip: more is "add", budgets are exact."""

import pytest

from app.agent import loop
from app.agent.loop import BasketLine, Decision, Turn, budget_in, budget_line, heed

CHAIR = BasketLine(slot="Chair", url="https://jysk.gr/a/b/chair", title="black office chair",
                   price_eur=149)  # fmt: skip
DESK = BasketLine(slot="Desk", url="https://jysk.gr/a/b/desk", title="white desk", price_eur=129)


def turn(message: str, **fields: object) -> Turn:
    base = {"message": message, "budget": 500, "city": "Athens", "basket": [CHAIR]}
    return Turn(**(base | fields))  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("message", "budget"),
    [
        ("raise the budget to 800", 800),
        ("set my budget to €1.200", 1200),
        ("lower my budget to 300 please", 300),
        ("I can spend 200 more", 700),
        ("I can spend €200 more, add a rug", 700),
        ("increase the budget by 150", 650),
        ("lower the budget by 100", 400),
        ("reduce my budget by €50", 450),
        ("double the budget", 1000),
        ("halve my budget", 250),
        ("my budget is 1.5k", 1500),
        ("a lamp under €50", None),  # a price limit on one piece, not the budget
        ("my budget is tight, find a lamp at 30", None),
        (
            "Make it fit my budget of €500: swap the priciest piece for a cheaper one.",
            500,
        ),  # unchanged
        ("I can spend 800 in total", 800),
        ("add a black chair next to the existing one", None),
    ],
)
def test_budgets_are_worked_out_exactly(message: str, budget: float | None) -> None:
    assert budget_in(message, 500) == budget


@pytest.mark.parametrize(
    "message",
    [
        "add a black chair next to the existing one",
        "I want a second chair like that one",
        "one more chair please",
        "a matching chair beside it",
    ],
)
def test_asking_for_more_is_never_a_swap(message: str) -> None:
    slip = Decision(action="swap", slot="Chair", instruction="black", remove=["the black chair"])
    decided = heed(slip, turn(message))
    assert decided.action == "add"
    assert decided.slot is None
    assert decided.remove == []  # the chair they want to keep is not taken out


def test_a_real_replacement_stays_a_swap() -> None:
    swap = Decision(action="swap", slot="Chair", instruction="red")
    assert heed(swap, turn("replace the chair with a different red one")).action == "swap"


def test_more_on_top_of_a_room_is_never_a_redesign() -> None:
    redo = Decision(action="design", brief="a chair")
    assert heed(redo, turn("add another chair")).action == "add"
    assert heed(redo, turn("start over with another sofa")).action == "design"


def test_the_model_budget_is_used_when_the_words_dont_spell_it() -> None:
    decided = heed(
        Decision(action="reply", say="ok", budget=650), turn("go a bit higher, 650 is fine")
    )
    assert decided.budget == 650
    same = heed(Decision(action="reply", say="ok", budget=500), turn("keep the budget"))
    assert same.budget is None  # unchanged is not a change


def test_the_budget_sentence_does_its_own_arithmetic() -> None:
    assert (
        budget_line(300, 278)
        == "Your budget is now €300. Your pieces come to €278, so €22 is left."
    )
    assert budget_line(200, 278).endswith("€278, €78 over. Want me to make it fit?")


async def run(
    t: Turn, decision: Decision, monkeypatch: pytest.MonkeyPatch
) -> list[tuple[str, dict]]:  # type: ignore[type-arg]
    async def decide(photo: bytes, turn: Turn) -> Decision:
        return decision

    monkeypatch.setattr(loop, "decide", decide)
    sent: list[tuple[str, dict]] = []  # type: ignore[type-arg]
    await loop._turn(b"photo", t, sent.append)
    return sent


async def test_a_budget_change_reaches_the_screen_with_exact_figures(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    sent = await run(turn("raise the budget to 800", basket=[CHAIR, DESK]),
                     Decision(action="reply", say="Sure!"), monkeypatch)  # fmt: skip
    assert ("budget.changed", {"budget_eur": 800}) in sent
    said = next(d["text"] for k, d in sent if k == "message")
    assert said == "Your budget is now €800. Your pieces come to €278, so €522 is left."


async def test_fit_swaps_the_priciest_piece_within_what_is_left(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    swapped: list[tuple[str, float]] = []

    async def swap(photo: bytes, t: Turn, d: Decision, send: object) -> None:
        swapped.append((d.slot or "", t.budget))

    monkeypatch.setattr(loop, "_swap", swap)
    sent = await run(turn("lower my budget to 200 and make it fit", basket=[CHAIR, DESK]),
                     Decision(action="fit", say="On it."), monkeypatch)  # fmt: skip
    assert ("budget.changed", {"budget_eur": 200}) in sent
    assert swapped == [("Chair", 200)]  # €149 chair, the €129 desk stays: under €71 needed


async def test_fit_says_plainly_when_one_swap_cant_do_it(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    sent = await run(turn("make it fit", budget=100, basket=[CHAIR, DESK]),
                     Decision(action="fit", say="Let me see."), monkeypatch)  # fmt: skip
    said = [d["text"] for k, d in sent if k == "message"]
    assert any("Even without the chair, the rest comes to €129, over €100" in s for s in said)
    assert sent[-1][0] == "done"


def test_too_expensive_is_always_a_fit() -> None:
    assert (
        heed(Decision(action="reply", say="Sorry"), turn("this is too expensive")).action == "fit"
    )
    assert heed(Decision(action="design"), turn("make it fit my budget")).action == "fit"


def test_a_new_budget_alone_never_redraws_the_room() -> None:
    assert heed(Decision(action="design"), turn("I can spend 300 more")).action == "reply"
    assert heed(Decision(action="design"), turn("budget 900, start over")).action == "design"


async def test_a_piece_button_is_carried_out_exactly(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    async def never(photo: bytes, t: Turn) -> Decision:
        raise AssertionError("a button never asks the model what it meant")

    dropped: list[str | None] = []

    async def drop(photo: bytes, t: Turn, d: Decision, send: object) -> None:
        dropped.append(d.slot)

    monkeypatch.setattr(loop, "decide", never)
    monkeypatch.setattr(loop, "_drop", drop)
    t = turn(
        "Remove the chair", basket=[CHAIR, DESK], intent=loop.Intent(action="drop", slot="Chair")
    )
    sent: list[tuple[str, dict]] = []  # type: ignore[type-arg]
    await loop._turn(b"photo", t, sent.append)
    assert dropped == ["Chair"]
    assert sent[0] == (
        "message",
        {"text": "Taking the chair out; everything else stays.", "action": "drop"},
    )


def test_a_button_for_a_piece_that_is_gone_does_nothing_harmful() -> None:
    gone = loop._pressed(
        loop.Intent(action="drop", slot="Sofa"), turn("Remove the sofa", basket=[CHAIR])
    )
    assert gone.action == "reply"
