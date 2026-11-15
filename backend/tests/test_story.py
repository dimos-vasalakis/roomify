"""Stories: the person says who the room is for, and the agent decides what to change."""

from unittest.mock import AsyncMock

import httpx
import pytest

from app.agent import loop
from app.agent.loop import Decision, Turn
from app.judges import oumi, story
from app.llm import LLMError
from app.tools import analyse_room as assess
from app.tools import brand as brand_tool

ASSESSMENT = {
    "who": "An 82-year-old who walks with a cane.",
    "findings": [
        {"thing": "the loose green rug", "verdict": "remove", "why": "Easy to trip on.",
         "box_2d": [800, 0, 1000, 1000]},
        {"thing": "the narrow side table", "verdict": "replace", "why": "It tips if leaned on.",
         "box_2d": [600, 100, 900, 50]},  # broken box: no dot
        {"thing": "the beige sofa", "verdict": "keep", "why": "Firm, with armrests."},
    ],
    "buy": [{"slot": "Side table", "why": "A stable surface for a lamp", "needs": "55-60 cm high"}],
    "brief": "A heavy side table, 55-60 cm high, beside the sofa.",
    "advice": ["Tie the lamp cable along the wall."],
}  # fmt: skip


async def test_the_room_is_read_with_the_strong_model(monkeypatch: pytest.MonkeyPatch) -> None:
    call = AsyncMock(return_value=ASSESSMENT)
    monkeypatch.setattr(assess, "llm", call)
    site = brand_tool.Brand(company="Coffee Island", url="https://coffeeisland.gr/", title="t",
                            description="", colours=["#ffd100"], text="")  # fmt: skip
    found = await assess.analyse_room(b"photo", "for my mother", 600, "Athens", site)
    assert call.await_args.kwargs["deep"] is True
    assert "#ffd100" in call.await_args.args[0]  # the website reaches the designer as data
    assert found.remove == ["the loose green rug", "the narrow side table"]
    assert found.brand_url == "https://coffeeisland.gr/"
    event = found.event()
    assert event["findings"][0]["box"] == {"x": 0.0, "y": 0.8, "w": 1.0, "h": 0.2}
    assert event["findings"][1]["box"] is None
    text = found.summary()
    assert text.index("Take out: the loose green rug") < text.index("Keep: the beige sofa")
    assert "Also: Tie the lamp cable" in text


