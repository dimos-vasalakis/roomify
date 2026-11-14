import pytest

from app.tools import catalogue
from app.tools.catalogue import (
    CatalogueError,
    _entries,
    refresh_catalogues,
    saved_catalogue,
    shop_catalogue,
    slug_words,
)
from app.tools.shops import SHOPS

JYSK = next(s for s in SHOPS if s.domain == "jysk.gr")
IKEA = next(s for s in SHOPS if s.domain == "ikea.gr")


@pytest.mark.parametrize(
    ("url", "words"),
    [
        ("https://www.ikea.gr/proioda/mittzon-grafeio-140x80-cm/59528113/", "mittzon grafeio 140x80 cm"),
        ("https://jysk.gr/apothikeysi/rafia/rafia-toihoy-ilbro", "rafia toihoy ilbro"),
        ("https://www.plaisio.gr/product/karekles-epipla/karekles/-at-work-karekla-grafeiou-sitzix_5295270",
         "at work karekla grafeiou sitzix"),
        ("https://pepco.gr/products/kentito-raner-trapeziou-629670", "kentito raner trapeziou"),
        ("https://www.praktiker.gr/p/karekla-cloe-m56xp48xy76cm-mpornto-95126", "karekla cloe m56xp48xy76cm mpornto"),
    ],
)  # fmt: skip
def test_slug_words(url: str, words: str) -> None:
    assert slug_words(url) == words


def test_entries_reads_urls_and_images() -> None:
    xml = """<urlset>
      <url><loc>https://jysk.gr/a/b/product-one</loc><image:image><image:loc>x</image:loc></image:image></url>
      <url><loc><![CDATA[https://jysk.gr/a/b/category]]></loc></url>
      <url><loc>https://jysk.gr/a/b/p?x=1&amp;y=2</loc></url>
    </urlset>"""
    assert _entries(xml) == [
        ("https://jysk.gr/a/b/product-one", True),
        ("https://jysk.gr/a/b/category", False),
        ("https://jysk.gr/a/b/p?x=1&y=2", False),
    ]


async def test_builds_from_index_keeps_products_only(monkeypatch: pytest.MonkeyPatch) -> None:
    sitemaps = {
        "https://jysk.gr/sitemap.xml": """<sitemapindex>
            <sitemap><loc>https://jysk.gr/sitemap.xml?page=1</loc></sitemap>
            <sitemap><loc>https://jysk.gr/sitemap.xml?page=2</loc></sitemap></sitemapindex>""",
        "https://jysk.gr/sitemap.xml?page=1": """<urlset>
            <url><loc>https://jysk.gr/saloni/trapezia/trapezi-ringsted-leyko</loc><image:image/></url>
            <url><loc>https://jysk.gr/kipos/epipla-kipoy/trapezia-kipoy</loc></url>
            <url><loc>https://jysk.gr/inspiration/diabiosi/grafeio</loc><image:image/></url>
            <url><loc>https://jysk.gr/stores-locator/athina/marathonos</loc></url></urlset>""",
        "https://jysk.gr/sitemap.xml?page=2": "<urlset></urlset>",
    }

    async def fake_fetch(url: str) -> str:
        if url not in sitemaps:
            from app.tools.web_fetch import FetchError

            raise FetchError("jysk.gr answered with an error (HTTP 500)")
        return sitemaps[url]

    monkeypatch.setattr(catalogue, "fetch_text", fake_fetch)
    result = await shop_catalogue(JYSK)
    assert [e.url for e in result.entries] == [
        "https://jysk.gr/saloni/trapezia/trapezi-ringsted-leyko"
    ]
    assert result.entries[0].words == "trapezi ringsted leyko"
    assert result.sitemap_errors == []

    async def must_not_fetch(url: str) -> str:
        raise AssertionError("second build should come from the cache")

    monkeypatch.setattr(catalogue, "fetch_text", must_not_fetch)
    assert (await shop_catalogue(JYSK)).entries == result.entries


