"""Read and normalize images for vision, with bounded downloads and replay cache."""

import base64
from io import BytesIO

import httpx
from PIL import Image
from pydantic import BaseModel

from app.cache import cached


class ImageData(BaseModel):
    jpeg: str


def jpeg_image(data: bytes) -> bytes:
    with Image.open(BytesIO(data)) as image:
        image.thumbnail((1280, 1024))
        out = BytesIO()
        image.convert("RGB").save(out, "JPEG", quality=85)
        return out.getvalue()


async def image_data(url: str) -> bytes:
    async def call() -> ImageData:
        async with (
            httpx.AsyncClient(timeout=15, follow_redirects=True) as client,
            client.stream("GET", url) as response,
        ):
            response.raise_for_status()
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > 10 * 1024 * 1024:
                    raise ValueError("Image is too large")
        return ImageData(jpeg=base64.b64encode(jpeg_image(bytes(data))).decode())

    return base64.b64decode((await cached("images", {"url": url}, call, ImageData)).jpeg)
