"""The shop's own photos of one product from every side it shows, for its 3D model.

A product page's gallery mixes whole-product shots with close-ups of the fabric, the piece in a
room, other colours and other configurations (a sofa bed folded out). A vision check keeps only
photos of the whole product alone, as the main photo shows it, and says from which side each was
taken. The 3D model is then made from up to four of them, so its back and sides are the shop's
own photos instead of a guess.
"""

import asyncio
import logging
import re
from io import BytesIO

import httpx
from PIL import Image
from pydantic import BaseModel

from app.cache import DAY, ReplayMiss, cached
from app.llm import LLMError, llm
from app.tools.read_product_page import (
    find_product_node,
    image_urls_in,
    meta_content,
    saved_page,
)
from app.tools.web_fetch import FetchError, fetch_text, is_public_url

log = logging.getLogger("roomify")
MAX_PHOTOS = 8  # looked at
MAX_VIEWS = 4  # the 3D model takes at most four
# The sides in the order they add the most to a model that starts from the front.
SIDES = ["front", "front-left", "front-right", "left", "right", "back", "back-left", "back-right"]
OPPOSITE = {
    "front": "back",
    "left": "right",
    "front-left": "back-right",
    "front-right": "back-left",
}
OPPOSITE |= {v: k for k, v in OPPOSITE.items()}


class Gallery(BaseModel):
    image_urls: list[str]


class ProductViews(BaseModel):
    image_urls: list[str]  # the main photo first; every one shows the whole product alone
    sides: list[str]  # the side each was taken from, same order


def largest(url: str) -> str:
    """The shop's biggest copy of a photo: JYSK serves 1024 px under the same id."""
    return re.sub(r"(jysk\.com/getimage/wd3\.)(small|medium)/", r"\1large/", url)


def _same_photo(a: str, b: str) -> bool:
    return largest(a).split("?")[0].lower() == largest(b).split("?")[0].lower()


async def gallery(page_url: str) -> list[str]:
    """Every photo the product page lists for this product, in the page's order."""

    async def read() -> Gallery:
        html = await fetch_text(page_url)
        node = await asyncio.to_thread(find_product_node, html, page_url)
        urls = image_urls_in(node.get("image")) if node else []
        return Gallery(image_urls=urls or image_urls_in(meta_content(html, "og:image")))

    try:
        return (await cached("gallery", {"url": page_url}, read, Gallery, DAY)).image_urls
    except (FetchError, ValueError) as exc:
        # A shop that refuses us now was read when the product was chosen: those photos.
        saved = saved_page(page_url)
        log.info("No fresh gallery for %s (%s)", page_url, type(exc).__name__)
        return saved.listing.image_urls if saved and saved.listing else []


def _small(jpeg: bytes) -> bytes:
    with Image.open(BytesIO(jpeg)) as image:
        image.thumbnail((448, 448))
        out = BytesIO()
        image.convert("RGB").save(out, "JPEG", quality=80)
        return out.getvalue()


PROMPT = """These {n} photos come from one shop's listing for "{title}". Photo 1 is the main photo.
For each photo decide if it shows the WHOLE product, alone, on a plain studio background, in the
same colour and the same set-up as photo 1. Say false for: a close-up or detail, the product in a
room or with people, cropped by the frame, another colour, another configuration (a sofa bed
opened out, a table extended, doors or drawers open), a drawing, a size chart, a logo, packaging,
or several products. For each whole photo, say which side of the product faces the camera:
front, front-left, front-right, left, right, back, back-left, back-right or top.
Return JSON: {{"photos": [{{"n": 1, "whole": true, "side": "front-left"}}, ...]}} with every photo."""


async def _judge(urls: list[str], title: str) -> list[tuple[str, str]]:
    """(url, side) for each photo of the whole product alone, in the given order."""
    from app.tools.image_data import image_data  # imports httpx clients lazily for tests

    async def load(url: str) -> bytes | None:
        try:
            return await asyncio.to_thread(_small, await image_data(url))
        except (httpx.HTTPError, ValueError, OSError, ReplayMiss):  # just not a view
            return None

    loaded = [(u, d) for u, d in zip(urls, await asyncio.gather(*map(load, urls))) if d]
    if not loaded:
        return []
    answer = await llm(
        PROMPT.format(n=len(loaded), title=title[:120]),
        images=[(d, "image/jpeg") for _, d in loaded],
        json_out=True,
        vision=True,
    )
    out = []
    for item in answer.get("photos", []) if isinstance(answer, dict) else []:
        n, side = item.get("n"), str(item.get("side") or "").lower()
        whole = item.get("whole") is True and isinstance(n, int) and 1 <= n <= len(loaded)
        if whole and side in SIDES and all(u != loaded[n - 1][0] for u, _ in out):
            out.append((loaded[n - 1][0], side))
    return out


def pick(whole: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """The front-most photo first, then the sides it doesn't show, the opposite side first."""
    if not whole:
        return []
    ranked = sorted(whole, key=lambda v: SIDES.index(v[1]))
    chosen = [ranked[0]]
    for wanted in [OPPOSITE.get(ranked[0][1], "back"), *SIDES]:
        for view in ranked:
            if (
                len(chosen) < MAX_VIEWS
                and view[1] == wanted
                and view[1] not in {s for _, s in chosen}
            ):
                chosen.append(view)
    return chosen


async def product_views(image_url: str, page_url: str | None, title: str) -> ProductViews:
    """The shop's photos to model this product from. At least the main photo, always."""
    main = largest(image_url)
    found = await gallery(page_url) if page_url and is_public_url(page_url) else []
    urls = [main]
    for url in map(largest, found):
        if (
            url.startswith("https://")
            and is_public_url(url)
            and not any(_same_photo(url, u) for u in urls)
        ):
            urls.append(url)
    if len(urls) == 1:
        return ProductViews(image_urls=[main], sides=["front"])
    try:
        chosen = pick(await _judge(urls[:MAX_PHOTOS], title))
    except LLMError as exc:
        log.info("Couldn't sort the photos of %s (%s)", page_url, exc)
        chosen = []
    if not chosen:
        return ProductViews(image_urls=[main], sides=["front"])
    return ProductViews(image_urls=[u for u, _ in chosen], sides=[s for _, s in chosen])
