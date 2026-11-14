import asyncio

import pytest

from app.tools import find_products as finder
from app.tools.find_products import check_fit, find_products
from app.tools.read_product_page import PageRead, ProductListing
from app.tools.search_products import ProductSpec, SearchHit, SearchResult


def listing(url: str, **fields: object) -> ProductListing:
    base: dict[str, object] = {
        "id": "x", "url": url, "retailer": "jysk.gr", "shop_name": "JYSK",
        "title": url.rsplit("/", 1)[-1], "image_url": "https://i/x.jpg",
        "image_urls": ["https://i/x.jpg"], "price_eur": 100.0, "width_cm": 120.0,
        "depth_cm": 60.0, "height_cm": 75.0, "delivery_text": None, "in_stock": True,
        "evidence": {}, "page_text": "", "sizes_order_known": True,
    }  # fmt: skip
    return ProductListing(**(base | fields))  # type: ignore[arg-type]


SPEC = ProductSpec(item=["γραφείο"], max_price_eur=150, max_width_cm=140)


@pytest.mark.parametrize(
    ("fields", "reason"),
    [
        ({}, None),
        ({"price_eur": 199.0}, "€199, over the €150 budget"),
        ({"width_cm": 160.0}, "Width 160 cm, your space allows 140 cm"),
        ({"width_cm": None}, "Width is not on the shop's page, so we can't check it fits"),
        ({"in_stock": False}, "Out of stock online"),
        ({"in_stock": None}, None),  # unknown stock is not a reason to reject
        ({"depth_cm": None}, None),  # depth has no limit in this spec
    ],
)
def test_check_fit(fields: dict[str, object], reason: str | None) -> None:
    assert check_fit(listing("https://jysk.gr/a/b/c", **fields), SPEC) == reason


RUG_SPACE = ProductSpec(item=["χαλί"], max_width_cm=240, max_depth_cm=170)


@pytest.mark.parametrize(
    ("order_known", "reason"),
    [
        (False, None),  # "160x230 cm" does not say which way round: it fits turned
        (True, "Depth 230 cm, your space allows 170 cm"),  # the page said depth 230
    ],
)
def test_unlabelled_sizes_may_be_turned(order_known: bool, reason: str | None) -> None:
    rug = listing("https://jysk.gr/a/b/rug", width_cm=160.0, depth_cm=230.0, height_cm=None,
                  sizes_order_known=order_known)  # fmt: skip
    assert check_fit(rug, RUG_SPACE) == reason


@pytest.fixture
def shop(monkeypatch: pytest.MonkeyPatch) -> dict[str, PageRead]:
    pages: dict[str, PageRead] = {}

    async def fake_search(spec: ProductSpec, limit: int) -> SearchResult:
        hits = [SearchHit(url=u, retailer="jysk.gr", shop_name="JYSK", words=u.rsplit("/", 1)[-1],
                          score=1, source="catalogue") for u in pages]  # fmt: skip
        return SearchResult(hits=hits[:limit], note=None)

    async def fake_read(url: str) -> PageRead:
        return pages[url]

    async def no_robots(urls: list[str]) -> None:
        return None

    monkeypatch.setattr(finder, "search_products", fake_search)
    monkeypatch.setattr(finder, "read_product_page", fake_read)
    monkeypatch.setattr(finder, "warm_robots", no_robots)
    return pages


def ok(url: str, **fields: object) -> PageRead:
    return PageRead(url=url, listing=listing(url, **fields), error=None)


async def test_keeps_fitting_products_and_explains_every_rejection(
    shop: dict[str, PageRead],
) -> None:
    shop["https://jysk.gr/a/b/good"] = ok("https://jysk.gr/a/b/good")
    shop["https://jysk.gr/a/b/wide"] = ok("https://jysk.gr/a/b/wide", width_cm=160.0)
    shop["https://jysk.gr/a/b/broken"] = PageRead(url="https://jysk.gr/a/b/broken", listing=None,
                                                  error="No price on the page")  # fmt: skip
    result = await find_products(SPEC)
    assert [c.url for c in result.candidates] == ["https://jysk.gr/a/b/good"]
    assert {(r.title, r.reason) for r in result.rejected} == {
        ("wide", "Width 160 cm, your space allows 140 cm"),
        ("broken", "No price on the page"),
    }
    assert result.searched == 3


async def test_same_product_twice_is_shown_once_and_said(shop: dict[str, PageRead]) -> None:
    shop["https://jysk.gr/a/b/one"] = ok("https://jysk.gr/a/b/one", title="Γραφείο KARUP")
    shop["https://jysk.gr/a/b/one-white"] = ok(
        "https://jysk.gr/a/b/one-white", title="Γραφείο KARUP"
    )
    result = await find_products(SPEC)
    assert len(result.candidates) == 1
    assert result.rejected[0].reason == "Same product as another result"


