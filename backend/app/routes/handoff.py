"""A photo from the phone to the laptop: the laptop opens a drop box and shows its code as a QR
code, the phone posts the photo into it, the laptop picks each photo up once. Kept in memory for a few
minutes only; the code is the only key, so it is long and random."""

import secrets
import time
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Response, UploadFile
from pydantic import BaseModel

router = APIRouter(prefix="/handoff", tags=["handoff"])
TTL_S = 15 * 60
MAX_BOXES = 200
PHOTO_MAX_BYTES = 12 * 1024 * 1024
PHOTO_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}


class Box(BaseModel):
    created: float
    photo: bytes | None = None
    content_type: str = "image/jpeg"


class HandoffOut(BaseModel):
    code: str
    expires_in_s: int


# The run store's sibling: one server instance, lost on restart, which only means a new QR code.
_boxes: dict[str, Box] = {}


def _sweep() -> None:
    now = time.monotonic()
    for code in [c for c, box in _boxes.items() if now - box.created > TTL_S]:
        del _boxes[code]


def _box(code: str) -> Box:
    _sweep()
    box = _boxes.get(code)
    if box is None:
        raise HTTPException(404, "This code has expired. Scan the new QR code on the laptop.")
    return box


@router.post("")
async def open_box() -> HandoffOut:
    _sweep()
    if len(_boxes) >= MAX_BOXES:  # oldest first: a busy demo never locks everyone out
        del _boxes[min(_boxes, key=lambda c: _boxes[c].created)]
    code = secrets.token_urlsafe(12)
    _boxes[code] = Box(created=time.monotonic())
    return HandoffOut(code=code, expires_in_s=TTL_S)


@router.post("/{code}/photo", status_code=204)
async def drop_photo(code: str, photo: Annotated[UploadFile, File()]) -> Response:
    box = _box(code)
    kind = (photo.content_type or "").split(";")[0].strip().lower()
    if kind not in PHOTO_TYPES:
        raise HTTPException(415, "Use a JPEG, PNG, WebP or HEIC photo.")
    data = await photo.read(PHOTO_MAX_BYTES + 1)
    if not data:
        raise HTTPException(400, "The photo is empty. Take it again.")
    if len(data) > PHOTO_MAX_BYTES:
        raise HTTPException(413, "The photo must be under 12 MB.")
    box.photo, box.content_type = data, kind
    return Response(status_code=204)


@router.get("/{code}")
async def pick_up(code: str) -> Response:
    """204 while the phone hasn't sent anything new; each photo once. The box stays open until
    it expires, so "take a different photo" on the phone replaces the first one."""
    box = _box(code)
    if box.photo is None:
        return Response(status_code=204, headers={"Cache-Control": "no-store"})
    photo, box.photo = box.photo, None
    return Response(photo, media_type=box.content_type, headers={"Cache-Control": "no-store"})
