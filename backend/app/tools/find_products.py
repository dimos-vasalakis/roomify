"""The scraper step of the agent: spec in, verified candidates and rejections out.

Search shop catalogues, read each page, and keep only products whose price and size
were read from the page and fit the spec. Every rejection carries a plain reason
for the live feed ("Width 160 cm, your space is 140 cm").
"""

import asyncio

from pydantic import BaseModel

from app.tools.read_product_page import PageRead, ProductListing, read_product_page, saved_page
from app.tools.search_products import ProductSpec, SearchHit, search_products

MAX_PAGES = 20
PARALLEL_READS = 4
READ_TIMEOUT_S = 20.0
# The whole step on stage: whatever is not read by then is dropped, and the feed says so.
FIND_DEADLINE_S = 40.0


class Rejection(BaseModel):
    url: str
    shop_name: str
    title: str  # page title if read, else the URL's words
    reason: str


class FindResult(BaseModel):
    candidates: list[ProductListing]
    rejected: list[Rejection]
    searched: int  # pages looked at
    note: str | None


def _cm(value: float) -> str:
    return f"{value:g} cm"


def check_fit(listing: ProductListing, spec: ProductSpec) -> str | None:
    """None if it fits, else the reason in plain words."""
    if spec.max_price_eur is not None and listing.price_eur > spec.max_price_eur:
        return f"€{listing.price_eur:g}, over the €{spec.max_price_eur:g} budget"
    width, depth = listing.width_cm, listing.depth_cm
    if (
        not listing.sizes_order_known
        and width is not None and depth is not None
        and spec.max_width_cm is not None and spec.max_depth_cm is not None
        and depth <= spec.max_width_cm and width <= spec.max_depth_cm
    ):  # fmt: skip
        width, depth = depth, width  # "160x230 cm" does not say which way round: turn it
    limits = (
        ("Width", width, spec.max_width_cm),
        ("Depth", depth, spec.max_depth_cm),
        ("Height", listing.height_cm, spec.max_height_cm),
    )
    for name, value, limit in limits:
        if limit is None:
            continue
        if value is None:
            return f"{name} is not on the shop's page, so we can't check it fits"
        if value > limit:
            return f"{name} {_cm(value)}, your space allows {_cm(limit)}"
    if listing.in_stock is False:
        return "Out of stock online"
    return None


async def _read_with_timeout(url: str, limiter: asyncio.Semaphore) -> PageRead:
    async with limiter:
        try:
            return await asyncio.wait_for(read_product_page(url), READ_TIMEOUT_S)
        except TimeoutError:
            return saved_page(url) or PageRead(
                url=url, listing=None, error="Shop page took too long to load"
            )


async def find_products(spec: ProductSpec, want: int = 8) -> FindResult:
    search = await search_products(spec, limit=MAX_PAGES)
    if not search.hits:
        return FindResult(candidates=[], rejected=[], searched=0,
                          note=search.note or "Nothing in the shops matched that description")  # fmt: skip

    limiter = asyncio.Semaphore(PARALLEL_READS)
    tasks = [asyncio.create_task(_read_with_timeout(h.url, limiter)) for h in search.hits]
    _, late = await asyncio.wait(tasks, timeout=FIND_DEADLINE_S)
    for task in late:
        task.cancel()
    reads = [_outcome(hit.url, task, late) for hit, task in zip(search.hits, tasks, strict=True)]
    notes = [search.note] if search.note else []
    if late:
        notes.append(f"Stopped after {FIND_DEADLINE_S:g} s; {len(late)} pages were not read")

    candidates: list[ProductListing] = []
    rejected: list[Rejection] = []
    seen: set[tuple[object, ...]] = set()
    saved_copies = 0
    for hit, read in zip(search.hits, reads, strict=True):
        reason, title = _verdict(hit, read, spec)
        if reason:
            rejected.append(
                Rejection(url=hit.url, shop_name=hit.shop_name, title=title, reason=reason)
            )
            continue
        assert read.listing is not None
        listing = read.listing
        key = (listing.retailer, listing.title.casefold(), listing.price_eur,
               listing.width_cm, listing.depth_cm)  # fmt: skip
        if key in seen:  # the same product under two links (e.g. a colour link)
            rejected.append(Rejection(url=hit.url, shop_name=hit.shop_name, title=listing.title,
                                      reason="Same product as another result"))  # fmt: skip
            continue
        seen.add(key)
        saved_copies += read.from_saved_copy
        if len(candidates) < want:
            candidates.append(listing)
    if saved_copies:
        notes.append(f"{saved_copies} shop pages were slow, so earlier reads of them were used")
    searched = sum(r.error != "Not read: the search ran out of time" for r in reads)
    return FindResult(candidates=candidates, rejected=rejected, searched=searched,
                      note="; ".join(notes) or None)  # fmt: skip


def _outcome(
    url: str, task: "asyncio.Task[PageRead]", late: set["asyncio.Task[PageRead]"]
) -> PageRead:
    if task in late:
        return saved_page(url) or PageRead(
            url=url, listing=None, error="Not read: the search ran out of time"
        )
    if task.exception() is not None:
        return PageRead(url=url, listing=None, error="Could not read this page")
    return task.result()


def _verdict(hit: SearchHit, read: PageRead, spec: ProductSpec) -> tuple[str | None, str]:
    if read.listing is None:
        return read.error or "Could not read the page", hit.words
    return check_fit(read.listing, spec), read.listing.title
