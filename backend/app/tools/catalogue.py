"""Each shop's product list, built from its public sitemaps and cached for a week.

Run `python -m app.tools.catalogue` once to download all of them ahead of a demo.
A seed of every shop's product links ships in `seeds/` (about 0.5 MB): a fresh server
(Render wipes its disk on every deploy and wake-up) searches it at once instead of
waiting a minute or more for sitemaps. `python -m app.tools.catalogue --seed` refreshes it.
"""

import asyncio
import functools
import gzip
import logging
import re
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

from pydantic import BaseModel

from app.cache import WEEK, cache_path, cached, load_saved
from app.tools.greeklish import Word, index_words
from app.tools.shops import Shop, enabled_shops, is_product_url
from app.tools.web_fetch import FetchError, fetch_text

log = logging.getLogger("roomify")
MAX_SITEMAP_FILES = 200  # largest shop today: 15
# A refresh that lost more than this share of sitemap files is refused, so a
# rate-limited run cannot replace a full catalogue with a sliver of one.
MAX_FAILED_SHARE = 0.1
SEED_DIR = Path(__file__).with_name("seeds")
LOC = re.compile(r"<loc>\s*(?:<!\[CDATA\[)?\s*([^<\s\]]+)", re.IGNORECASE)


class CatalogueError(Exception):
    """Plain words for the live feed."""


class CatalogueEntry(BaseModel):
    url: str
    words: str  # slug words, e.g. "mittzon grafeio 140x80 cm"
    keys: list[Word]  # the same words as search keys, computed once when the catalogue is built


class ShopCatalogue(BaseModel):
    domain: str
    entries: list[CatalogueEntry]
    sitemap_errors: list[str]


def slug_words(url: str) -> str:
    path = unquote(urlsplit(url).path).lower()
    segments = [s for s in path.split("/") if s and not s.isdigit()]
    last = segments[-1] if segments else ""
    last = re.sub(r"\.(html?|aspx)$", "", last)
    last = re.sub(r"[-_]p?\d{5,}$|_\d{5,}$", "", last)  # trailing product ids
    return " ".join(w for w in re.split(r"[-_+\s]+", last) if w)


def _entries(text: str) -> list[tuple[str, bool]]:
    """(url, has <image:image>) for each entry of a sitemap or sitemap index."""
    blocks = re.findall(
        r"<(?:url|sitemap)>(.*?)</(?:url|sitemap)>", text, re.DOTALL | re.IGNORECASE
    )
    if not blocks:  # some shops list bare <loc> tags
        blocks = [f"<loc>{loc}</loc>" for loc in LOC.findall(text)]
    entries = []
    for block in blocks:
        match = LOC.search(block)
        if match:
            entries.append((match.group(1).replace("&amp;", "&"), "<image:image" in block))
    return entries


def _entry(url: str) -> CatalogueEntry:
    words = slug_words(url)
    return CatalogueEntry(url=url, words=words, keys=index_words(words))


def _is_sitemap(url: str) -> bool:
    return bool(re.search(r"\.xml($|\?)|sitemap", url, re.IGNORECASE))


async def _build(shop: Shop) -> ShopCatalogue:
    queue, seen, errors = list(shop.sitemaps), set[str](), []
    products: dict[str, CatalogueEntry] = {}
    while queue and len(seen) < MAX_SITEMAP_FILES:
        sitemap = queue.pop(0)
        if sitemap in seen:
            continue
        seen.add(sitemap)
        try:
            text = await fetch_text(sitemap)
        except FetchError as exc:
            errors.append(f"{sitemap}: {exc}")
            continue
        for loc, has_image in _entries(text):
            if is_product_url(shop, loc) and (has_image or not shop.sitemap_image_required):
                products.setdefault(loc, _entry(loc))
            elif (
                _is_sitemap(loc)
                and loc not in seen
                and (not shop.sitemap_filter or re.search(shop.sitemap_filter, loc))
            ):
                queue.append(loc)
    if queue:
        raise CatalogueError(
            f"{shop.name} lists more than {MAX_SITEMAP_FILES} sitemap files; "
            "only part of its products could be read"
        )
    if not products:  # never save an empty catalogue: it would hide the shop for a week
        detail = f" ({errors[0]})" if errors else ""
        raise CatalogueError(f"Could not get {shop.name}'s product list{detail}")
    if len(errors) > MAX_FAILED_SHARE * len(seen):
        raise CatalogueError(
            f"Only part of {shop.name}'s product list came through "
            f"({len(errors)} of {len(seen)} parts failed, e.g. {errors[0]})"
        )
    return ShopCatalogue(domain=shop.domain, entries=list(products.values()), sitemap_errors=errors)


