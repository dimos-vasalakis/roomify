"""End to end against the real shops. Slow and needs internet: pytest -m live

Uses its own cache folder, so it always reads the live sites."""

import random

import pytest

from app.tools.catalogue import ShopCatalogue, refresh_catalogues
from app.tools.find_products import find_products
from app.tools.read_product_page import read_product_page
from app.tools.search_products import ProductSpec

pytestmark = pytest.mark.live


@pytest.fixture(scope="session")
def live_cache(tmp_path_factory: pytest.TempPathFactory) -> str:
    return str(tmp_path_factory.mktemp("live-cache"))


@pytest.fixture(autouse=True)
def shared_cache(isolated_env: None, live_cache: str, monkeypatch: pytest.MonkeyPatch) -> None:
    """Catalogues take ~2 minutes to download: build them once for all live tests."""
    monkeypatch.setenv("CACHE_DIR", live_cache)
    from app.config import get_settings

    get_settings.cache_clear()


FURNITURE = ("grafeio", "karekla", "trapezi", "fotistiko", "xali", "rafi", "kathreft", "kanapes")
MIN_PRODUCTS = {"ikea.gr": 5000, "jysk.gr": 1500, "praktiker.gr": 5000, "plaisio.gr": 200,
                "pepco.gr": 1000}  # fmt: skip


async def test_every_shop_catalogue_builds_and_its_pages_read() -> None:
    random.seed(20261114)
    results = await refresh_catalogues()
    assert all(isinstance(r, ShopCatalogue) for r in results), results
    catalogues = [r for r in results if isinstance(r, ShopCatalogue)]
    assert {c.domain for c in catalogues} == set(MIN_PRODUCTS)
    for catalogue in catalogues:
        assert len(catalogue.entries) >= MIN_PRODUCTS[catalogue.domain], catalogue.domain
        pool = [e for e in catalogue.entries if any(w in e.words for w in FURNITURE)]
        sample = random.sample(pool, 4)
        reads = [await read_product_page(e.url) for e in sample]
        good = [r.listing for r in reads if r.listing]
        assert len(good) >= 3, (catalogue.domain, [r.error for r in reads])
        for listing in good:
            assert listing.price_eur > 0 and listing.image_url.startswith("https://")
            assert listing.evidence["price_eur"]


@pytest.mark.parametrize(
    "spec",
    [
        ProductSpec(item=["γραφείο"], keywords=["λευκό"], exclude=["καρέκλα"],
                    max_price_eur=200, max_width_cm=140),
        ProductSpec(item=["καρέκλα γραφείου"], keywords=["μαύρη"], max_price_eur=150),
        ProductSpec(item=["φωτιστικό"], keywords=["δαπέδου"], max_price_eur=80),
        ProductSpec(item=["χαλί"], keywords=["γκρι"], max_width_cm=200, max_price_eur=120),
    ],
    ids=["desk", "office-chair", "floor-lamp", "rug"],
)  # fmt: skip
async def test_find_products_returns_only_verified_fitting_items(spec: ProductSpec) -> None:
    result = await find_products(spec, want=5)
    assert len(result.candidates) >= 3, [r.reason for r in result.rejected]
    for c in result.candidates:
        assert spec.max_price_eur is None or c.price_eur <= spec.max_price_eur
        assert spec.max_width_cm is None or (
            c.width_cm is not None and c.width_cm <= spec.max_width_cm
        )
        assert c.in_stock is not False
    for r in result.rejected:
        assert r.reason and r.title


async def test_unknown_or_dead_pages_fail_politely() -> None:
    gone = await read_product_page("https://www.ikea.gr/proioda/den-yparxei/00000000/")
    assert gone.listing is None and gone.error
    other = await read_product_page("https://www.example.com/product/1")
    assert other.listing is None and "Not one of the shops" in (other.error or "")
