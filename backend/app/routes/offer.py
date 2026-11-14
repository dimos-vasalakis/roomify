"""Multipart photo and brief in; a real, complete room design streamed out."""

import asyncio
import json
import re
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel

from app.agent import loop
from app.llm import llm_available
from app.tools.image_data import room_jpeg

router = APIRouter(tags=["offer"])
PHOTO_TYPES = {"image/jpeg", "image/png", "image/webp"}
PHOTO_MAX_BYTES = 8 * 1024 * 1024
KEEPALIVE_S = 10.0


def _event(seq: int, kind: str, data: dict[str, Any]) -> str:
    return f"id: {seq}\nevent: {kind}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/offer")
async def offer(
    photo: Annotated[UploadFile, File()],
    brief: Annotated[str, Form(min_length=3, max_length=2000)],
    budget_eur: Annotated[float, Form(gt=0, le=100_000, allow_inf_nan=False)],
    city: Annotated[str, Form(max_length=80)] = "Athens",
    wall_cm: Annotated[float | None, Form(gt=0, le=5000, allow_inf_nan=False)] = None,
) -> StreamingResponse:
    if photo.content_type not in PHOTO_TYPES:
        raise HTTPException(415, "Use a JPEG, PNG or WebP photo.")
    data = await photo.read(PHOTO_MAX_BYTES + 1)
    if not data:
        raise HTTPException(400, "The photo is empty. Choose a room photo.")
    if len(data) > PHOTO_MAX_BYTES:
        raise HTTPException(413, "The photo must be under 8 MB.")
    try:
        data = room_jpeg(data)
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
        raise HTTPException(
            415, "This photo couldn't be opened. Choose another JPEG, PNG or WebP."
        ) from exc
    brief = re.sub(r"\s+", " ", brief).strip()
    if len(brief) < 3:
        raise HTTPException(422, "Tell us what you want to change in the room.")
    if not llm_available():
        raise HTTPException(503, "The room designer is unavailable. Please try again shortly.")

    async def stream() -> AsyncIterator[str]:
        queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue()
        task = asyncio.create_task(
            loop._run(data, "image/jpeg", brief, budget_eur, city, wall_cm, queue)
        )
        seq = 0
        try:
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), KEEPALIVE_S)
                except TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                if item is None:
                    break
                seq += 1
                yield _event(seq, *item)
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class SwapIn(BaseModel):
    slot: str
    title: str
    price_eur: float
    instruction: str
    product_id: str
    budget_left_eur: float = 0
    wall_cm: float | None = None


@router.post("/offer/swap", deprecated=True)
async def swap(body: SwapIn) -> None:
    # Old open tabs must not silently change a basket while keeping the old picture.
    raise HTTPException(
        409,
        "Refresh the page and choose Adjust the brief to update the room and shopping list together.",
    )