def _inputs(shop: Shop) -> dict[str, Any]:
    """The whole shop entry: changing its sitemaps or URL rules makes a new catalogue."""
    return {"shop": shop.model_dump()}


async def shop_catalogue(shop: Shop, max_age_s: float | None = None) -> ShopCatalogue:
    """Download (or reuse) the catalogue. With max_age_s, an older copy is rebuilt. A failed
    rebuild raises CatalogueError and never touches the saved copy, which searches keep using."""
    return await cached(
        "catalogue", _inputs(shop), lambda: _build(shop), ShopCatalogue, max_age_s=max_age_s
    )


def saved_catalogue(shop: Shop) -> ShopCatalogue | None:
    """The saved catalogue, never downloading: searches must not wait for sitemaps."""
    return load_saved(cache_path("catalogue", _inputs(shop)), ShopCatalogue)


def seed_catalogue(shop: Shop) -> ShopCatalogue | None:
    """The product links shipped with the code, for when nothing is downloaded yet."""
    return _seed(shop.domain, shop.product_url)


@functools.cache  # read once per process: the seed never changes while running
def _seed(domain: str, product_url: str) -> ShopCatalogue | None:
    path = SEED_DIR / f"{domain}.txt.gz"
    if not path.exists():
        return None
    urls = gzip.decompress(path.read_bytes()).decode().split()
    entries = [_entry(u) for u in urls if re.search(product_url, u)]
    return ShopCatalogue(domain=domain, entries=entries, sitemap_errors=[]) if entries else None


def write_seed(catalogue: ShopCatalogue) -> Path:
    SEED_DIR.mkdir(exist_ok=True)
    path = SEED_DIR / f"{catalogue.domain}.txt.gz"
    links = "\n".join(sorted(e.url for e in catalogue.entries))
    path.write_bytes(gzip.compress(links.encode(), 9, mtime=0))
    return path


async def refresh_catalogues(max_age_s: float = WEEK) -> list[ShopCatalogue | str]:
    """Download catalogues older than max_age_s. Errors come back as plain words."""

    async def one(shop: Shop) -> ShopCatalogue | str:
        try:
            return await shop_catalogue(shop, max_age_s)
        except CatalogueError as exc:
            return str(exc)
        except Exception:  # one shop's surprise must not cancel the other downloads
            log.exception("Refreshing %s failed", shop.name)
            return f"Could not refresh {shop.name}'s product list (unexpected error, see the log)"

    # One shop at a time: all at once took 250 MB beside live runs on a 512 MB server, and a
    # run killed with the server ended in "the connection ended before the agent finished".
    return [await one(s) for s in enabled_shops()]


if __name__ == "__main__":
    # python -m app.tools.catalogue          refresh copies older than a week
    # python -m app.tools.catalogue --force  download everything again
    # python -m app.tools.catalogue --seed   also write the seed shipped with the code
    import sys

    async def _main() -> None:
        max_age = 0.0 if "--force" in sys.argv else WEEK
        for result in await refresh_catalogues(max_age):
            if isinstance(result, str):
                print(f"FAILED  {result}")
                continue
            errors = len(result.sitemap_errors)
            note = f"  ({errors} sitemap errors)" if errors else ""
            if "--seed" in sys.argv:
                note += f"  -> {write_seed(result).name}"
            print(f"{result.domain:16} {len(result.entries):6} products{note}")

    asyncio.run(_main())
