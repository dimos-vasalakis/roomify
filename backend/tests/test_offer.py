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
    monkeypatch.setattr(loop, "_layout", AsyncMock(return_value=None))
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
    assert stream[-1] == ("done", {"total_eur": pipeline.price_eur, "currency": "EUR"})
    assert loop._specs.await_args.args[-1] == 160.0
    assert [data.get("phase") for kind, data in stream if kind == "step.started"] == [
        "planning",
        "shopping",
        "rendering",
        "rendering",
        "checking",
    ]
    loop._render.assert_awaited_once()


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


def _check_result(product_id, **flags):
    return loop.RenderCheck(
        room_preserved=flags.pop("room_preserved", True),
        no_extra_products=True,
        products=[
            loop.BoxCheck(
                product_id=product_id,
                note="Twice its 120 cm width",
                box_2d=[200, 100, 600, 600],
                **{"match": True, "scale_ok": True, "placement_ok": True} | flags,
            )
        ],
    )


def test_wrong_scale_is_rendered_again_with_the_reason(pipeline, monkeypatch):
    monkeypatch.setattr(
        loop,
        "_check",
        AsyncMock(
            side_effect=[
                _check_result(pipeline.id, scale_ok=False),
                _check_result(pipeline.id),
            ]
        ),
    )
    stream = events(finish())
    assert stream[-1][0] == "done"
    assert loop._render.await_count == 2
    assert loop._render.await_args.args[-1] == ["desk: Twice its 120 cm width"]
    feed = [data["text"] for kind, data in stream if kind == "step.started"]
    assert any("Twice its 120 cm width" in text for text in feed)


def test_size_doubt_on_last_try_still_shows_the_room(pipeline, monkeypatch):
    monkeypatch.setattr(
        loop, "_check", AsyncMock(return_value=_check_result(pipeline.id, scale_ok=False))
    )
    stream = events(finish())
    assert loop._render.await_count == 2
    assert stream[-1][0] == "done"


def test_no_retry_when_the_run_is_out_of_time(pipeline, monkeypatch):
    monkeypatch.setattr(loop, "RETRY_NEEDS_S", loop.RUN_TIMEOUT_S + 1)
    monkeypatch.setattr(
        loop, "_check", AsyncMock(return_value=_check_result(pipeline.id, room_preserved=False))
    )
    stream = events(finish())
    assert loop._render.await_count == 1
    # The picture still arrives, with the doubt said in plain words.
    assert any("look different" in d.get("text", "") for k, d in stream if k == "step.started")
    assert stream[-1][0] == "done"


def test_a_piece_missing_from_the_picture_still_fails(pipeline, monkeypatch):
    empty = loop.RenderCheck(room_preserved=True, no_extra_products=True, products=[])
    monkeypatch.setattr(loop, "_check", AsyncMock(return_value=empty))
    stream = events(finish())
    assert loop._render.await_count == 2
    assert stream[-1][0] == "error"
    assert not any(kind == "render.ready" for kind, _ in stream)


def test_unlabelled_bed_size_is_a_footprint_with_its_length():
    bed = extract_listing(*fixture("ikea_mittzon_desk")).model_copy(
        update={"width_cm": 90.0, "depth_cm": 200.0, "height_cm": None, "sizes_order_known": False}
    )
    assert loop._size(bed) == "footprint 200 × 90 cm (the 200 cm side is its length)"


def test_doubted_piece_on_last_try_loses_its_dot_not_the_room(pipeline, monkeypatch):
    monkeypatch.setattr(
        loop, "_check", AsyncMock(return_value=_check_result(pipeline.id, match=False))
    )
    stream = events(finish())
    assert loop._render.await_count == 2
    assert loop._render.await_args.args[-1] == ["the desk must look exactly like its shop photo"]
    assert next(data for kind, data in stream if kind == "render.ready")["items"] == []
    assert any("differs from the shop photo" in d.get("text", "") for _, d in stream)
    assert stream[-1][0] == "done"


@pytest.mark.parametrize("size", [(4000, 3000), (1080, 1920), (3000, 2000)])
def test_room_photo_is_cropped_to_the_render_geometry(size):
    from app.tools.image_data import room_jpeg

    image = BytesIO()
    Image.new("RGB", size).save(image, "JPEG")
    with Image.open(BytesIO(room_jpeg(image.getvalue()))) as out:
        assert abs(out.width / out.height - 1.5) < 0.01
        assert out.width <= 1536 and out.height <= 1024


async def test_render_asks_for_true_size_at_high_quality(pipeline, monkeypatch):
    from app.tools.fal_client import FalResult

    monkeypatch.undo()  # the real _render, not the pipeline mock
    monkeypatch.delenv("FAL_RENDER_MODEL", raising=False)
    image = {"url": "https://example.com/r.jpg", "width": 2048, "height": 1365}
    fal = AsyncMock(return_value=FalResult(data={"images": [image]}))
    monkeypatch.setattr(loop, "fal", fal)
    layout = loop.Layout(
        scale_anchors="door 200 cm on the right",
        placements=[
            loop.Placement(
                product_id=pipeline.id,
                where="under the window",
                facing="the room",
                apparent_size="half the window width",
            )
        ],
    )
    assert await loop._render(b"jpeg", {"Desk": pipeline}, "desk", "calm", layout) == image["url"]
    args = fal.await_args.args[1]
    assert args["resolution"] == "2K" and args["thinking_level"] == "high"
    assert f"W {pipeline.width_cm:g} cm" in args["prompt"]
    assert "under the window" in args["prompt"] and "door 200 cm" in args["prompt"]

    image["width"], image["height"] = 1024, 1024
    with pytest.raises(LLMError):
        await loop._render(b"jpeg", {"Desk": pipeline}, "desk", "calm", None)


def test_a_piece_the_shops_lack_does_not_cost_the_whole_room(pipeline, monkeypatch):
    specs = [
        loop.Spec(slot="Desk", spec=ProductSpec(item=["γραφείο"])),
        loop.Spec(slot="Roller blinds", spec=ProductSpec(item=["στόρι"])),
    ]
    monkeypatch.setattr(loop, "_specs", AsyncMock(return_value=("Calm workspace", specs)))
    stream = events(finish())
    assert stream[-1][0] == "done"
    assert any(
        "No suitable roller blinds" in d.get("text", "") for k, d in stream if k == "step.started"
    )
    assert list(loop._render.await_args.args[1]) == ["Desk"]
