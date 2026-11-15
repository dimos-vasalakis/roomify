"""The scraper step of the agent: spec in, verified candidates and rejections out.

Search shop catalogues, read each page, and keep only products whose price and size
were read from the page and fit the spec. Every rejection carries a plain reason
for the live feed ("Width 160 cm, your space is 140 cm").
"""

import asyncio
from typing import Literal

from pydantic import BaseModel

from app.config import get_settings
from app.tools.money import money
from app.tools.read_product_page import PageRead, ProductListing, read_product_page, saved_page
from app.tools.search_products import Dropped, ProductSpec, SearchHit, more_leads, search_products
from app.tools.web_fetch import is_refusing, reads_through_service, warm_robots

MAX_PAGES = 20
# Ranked pages kept in reserve: when a shop turns us away, the next best from other shops are read.
SPARE_PAGES = 12
# Pages of one slot read at once. Hits are spread across shops, so no shop sees many.
PARALLEL_READS = 6
READ_TIMEOUT_S = 20.0
# Firecrawl itself allows 45 s for a page; cutting it at 20 s threw away most IKEA reads.
SERVICE_READ_TIMEOUT_S = 50.0
# The whole step on stage: whatever is not read by then is dropped, and the feed says so.
FIND_DEADLINE_S = 40.0
# Fewer good pages than this, and the slot gets a second round beyond the shops that failed.
ENOUGH = 2
# Good pages that end a slot's reading early: the basket judge needs a few options, not all.
ENOUGH_TO_STOP = 4
MORE_PAGES = 10
MORE_DEADLINE_S = 25.0


class Rejection(BaseModel):
    url: str
    shop_name: str
    title: str  # page title if read, else the URL's words
    reason: str
    stage: Literal["name", "page"] = "page"  # turned away by its name, or by its page


class FindResult(BaseModel):
    candidates: list[ProductListing]
    rejected: list[Rejection]
    searched: int  # pages looked at
    note: str | None


def _cm(value: float) -> str:
    return f"{value:g} cm"


def check_fit(listing: ProductListing, spec: ProductSpec) -> str | None:
    """None if it fits, else the reason in plain words."""
    if listing.currency != spec.currency.upper():
        return f"Priced in {listing.currency}, your budget is in {spec.currency.upper()}"
    if spec.max_price_eur is not None and listing.price_eur > spec.max_price_eur:
        price, limit = (
            money(listing.price_eur, spec.currency),
            money(spec.max_price_eur, spec.currency),
        )
        return f"{price}, over the {limit} budget"
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
        if limit is None or value is None:
            continue  # a size the page doesn't give is not a reason to reject: it stays unchecked
        if value > limit:
            return f"{name} {_cm(value)}, your space allows {_cm(limit)}"
    if listing.in_stock is False:
        return "Out of stock online"
    return None


async def _read_with_timeout(url: str, limiter: asyncio.Semaphore) -> PageRead:
    timeout = SERVICE_READ_TIMEOUT_S if reads_through_service(url) else READ_TIMEOUT_S
    async with limiter:
        try:
            return await asyncio.wait_for(read_product_page(url), timeout)
        except TimeoutError:
            return saved_page(url) or PageRead(
                url=url, listing=None, error="Shop page took too long to load"
            )


class _Collected:
    """What the reads of one slot have produced so far."""

    def __init__(self, want: int) -> None:
        self.want = want
        self.candidates: list[ProductListing] = []
        self.rejected: list[Rejection] = []
        self.notes: list[str] = []
        self.seen: set[tuple[object, ...]] = set()
        self.saved_copies = 0
        self.searched = 0
        self.failed_hosts: dict[str, int] = {}  # pages a shop would not give us
        self.good_hosts: set[str] = set()


def _passes(hit: SearchHit, task: "asyncio.Task[PageRead]", spec: ProductSpec) -> bool:
    if task.cancelled() or task.exception() is not None:
        return False
    return _verdict(hit, task.result(), spec)[0] is None


