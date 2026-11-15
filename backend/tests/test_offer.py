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


@pytest.mark.parametrize("failure", ["no-matches", "render", "unverified", "invented"])
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


def chat(stream):
    return [d["text"] for k, d in stream if k == "message"]


def test_no_retry_when_the_run_is_out_of_time(pipeline, monkeypatch):
    monkeypatch.setattr(loop, "RETRY_NEEDS_S", loop.RUN_TIMEOUT_S + 1)
    monkeypatch.setattr(
        loop, "_check", AsyncMock(return_value=_check_result(pipeline.id, scale_ok=False))
    )
    stream = events(finish())
    assert loop._render.await_count == 1
    assert any(kind == "render.ready" for kind, _ in stream)  # a size doubt alone still shows
    assert stream[-1][0] == "done"


@pytest.mark.parametrize(
    ("check", "said"),
    [
        (lambda pid: _check_result(pid, room_preserved=False), "it changed parts of your room"),
        (lambda pid: loop.RenderCheck(room_preserved=True, no_extra_products=False,
                                      products=_check_result(pid).products),
         "it added things that aren't on your shopping list"),
        (lambda pid: loop.RenderCheck(room_preserved=True, no_extra_products=True, products=[]),
         "it left out the desk"),
    ],
)  # fmt: skip
def test_an_untrue_picture_is_never_shown_and_the_chat_says_why(pipeline, monkeypatch, check, said):
    monkeypatch.setattr(loop, "_check", AsyncMock(return_value=check(pipeline.id)))
    stream = events(finish())
    assert loop._render.await_count == 3  # two corrective tries first
    assert not any(kind == "render.ready" for kind, _ in stream)
    assert any(said in text and "shopping list is exact" in text for text in chat(stream))
    assert any(kind == "product.chosen" for kind, _ in stream)  # the basket stands
    assert stream[-1][0] == "done"


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
    assert loop._render.await_count == 3
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
    assert await loop._render(b"jpeg", {"Desk": pipeline}, layout) == image["url"]
    args = fal.await_args.args[1]
    assert args["resolution"] == "2K" and args["thinking_level"] == "high"
    assert f"W {pipeline.width_cm:g} cm" in args["prompt"]
    assert "under the window" in args["prompt"] and "door 200 cm" in args["prompt"]

    image["width"], image["height"] = 1024, 1024
    with pytest.raises(LLMError):
        await loop._render(b"jpeg", {"Desk": pipeline}, None)


async def test_the_image_model_never_sees_the_persons_words(pipeline, monkeypatch):
    """A brief saying "maybe a painting" made it paint one that wasn't in the basket."""
    from app.tools.fal_client import FalResult

    monkeypatch.undo()
    image = {"url": "https://example.com/r.jpg", "width": 1536, "height": 1024}
    fal = AsyncMock(return_value=FalResult(data={"images": [image]}))
    monkeypatch.setattr(loop, "fal", fal)
    await loop._render(b"jpeg", {"Desk": pipeline}, None, remove=["the potted plant on the right"])
    prompt = fal.await_args.args[1]["prompt"]
    assert "brief" not in prompt.lower() and "Direction" not in prompt
    assert "REMOVE completely: the potted plant on the right" in prompt
    assert "Never put a new wall" in prompt


def test_a_piece_the_shops_lack_does_not_cost_the_whole_room(pipeline, monkeypatch):
    specs = [
        loop.Spec(slot="Desk", spec=ProductSpec(item=["γραφείο"])),
        loop.Spec(slot="Roller blinds", spec=ProductSpec(item=["στόρι"])),
    ]
    monkeypatch.setattr(loop, "_specs", AsyncMock(return_value=("Calm workspace", specs)))
    stream = events(finish())
    assert stream[-1][0] == "done"
    assert any(
        text.startswith("No roller blinds made it into your basket (none I found suited")
        for text in chat(stream)
    )
    assert list(loop._render.await_args.args[1]) == ["Desk"]


def test_huge_jpeg_is_shrunk_cheaply_and_huge_webp_is_refused():
    from app.tools.image_data import room_jpeg

    jpeg = BytesIO()
    Image.new("RGB", (6000, 4000)).save(jpeg, "JPEG")
    with Image.open(BytesIO(room_jpeg(jpeg.getvalue()))) as out:
        assert out.size == (1536, 1024)
    webp = BytesIO()
    Image.new("RGB", (4000, 3500)).save(webp, "WEBP", quality=1)
    with pytest.raises(ValueError):
        room_jpeg(webp.getvalue())


def test_portrait_exif_photo_still_comes_out_3_by_2():
    from app.tools.image_data import room_jpeg

    image, exif = BytesIO(), Image.Exif()
    exif[0x0112] = 6  # stored sideways: turn 90° when shown
    Image.new("RGB", (4000, 3000)).save(image, "JPEG", exif=exif)
    with Image.open(BytesIO(room_jpeg(image.getvalue()))) as out:
        assert abs(out.width / out.height - 1.5) < 0.01


async def test_plan_keeps_four_pieces_and_skips_a_broken_one(monkeypatch):
    item = {"slot": "Desk", "item": ["γραφείο"]}
    raw = {"direction": "Calm", "items": [{"slot": "Bad"}, *[item] * 4]}
    monkeypatch.setattr(loop, "llm", AsyncMock(return_value=raw))
    _, specs = await loop._specs(b"", "a desk", 300, "Athens", None)
    assert len(specs) == 3  # four kept, the one without an item skipped
    monkeypatch.setattr(loop, "llm", AsyncMock(return_value={"direction": "x", "items": []}))
    with pytest.raises(LLMError):
        await loop._specs(b"", "a desk", 300, "Athens", None)


async def test_check_that_cannot_download_is_a_readable_retryable_error(monkeypatch):
    import httpx

    product = extract_listing(*fixture("ikea_mittzon_desk"))
    monkeypatch.setattr(loop, "image_data", AsyncMock(side_effect=httpx.ConnectError("down")))
    with pytest.raises(LLMError):
        await loop._check(b"", "https://example.com/r.jpg", {"Desk": product})
    monkeypatch.setattr(loop, "image_data", AsyncMock(return_value=b""))
    monkeypatch.setattr(loop, "llm", AsyncMock(return_value={"products": "nonsense"}))
    with pytest.raises(LLMError):
        await loop._check(b"", "https://example.com/r.jpg", {"Desk": product})


def test_fit_lines_only_for_pieces_along_the_measured_wall():
    desk = extract_listing(*fixture("ikea_mittzon_desk"))
    vase = desk.model_copy(update={"id": "vase"})
    sent = []
    loop._prove_fit({"Desk": desk, "Vase": vase}, 320, {"Desk"}, sent.append)
    proofs = [data for kind, data in sent if kind == "fit.proof"]
    assert [p["product_id"] for p in proofs] == [desk.id]
    assert not any(kind == "step.started" for kind, _ in sent)  # no "side by side" with a vase