async def test_an_unreadable_assessment_is_said_plainly(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(assess, "llm", AsyncMock(return_value={"who": "x"}))
    with pytest.raises(LLMError, match="who it's for"):
        await assess.analyse_room(b"photo", "for my mother", 600, "Athens")


def test_a_brand_is_read_from_its_own_page() -> None:
    page = """<html><head><title>Coffee Island | Specialty</title>
    <meta name="description" content="Specialty coffee since 1999">
    <meta name="theme-color" content="#633025"><style>.a{color:#FFD100}.b{color:#ffd100}
    .c{color:#007bff}.d{color:#eeeeee}</style><script>var x="#ff0000"</script></head>
    <body><h1>Our coffee</h1></body></html>"""
    found = brand_tool.brand_from_page("Coffee Island", "https://coffeeisland.gr/", page)
    assert found.title == "Coffee Island | Specialty"
    assert found.description == "Specialty coffee since 1999"
    # theme colour first; stock Bootstrap blue and greys are not the brand's
    assert found.colours[:2] == ["#633025", "#ffd100"] and "#007bff" not in found.colours
    assert "Our coffee" in found.text and "var x" not in found.text


def test_only_the_company_own_site_counts() -> None:
    results = [("https://en.wikipedia.org/wiki/Coffee_Island", ""),
               ("https://www.coffeeisland.gr/about", "")]  # fmt: skip
    assert brand_tool._own_site("Coffee Island", results) == "https://www.coffeeisland.gr/about"
    assert brand_tool._own_site("Coffee Island", results[:1]) is None


async def test_a_named_site_needs_no_search(monkeypatch: pytest.MonkeyPatch) -> None:
    search = AsyncMock(side_effect=AssertionError("no search for a named site"))
    monkeypatch.setattr(brand_tool, "web_results", search)
    monkeypatch.setattr(brand_tool, "fetch_text", AsyncMock(return_value="<title>Acme</title>"))
    found = await brand_tool.read_brand("Acme", "www.acme.gr")
    assert found is not None and found.url == "https://acme.gr/" and found.title == "Acme"


async def test_judges_use_oumi_when_it_is_set_up(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OUMI_API_KEY", "test-only")
    monkeypatch.setenv("OUMI_JUDGE_MODEL", "projects/p/deployments/d")
    sent: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        body = {"choices": [{"message": {"content": '```json\n{"verdict": "ok"}\n```'}}]}
        return httpx.Response(200, json=body)

    real = httpx.AsyncClient
    monkeypatch.setattr(oumi.httpx, "AsyncClient",
                        lambda **kw: real(transport=httpx.MockTransport(answer), **kw))  # fmt: skip
    assert await oumi.judge("Judge this") == ({"verdict": "ok"}, "oumi")
    assert sent[0].headers["X-API-Key"] == "test-only"
    assert b"projects/p/deployments/d" in sent[0].content


async def test_judges_fall_back_to_the_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OUMI_API_KEY", raising=False)
    monkeypatch.setattr(oumi, "llm", AsyncMock(return_value={"verdict": "ok"}))
    assert await oumi.judge("Judge this") == ({"verdict": "ok"}, "llm")
    # a configured Oumi that fails never stops the run either
    monkeypatch.setenv("OUMI_API_KEY", "test-only")
    monkeypatch.setenv("OUMI_JUDGE_MODEL", "projects/p/deployments/d")
    monkeypatch.setattr(oumi, "_ask", AsyncMock(side_effect=LLMError("down")))
    assert await oumi.judge("Judge this") == ({"verdict": "ok"}, "llm")


async def test_the_story_judge_never_stops_a_run(monkeypatch: pytest.MonkeyPatch) -> None:
    found = assess.Assessment.model_validate(ASSESSMENT)
    monkeypatch.setattr(story, "judge", AsyncMock(side_effect=LLMError("down")))
    assert await story.judge_story(found, {}, []) is None


async def test_a_story_reads_the_room_then_designs_for_it(monkeypatch: pytest.MonkeyPatch) -> None:
    found = assess.Assessment.model_validate(ASSESSMENT)
    monkeypatch.setattr(loop, "analyse_room", AsyncMock(return_value=found))
    site = AsyncMock(return_value=None)
    monkeypatch.setattr(loop, "read_brand", site)
    design = AsyncMock()
    monkeypatch.setattr(loop, "_design", design)
    sent: list[tuple[str, dict[str, object]]] = []
    state = Turn(message="make it safer for my mother", budget=600, city="Athens")
    decision = Decision(action="design", story=True, company="Acme", remove=["the clock"])
    await loop._story(b"photo", state, decision, None, sent.append)
    site.assert_awaited_once_with("Acme", None)
    kinds = [k for k, _ in sent]
    assert kinds.index("assessment.ready") < kinds.index("message")
    brief, remove = design.await_args.args[1], design.await_args.args[6]
    assert brief == found.brief
    assert remove == ["the loose green rug", "the narrow side table"]  # not the router's guess
    assert design.await_args.kwargs["story"] is found


async def test_a_story_turn_goes_to_the_story(monkeypatch: pytest.MonkeyPatch) -> None:
    decision = Decision(action="design", story=True, say="Let me look.")
    monkeypatch.setattr(loop, "decide", AsyncMock(return_value=decision))
    run = AsyncMock()
    monkeypatch.setattr(loop, "_story", run)
    monkeypatch.setattr(loop, "_design", AsyncMock(side_effect=AssertionError("not a list")))
    state = Turn(message="this is our café, furnish it", budget=900, city="Athens")
    await loop._turn(b"photo", state, lambda _: None)
    run.assert_awaited_once()


async def test_the_basket_is_checked_against_the_needs(monkeypatch: pytest.MonkeyPatch) -> None:
    found = assess.Assessment.model_validate(ASSESSMENT)
    verdict = story.StoryVerdict(
        verdict="The rug goes and the new table is sturdy.", risks=["glass top"],
        unclear=["seat height not listed"], judged_by="oumi",
    )  # fmt: skip
    monkeypatch.setattr(loop, "judge_story", AsyncMock(return_value=verdict))
    sent: list[tuple[str, dict[str, object]]] = []
    await loop._story_check(found, {}, ["the loose green rug"], sent.append)
    assert ("story.checked", verdict.model_dump()) in sent
    said = next(str(d["text"]) for k, d in sent if k == "message")
    assert "Watch out: glass top." in said and "seat height not listed" in said


def test_a_judge_answering_in_objects_is_still_read() -> None:
    verdict = story.StoryVerdict.model_validate(
        {"covered": [{"need": "n", "by": "b"}] * 12,
         "unclear": [{"need": "seat height", "by": "Sofa"}, "colour"], "risks": [{"risk": "glass top"}]}
    )  # fmt: skip
    assert verdict.unclear == ["seat height", "colour"] and verdict.risks == ["glass top"]
    assert len(verdict.covered) == 10


def test_a_need_is_never_both_covered_and_in_doubt() -> None:
    verdict = story.StoryVerdict.model_validate(
        {"covered": [{"need": "A lamp she can reach", "by": "the lamp"}],
         "unclear": ["a lamp she can reach"], "risks": ["H 50 cm", "glass top on the table"]}
    )  # fmt: skip
    assert verdict.covered == [] and verdict.risks == ["glass top on the table"]