async def _read_round(
    hits: list[SearchHit], spec: ProductSpec, got: _Collected, deadline: float
) -> None:
    """Read these pages in parallel until the deadline and fold the verdicts in. Once enough
    pages have passed the checks, the rest are left unread: the basket judge only needs a few
    good options per piece, and waiting on slow shops cost a minute per room."""
    await warm_robots([h.url for h in hits])
    limiter = asyncio.Semaphore(PARALLEL_READS)
    tasks = [asyncio.create_task(_read_with_timeout(h.url, limiter)) for h in hits]
    of = dict(zip(tasks, hits, strict=True))
    clock = asyncio.get_running_loop()
    end = clock.time() + deadline
    pending: set[asyncio.Task[PageRead]] = set(tasks)
    passed = 0
    need = min(got.want, ENOUGH_TO_STOP) - len(got.candidates)
    while pending and passed < need:
        done, pending = await asyncio.wait(
            pending, timeout=max(0.0, end - clock.time()), return_when=asyncio.FIRST_COMPLETED
        )
        if not done:
            break  # the deadline
        passed += sum(_passes(of[t], t, spec) for t in done)
    for task in pending:
        task.cancel()
    timed_out = pending if passed < need else set()
    if timed_out:
        got.notes.append(f"Stopped after {deadline:g} s; {len(timed_out)} pages were not read")
    # Enough found: the pages still loading are simply not part of this search.
    pairs = [(h, t) for h, t in zip(hits, tasks, strict=True) if t not in pending or t in timed_out]
    reads = [(hit, task, _outcome(hit.url, task, timed_out)) for hit, task in pairs]
    for hit, _, read in reads:
        if read.listing is None:
            got.failed_hosts[hit.retailer] = got.failed_hosts.get(hit.retailer, 0) + 1
        else:
            got.good_hosts.add(hit.retailer)
        reason, title = _verdict(hit, read, spec)
        if reason:
            got.rejected.append(
                Rejection(url=hit.url, shop_name=hit.shop_name, title=title, reason=reason)
            )
            continue
        assert read.listing is not None
        listing = read.listing
        key = (listing.retailer, listing.title.casefold(), listing.price_eur,
               listing.width_cm, listing.depth_cm)  # fmt: skip
        if key in got.seen:  # the same product under two links (e.g. a colour link)
            got.rejected.append(Rejection(url=hit.url, shop_name=hit.shop_name, title=listing.title,
                                          reason="Same product as another result"))  # fmt: skip
            continue
        got.seen.add(key)
        got.saved_copies += read.from_saved_copy
        if len(got.candidates) < got.want:
            got.candidates.append(listing)
    got.searched += sum(
        task not in timed_out or read.listing is not None for _, task, read in reads
    )


def _turned_away(dropped: list[Dropped]) -> list[Rejection]:
    return [
        Rejection(
            url=d.hit.url,
            shop_name=d.hit.shop_name,
            title=d.hit.words,
            reason=d.reason,
            stage="name",
        )
        for d in dropped
    ]


async def _skip_refusing(hits: list[SearchHit], got: _Collected, limit: int) -> list[SearchHit]:
    """Shops that turn this server away right now (IKEA without the page reading service) would
    only use up reads: their pages are set aside and the next best from other shops read instead.
    When every shop refuses, nothing is set aside: then the reads say why, page by page."""
    await warm_robots([h.url for h in hits])
    refusing = {h.retailer for h in hits if is_refusing(h.url)}
    if not refusing or refusing >= {h.retailer for h in hits}:
        return hits[:limit]
    names = sorted({h.shop_name for h in hits if h.retailer in refusing})
    for hit in hits:
        if hit.retailer in refusing:
            got.failed_hosts[hit.retailer] = got.failed_hosts.get(hit.retailer, 0) + 1
    got.notes.append(f"{' and '.join(names)} turned us away, so other shops were read instead")
    return [h for h in hits if h.retailer not in refusing][:limit]


async def find_products(spec: ProductSpec, want: int = 8) -> FindResult:
    search = await search_products(spec, limit=MAX_PAGES + SPARE_PAGES)
    got = _Collected(want)
    # Names the relevance check turned away come first: they show the agent telling a
    # bulletin board from a painting before it reads a single page.
    got.rejected = _turned_away(search.dropped)
    if search.note:
        got.notes.append(search.note)
    hits = await _skip_refusing(search.hits, got, MAX_PAGES)
    if hits:
        await _read_round(hits, spec, got, FIND_DEADLINE_S)

    # Too little came back (a shop refused us, say): look beyond the shops that failed,
    # through Google Shopping and our other shops, before giving up on the slot.
    settings = get_settings()
    if len(got.candidates) < ENOUGH and (settings.serper_api_key or settings.replay):
        refused = set(got.failed_hosts) - got.good_hosts
        more = await more_leads(spec, {h.url for h in hits}, refused, MORE_PAGES + SPARE_PAGES // 2)
        got.rejected += _turned_away(more.dropped)
        if more.note:
            got.notes.append(more.note)
        more_hits = await _skip_refusing(more.hits, got, MORE_PAGES)
        if more_hits:
            await _read_round(more_hits, spec, got, MORE_DEADLINE_S)

    if not search.hits and not got.candidates and not got.searched:
        return FindResult(candidates=[], rejected=got.rejected, searched=0,
                          note="; ".join(got.notes) or "Nothing in the shops matched that description")  # fmt: skip
    if got.saved_copies:
        got.notes.append(
            f"{got.saved_copies} shop pages were slow, so earlier reads of them were used"
        )
    return FindResult(candidates=got.candidates, rejected=got.rejected, searched=got.searched,
                      note="; ".join(dict.fromkeys(got.notes)) or None)  # fmt: skip


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
