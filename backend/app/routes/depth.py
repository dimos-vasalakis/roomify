"""The 3D room: the depth of a render or of the person's own photo, and real 3D models of the
chosen products."""

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.cache import ReplayMiss
from app.tools.depth import Depth, DepthError, depth_map
from app.tools.model3d import Model3D, Model3DError, PhotoDepth, photo_depth, product_model

router = APIRouter(tags=["depth"])
PHOTO_MAX_BYTES = 8 * 1024 * 1024


class DepthIn(BaseModel):
    image_url: str = Field(max_length=2000)


class ModelIn(BaseModel):
    image_url: str = Field(max_length=2000)


@router.post("/depth")
async def depth(body: DepthIn) -> Depth:
    try:
        return await depth_map(body.image_url)
    except DepthError as exc:
        raise HTTPException(422 if "Only" in str(exc) else 502, str(exc)) from exc


@router.post("/depth/photo")
async def depth_of_photo(photo: Annotated[UploadFile, File()]) -> PhotoDepth:
    """The empty room's depth, for the shell of the 3D room. Same photo, same answer, for good."""
    if (photo.content_type or "").split(";")[0] not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(415, "Use a JPEG, PNG or WebP photo.")
    data = await photo.read(PHOTO_MAX_BYTES + 1)
    if not data or len(data) > PHOTO_MAX_BYTES:
        raise HTTPException(413, "The photo must be under 8 MB.")
    try:
        return await photo_depth(data)
    except DepthError as exc:
        raise HTTPException(502, str(exc)) from exc
    except ReplayMiss as exc:
        raise HTTPException(503, "The 3D room isn't part of the recorded demo.") from exc


@router.post("/model3d")
async def model3d(body: ModelIn) -> Model3D:
    """A textured 3D model (GLB) of one product, from its shop photo. Made once, then instant."""
    try:
        return await product_model(body.image_url)
    except Model3DError as exc:
        status = 422 if "can't be used" in str(exc) else 429 if "this hour" in str(exc) else 502
        raise HTTPException(status, str(exc)) from exc
    except ReplayMiss as exc:
        raise HTTPException(503, "This 3D model isn't part of the recorded demo.") from exc