async def test_sitemap_loops_are_not_followed_forever(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0

    async def loop(url: str) -> str:
        nonlocal calls
        calls += 1
        return f"<sitemapindex><sitemap><loc>https://www.ikea.gr/sitemap/{calls}.xml</loc></sitemap></sitemapindex>"

    monkeypatch.setattr(catalogue, "fetch_text", loop)
    with pytest.raises(CatalogueError):
        await shop_catalogue(IKEA)
    assert calls == catalogue.MAX_SITEMAP_FILES


async def test_failed_build_is_not_saved_and_old_copy_survives(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.tools.web_fetch import FetchError

    async def down(url: str) -> str:
        raise FetchError("ikea.gr took too long to answer")

    monkeypatch.setattr(catalogue, "fetch_text", down)
    with pytest.raises(CatalogueError, match="took too long"):
        await shop_catalogue(IKEA)

    async def up(url: str) -> str:
        return (
            "<urlset><url><loc>https://www.ikea.gr/proioda/mittzon-grafeio/1/</loc></url></urlset>"
        )

    monkeypatch.setattr(catalogue, "fetch_text", up)
    good = await shop_catalogue(IKEA)  # the failure above was not cached
    assert len(good.entries) == 1

    monkeypatch.setattr(catalogue, "fetch_text", down)
    with pytest.raises(CatalogueError):
        await shop_catalogue(IKEA, max_age_s=0)  # the refresh fails and says so...
    assert saved_catalogue(IKEA) == good  # ...and searches keep the old copy


async def test_refresh_reports_failures_in_plain_words(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.tools.web_fetch import FetchError

    async def down(url: str) -> str:
        raise FetchError("refused")

    monkeypatch.setattr(catalogue, "fetch_text", down)
    results = await refresh_catalogues()
    assert all(isinstance(r, str) and "product list" in r for r in results)


async def test_a_refresh_that_lost_many_sitemaps_keeps_the_old_catalogue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.tools.web_fetch import FetchError

    index = (
        "<sitemapindex>"
        + "".join(
            f"<sitemap><loc>https://www.ikea.gr/sitemap/Products/{i}.xml</loc></sitemap>"
            for i in range(10)
        )
        + "</sitemapindex>"
    )

    def page(i: int) -> str:
        return f"<urlset><url><loc>https://www.ikea.gr/proioda/item-{i}/{i}/</loc></url></urlset>"

    async def all_up(url: str) -> str:
        return index if "index" in url else page(int(url.rsplit("/", 1)[1].split(".")[0]))

    monkeypatch.setattr(catalogue, "fetch_text", all_up)
    full = await shop_catalogue(IKEA)
    assert len(full.entries) == 10

    async def rate_limited(url: str) -> str:
        if "index" in url or url.endswith("/0.xml"):
            return await all_up(url)
        raise FetchError("ikea.gr refused the request (HTTP 429)", 429)

    monkeypatch.setattr(catalogue, "fetch_text", rate_limited)
    with pytest.raises(CatalogueError, match="Only part of IKEA's product list"):
        await shop_catalogue(IKEA, max_age_s=0)  # 9 of 11 parts failed: refused
    assert saved_catalogue(IKEA) == full


def test_changing_a_shop_rule_makes_a_new_catalogue() -> None:
    from app.cache import cache_path
    from app.tools.catalogue import _inputs

    stricter = IKEA.model_copy(update={"product_url": IKEA.product_url + "$"})
    assert cache_path("catalogue", _inputs(IKEA)) != cache_path("catalogue", _inputs(stricter))


async def test_saved_catalogue_never_downloads_and_parses_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.tools.catalogue import saved_catalogue

    assert saved_catalogue(IKEA) is None

    async def one(url: str) -> str:
        return "<urlset><url><loc>https://www.ikea.gr/proioda/a/1/</loc></url></urlset>"

    monkeypatch.setattr(catalogue, "fetch_text", one)
    await shop_catalogue(IKEA)
    first = saved_catalogue(IKEA)
    assert first is not None and saved_catalogue(IKEA) is first  # same object: parsed once


async def test_one_shop_crashing_does_not_cancel_the_others(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fetch(url: str) -> str:
        if "jysk" in url:
            raise OSError("disk full")
        return "<urlset><url><loc>https://www.ikea.gr/proioda/a/1/</loc></url></urlset>"

    monkeypatch.setattr(catalogue, "fetch_text", fetch)
    monkeypatch.setenv("RETAILERS", "ikea.gr,jysk.gr")
    from app.config import get_settings

    get_settings.cache_clear()
    results = await refresh_catalogues()
    assert [type(r).__name__ for r in results] == ["ShopCatalogue", "str"]
    assert "Could not refresh JYSK's product list" in str(results[1])
