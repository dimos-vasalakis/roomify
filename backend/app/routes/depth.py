"""The depth of a finished render, so the room can be looked at from other angles."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.tools.depth import Depth, DepthError, depth_map

router = APIRouter(tags=["depth"])


class DepthIn(BaseModel):
    image_url: str = Field(max_length=2000)


@router.post("/depth")
async def depth(body: DepthIn) -> Depth:
    try:
        return await depth_map(body.image_url)
    except DepthError as exc:
        raise HTTPException(422 if "Only" in str(exc) else 502, str(exc)) from exc
