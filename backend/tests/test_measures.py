"""Lengths the person measured on their photo: a named space limits that piece, a wall sets the
wall, and the arithmetic against each is said in plain words."""

from unittest.mock import AsyncMock

from app.agent import loop
from app.judges.fit import Measure, space_for, space_proofs, wall_of
from tests.test_find_products import listing

DESK = Measure(label="Space for the desk by the window", cm=140)
WALL = Measure(label="Back wall", cm=360)


def sized(width: float):  # type: ignore[no-untyped-def]
    return listing("https://jysk.gr/desk", width_cm=width, evidence={"width_cm": "Πλάτος"})


def test_a_space_limits_only_the_piece_it_names() -> None:
    assert space_for("Desk", [DESK, WALL]) is DESK
    assert space_for("Desk chair", [DESK, WALL]) is None
    assert space_for("Desks", [DESK]) is DESK
    assert space_for("Wall shelf", [WALL]) is None  # a wall is never a piece's space
    assert wall_of([DESK, WALL, Measure(label="Side wall", cm=280)]) == 360


def test_the_sums_are_said_against_the_measured_space() -> None:
    fits, too_wide = (
        space_proofs({"Desk": sized(120)}, [DESK]),
        space_proofs({"Desk": sized(150)}, [DESK]),
    )
    assert fits[0].ok and "20 cm to spare" in fits[0].lines[0]
    assert not too_wide[0].ok and "10 cm more than the 140 cm you measured" in too_wide[0].lines[0]
    assert space_proofs({"Desk": listing("https://jysk.gr/desk", width_cm=None)}, [DESK]) == []


async def test_a_measured_space_is_a_hard_width_limit_when_shopping(monkeypatch) -> None:
    plan = {"direction": "calm", "country": "GR", "language": "el", "currency": "EUR",
            "items": [{"slot": "Desk", "item": ["γραφείο"]}, {"slot": "Chair", "item": ["καρέκλα"]}]}  # fmt: skip
    llm = AsyncMock(return_value=plan)
    monkeypatch.setattr(loop, "llm", llm)
    loop._measured.set((DESK,))
    _, specs = await loop._specs(b"photo", "a desk and chair", 400, "Athens", None)
    widths = {s.slot: s.spec.max_width_cm for s in specs}
    assert widths == {"Desk": 140, "Chair": None}
    assert "measured_by_the_person_cm" in llm.await_args.args[0]


async def test_a_measured_wall_becomes_the_wall(monkeypatch) -> None:
    seen = {}

    async def design(photo, brief, budget, city, wall, send, remove):  # type: ignore[no-untyped-def]
        seen["wall"] = wall

    monkeypatch.setattr(loop, "_design", design)
    monkeypatch.setattr(loop, "decide", AsyncMock(return_value=loop.Decision(action="design")))
    turn = loop.Turn(message="A desk", budget=300, city="Athens", measures=[WALL, DESK])
    await loop._turn(b"photo", turn, lambda _: None)
    assert seen["wall"] == 360


def test_only_a_wall_is_a_wall() -> None:
    art = Measure(label="Space for the wall art", cm=90)
    assert wall_of([art]) is None
    assert space_for("Wall art", [art, WALL]) is art
    assert wall_of([Measure(label="Left wall", cm=300), Measure(label="τοίχος", cm=410)]) == 410


def test_the_page_sends_its_measures_with_each_message(monkeypatch) -> None:
    from tests.test_turn import post

    monkeypatch.setenv("FAL_KEY", "test-only")
    got = {}

    async def run_turn(photo, turn, out):  # type: ignore[no-untyped-def]
        got["measures"] = turn.measures
        out.put_nowait(None)

    monkeypatch.setattr(loop, "run_turn", run_turn)
    sent = '[{"label": "Space for the desk", "cm": 140}]'
    assert post({"measures": sent}).status_code == 200
    assert got["measures"] == [DESK.model_copy(update={"label": "Space for the desk"})]
    assert post({"measures": '[{"label": "", "cm": 1}]'}).status_code == 422
