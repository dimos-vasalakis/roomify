"""The Finish request must deliver a relevant basket and a checked room preview."""

import json
from io import BytesIO
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.agent import loop
from app.judges.basket import Basket, Pick
from app.llm import LLMError
from app.main import app
from app.tools.find_products import FindResult
from app.tools.read_product_page import extract_listing
from app.tools.search_products import ProductSpec
from tests.test_read_product_page import fixture


def finish(data=None):
    if data is None:
        image = BytesIO()
        Image.new("RGB", (30, 20)).save(image, "JPEG")
        data = image.getvalue()
    with TestClient(app) as client:
        return client.post(
            "/offer",
            files={"photo": ("room.jpg", data, "image/jpeg")},
            data={"brief": "A desk for work", "budget_eur": "300", "wall_cm": "160"},
        )


def events(response):
    parsed = []
    for block in response.text.split("\n\n"):
        kind, payload = None, None
        for line in block.splitlines():
            if line.startswith("event: "):
                kind = line[7:]
            if line.startswith("data: "):
                payload = json.loads(line[6:])
        if kind:
            parsed.append((kind, payload))
    return parsed


@pytest.fixture
def pipeline(monkeypatch):
    url, html = fixture("ikea_mittzon_desk")
    product = extract_listing(url, html)
    monkeypatch.setenv("FAL_KEY", "test-only")
    monkeypatch.setattr(
        loop,
        "_specs",
        AsyncMock(
            return_value=(
                "Calm workspace",
                [loop.Spec(slot="Desk", spec=ProductSpec(item=["γραφείο"]))],
            )
        ),
    )
    monkeypatch.setattr(
        loop,
        "find_products",
        AsyncMock(
            return_value=FindResult(candidates=[product], rejected=[], searched=1, note=None)
        ),
    )
    monkeypatch.setattr(
        loop,
        "judge_basket",
        AsyncMock(
            return_value=Basket(
                text="Calm workspace",
                picks=[
                    Pick(
                        slot="Desk",
                        product_id=product.id,
                        passed=True,
                        reason="A simple desk for focused work.",
                    )
                ],
            )
        ),
    )
    monkeypatch.setattr(loop, "_render", AsyncMock(return_value="https://example.com/render.jpg"))
    monkeypatch.setattr(
        loop,
        "_check",
        AsyncMock(
            return_value=loop.RenderCheck(
                room_preserved=True,
                no_extra_products=True,
                products=[
                    loop.BoxCheck(
                        product_id=product.id,
                        match=True,
                        note="Matches",
                        box_2d=[200, 100, 600, 600],
                    )
                ],
            )
        ),
    )
    return product


def test_finish_streams_basket_checked_preview_and_total(pipeline):
    response = finish()
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    stream = events(response)
    chosen = next(data for kind, data in stream if kind == "product.chosen")
    assert chosen["product"]["price_eur"] == pipeline.price_eur
    assert chosen["reason"]
    assert (
        next(data for kind, data in stream if kind == "render.ready")["items"][0]["product_id"]
        == pipeline.id
    )
    assert stream[-1] == ("done", {"total_eur": pipeline.price_eur})
    assert loop._specs.await_args.args[-1] == 160.0
    assert [data.get("phase") for kind, data in stream if kind == "step.started"] == [
        "planning",
        "shopping",
        "rendering",
        "checking",
    ]


@pytest.mark.parametrize(
    "failure", ["no-matches", "render", "wrong-room", "unverified", "invented"]
)
def test_incomplete_or_inaccurate_results_never_finish(pipeline, monkeypatch, failure):
    if failure == "no-matches":
        monkeypatch.setattr(
            loop,
            "find_products",
            AsyncMock(return_value=FindResult(candidates=[], rejected=[], searched=0, note=None)),
        )
    if failure == "render":
        monkeypatch.setattr(
            loop, "_render", AsyncMock(side_effect=LLMError("Preview unavailable. Try again."))
        )
    if failure == "wrong-room":
        monkeypatch.setattr(
            loop,
            "_check",
            AsyncMock(
                return_value=loop.RenderCheck(
                    room_preserved=False, no_extra_products=True, products=[]
                )
            ),
        )
    if failure in ("unverified", "invented"):
        monkeypatch.setattr(
            loop,
            "judge_basket",
            AsyncMock(
                return_value=Basket(
                    text="Design",
                    picks=[
                        Pick(
                            slot="Desk",
                            product_id="invented" if failure == "invented" else pipeline.id,
                            passed=failure != "unverified",
                            reason="Unusable",
                        )
                    ],
                )
            ),
        )
    stream = events(finish())
    assert stream[-1][0] == "error"
    assert not any(kind in ("done", "render.ready") for kind, _ in stream)
    if failure in ("unverified", "invented"):
        loop._render.assert_not_awaited()


def test_unknown_dot_positions_are_omitted(pipeline, monkeypatch):
    monkeypatch.setattr(
        loop,
        "_check",
        AsyncMock(
            return_value=loop.RenderCheck(
                room_preserved=True,
                no_extra_products=True,
                products=[
                    loop.BoxCheck(product_id=pipeline.id, match=True, note="Matches", box_2d=None)
                ],
            )
        ),
    )
    stream = events(finish())
    assert next(data for kind, data in stream if kind == "render.ready")["items"] == []
    assert stream[-1][0] == "done"


@pytest.mark.parametrize("data,status", [(b"", 400), (b"not an image", 415)])
def test_bad_photo_fails_before_starting_designer(monkeypatch, data, status):
    run = AsyncMock()
    monkeypatch.setattr(loop, "_run", run)
    assert finish(data).status_code == status
    run.assert_not_awaited()


@pytest.mark.parametrize(
    "field,value",
    [
        ("budget_eur", "0"),
        ("budget_eur", "-1"),
        ("budget_eur", "nan"),
        ("budget_eur", "inf"),
        ("budget_eur", "100001"),
        ("wall_cm", "0"),
        ("wall_cm", "5001"),
        ("wall_cm", "nan"),
        ("brief", "  "),
        ("city", "x" * 81),
    ],
)
def test_invalid_constraints_never_start_the_agent(monkeypatch, field, value):
    run = AsyncMock()
    monkeypatch.setattr(loop, "_run", run)
    image = BytesIO()
    Image.new("RGB", (30, 20)).save(image, "JPEG")
    data = {"brief": "A desk for work", "budget_eur": "500"}
    data[field] = value
    with TestClient(app) as client:
        response = client.post(
            "/offer", data=data, files={"photo": ("room.jpg", image.getvalue(), "image/jpeg")}
        )
    assert response.status_code == 422
    run.assert_not_awaited()


def test_replay_offer_works_without_provider_keys(pipeline, monkeypatch):
    monkeypatch.setenv("REPLAY", "1")
    monkeypatch.delenv("FAL_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    from app.config import get_settings

    get_settings.cache_clear()
    response = finish()
    assert response.status_code == 200
    assert events(response)[-1][0] == "done"