async def test_same_name_different_size_are_both_kept(shop: dict[str, PageRead]) -> None:
    shop["https://jysk.gr/a/b/120"] = ok("https://jysk.gr/a/b/120", title="MITTZON", width_cm=120.0)
    shop["https://jysk.gr/a/b/100"] = ok("https://jysk.gr/a/b/100", title="MITTZON", width_cm=100.0)
    assert len((await find_products(SPEC)).candidates) == 2


async def test_slow_page_uses_the_saved_read_and_says_so(
    shop: dict[str, PageRead], monkeypatch: pytest.MonkeyPatch
) -> None:
    url = "https://jysk.gr/a/b/slow"
    shop[url] = ok(url)

    async def slow(_url: str) -> PageRead:
        await asyncio.sleep(5)
        raise AssertionError("should have timed out")

    monkeypatch.setattr(finder, "read_product_page", slow)
    monkeypatch.setattr(finder, "READ_TIMEOUT_S", 0.05)
    monkeypatch.setattr(
        finder, "saved_page", lambda u: shop[u].model_copy(update={"from_saved_copy": True})
    )
    result = await find_products(SPEC)
    assert [c.url for c in result.candidates] == [url]
    assert result.note and "earlier reads of them were used" in result.note


async def test_stops_at_the_number_wanted(shop: dict[str, PageRead]) -> None:
    for i in range(6):
        shop[f"https://jysk.gr/a/b/{i}"] = ok(f"https://jysk.gr/a/b/{i}", title=f"Desk {i}")
    assert len((await find_products(SPEC, want=3)).candidates) == 3


async def test_slow_page_is_a_rejection_not_a_hang(
    shop: dict[str, PageRead], monkeypatch: pytest.MonkeyPatch
) -> None:
    shop["https://jysk.gr/a/b/slow"] = ok("https://jysk.gr/a/b/slow")

    async def slow(url: str) -> PageRead:
        await asyncio.sleep(5)
        raise AssertionError("should have timed out")

    monkeypatch.setattr(finder, "read_product_page", slow)
    monkeypatch.setattr(finder, "READ_TIMEOUT_S", 0.05)
    result = await find_products(SPEC)
    assert result.rejected[0].reason == "Shop page took too long to load"


async def test_nothing_found_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    async def empty(spec: ProductSpec, limit: int) -> SearchResult:
        return SearchResult(hits=[], note=None)

    monkeypatch.setattr(finder, "search_products", empty)
    result = await find_products(SPEC)
    assert (
        result.candidates == [] and result.note == "Nothing in the shops matched that description"
    )


async def test_whole_step_has_a_deadline(
    shop: dict[str, PageRead], monkeypatch: pytest.MonkeyPatch
) -> None:
    shop["https://jysk.gr/a/b/fast"] = ok("https://jysk.gr/a/b/fast")
    shop["https://jysk.gr/a/b/stuck"] = ok("https://jysk.gr/a/b/stuck")

    async def read(url: str) -> PageRead:
        if url.endswith("stuck"):
            await asyncio.sleep(5)
        return shop[url]

    monkeypatch.setattr(finder, "read_product_page", read)
    monkeypatch.setattr(finder, "FIND_DEADLINE_S", 0.1)
    result = await find_products(SPEC)
    assert [c.url for c in result.candidates] == ["https://jysk.gr/a/b/fast"]
    assert result.rejected[0].reason == "Not read: the search ran out of time"
    assert result.note and "1 pages were not read" in result.note
    assert result.searched == 1


async def test_pages_cut_by_the_deadline_use_saved_reads(
    shop: dict[str, PageRead], monkeypatch: pytest.MonkeyPatch
) -> None:
    url = "https://jysk.gr/a/b/queued"
    shop[url] = ok(url)

    async def stuck(_url: str) -> PageRead:
        await asyncio.sleep(5)
        raise AssertionError("cut by the deadline")

    monkeypatch.setattr(finder, "read_product_page", stuck)
    monkeypatch.setattr(finder, "FIND_DEADLINE_S", 0.05)
    monkeypatch.setattr(
        finder, "saved_page", lambda u: shop[u].model_copy(update={"from_saved_copy": True})
    )
    result = await find_products(SPEC)
    assert [c.url for c in result.candidates] == [url]


async def test_a_read_that_raises_does_not_fail_the_step(
    shop: dict[str, PageRead], monkeypatch: pytest.MonkeyPatch
) -> None:
    shop["https://jysk.gr/a/b/good"] = ok("https://jysk.gr/a/b/good")
    shop["https://jysk.gr/a/b/bad"] = ok("https://jysk.gr/a/b/bad")

    async def read(url: str) -> PageRead:
        if url.endswith("bad"):
            raise OSError("disk full")
        return shop[url]

    monkeypatch.setattr(finder, "read_product_page", read)
    result = await find_products(SPEC)
    assert [c.url for c in result.candidates] == ["https://jysk.gr/a/b/good"]
    assert result.rejected[0].reason == "Could not read this page"
