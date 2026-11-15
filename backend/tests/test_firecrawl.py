"""Shops that refuse this server are read through Firecrawl; nothing else changes."""

import pytest

from app.config import get_settings
from app.tools import read_product_page as reader
from app.tools import web_fetch
from app.tools.firecrawl import FirecrawlError, plain_text
from app.tools.web_fetch import FetchError, Robots
from tests.test_read_product_page import fixture


@pytest.fixture
def firecrawl(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Firecrawl on, answering with the IKEA fixture page; records what it was asked."""
    monkeypatch.setenv("FIRECRAWL_API_KEY", "test-only")
    get_settings.cache_clear()
    asked: list[str] = []
    _, page = fixture("ikea_mittzon_desk")

    async def fake(url: str) -> str:
        asked.append(url)
        if url.endswith("robots.txt"):
            return "<html><body><pre>User-agent: *\nDisallow: /cart</pre></body></html>"
        return page

    monkeypatch.setattr(web_fetch, "firecrawl_html", fake)
    monkeypatch.setattr(reader, "firecrawl_enabled", lambda: True)
    return asked


def refuse(status: int):  # type: ignore[no-untyped-def]
    async def download(url: str) -> str:
        raise FetchError(f"refused (HTTP {status})", status)

    return download


async def test_a_refused_page_is_read_through_firecrawl(firecrawl, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(web_fetch, "_download", refuse(403))
    url = "https://www.ikea.com/gr/el/p/mittzon-desk-00000000/"
    page = await web_fetch.fetch_text(url)
    assert "MITTZON" in page.upper()
    assert firecrawl == [url.split("/gr/")[0] + "/robots.txt", url]  # robots asked too


async def test_robots_rules_still_apply_through_firecrawl(firecrawl, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(web_fetch, "_download", refuse(403))
    with pytest.raises(FetchError, match="does not allow"):
        await web_fetch.fetch_text("https://www.ikea.com/cart/x")


async def test_a_page_that_is_simply_gone_never_uses_firecrawl(firecrawl, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    async def robots(url: str) -> Robots:
        return Robots(text="")

    monkeypatch.setattr(web_fetch, "_robots", robots)
    monkeypatch.setattr(web_fetch, "_download", refuse(404))
    with pytest.raises(FetchError):
        await web_fetch.fetch_text("https://www.ikea.com/gr/el/p/gone/")
    assert firecrawl == []


async def test_a_bot_check_page_is_read_again_through_firecrawl(firecrawl, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    async def bot_wall(url: str) -> str:
        return "<html><body>Access Denied</body></html>"

    monkeypatch.setattr(reader, "fetch_text", bot_wall)
    read = await reader._read("https://www.ikea.com/gr/el/p/mittzon-desk-00000000/")
    assert read.listing is not None and read.error is None


async def test_a_failing_service_is_a_plain_reason(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    async def broken(url: str) -> str:
        raise FirecrawlError("The page reading service is out of credits")

    monkeypatch.setattr(web_fetch, "firecrawl_html", broken)
    with pytest.raises(FetchError, match="out of credits"):
        await web_fetch.fetch_through_service("https://www.ikea.com/gr/el/p/x/")


def test_robots_text_comes_out_of_the_browser_wrapper() -> None:
    assert plain_text("<html><body><pre>User-agent: *\nDisallow: /a&amp;b</pre></body></html>") == (
        "User-agent: *\nDisallow: /a&b"
    )
    assert plain_text("User-agent: *") == "User-agent: *"


async def test_ikea_goes_straight_through_firecrawl_without_waiting_for_a_hang(
    firecrawl, monkeypatch
) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(web_fetch, "firecrawl_enabled", lambda: True)

    async def never(url: str) -> str:
        raise AssertionError("IKEA stalls direct reads from servers; never try")

    monkeypatch.setattr(web_fetch, "_download", never)
    url = "https://www.ikea.gr/proioda/mittzon-grafeio/12345/"
    assert "MITTZON" in (await web_fetch.fetch_text(url)).upper()
    assert firecrawl == ["https://www.ikea.gr/robots.txt", url]


async def test_a_rejected_firecrawl_key_falls_back_to_reading_directly(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(web_fetch, "firecrawl_enabled", lambda: True)

    async def unauthorized(url: str) -> str:
        raise FirecrawlError("The page reading service failed (HTTP 401)")

    async def direct(url: str) -> str:
        return (
            "User-agent: *\nDisallow: /cart" if url.endswith("robots.txt") else "<html>page</html>"
        )

    monkeypatch.setattr(web_fetch, "firecrawl_html", unauthorized)
    monkeypatch.setattr(web_fetch, "_download", direct)
    assert await web_fetch.fetch_text("https://www.ikea.gr/proioda/x/1/") == "<html>page</html>"


def test_pasted_keys_lose_spaces_and_quotes(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("FIRECRAWL_API_KEY", ' "fc-abc123"\n')
    get_settings.cache_clear()
    assert get_settings().firecrawl_api_key == "fc-abc123"


async def test_ikea_robots_unreadable_still_reads_its_product_pages(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """The live failure: robots.txt failed through Firecrawl and was refused directly, which
    turned away every IKEA page for an hour ("ikea.gr is refusing requests right now")."""
    monkeypatch.setattr(web_fetch, "firecrawl_enabled", lambda: True)
    _, page = fixture("ikea_mittzon_desk")
    asked: list[str] = []

    async def service(url: str) -> str:
        asked.append(url)
        if url.endswith("robots.txt"):
            raise FirecrawlError("The page reading service did not answer")
        return page

    monkeypatch.setattr(web_fetch, "firecrawl_html", service)
    monkeypatch.setattr(web_fetch, "_download", refuse(403))
    url = "https://www.ikea.gr/proioda/mittzon-grafeio/12345/"
    assert "MITTZON" in (await web_fetch.fetch_text(url)).upper()
    assert asked[-1] == url


async def test_robots_refused_now_uses_the_rules_read_before(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import time

    monkeypatch.setattr(web_fetch, "firecrawl_enabled", lambda: False)
    rules = "User-agent: *\nDisallow: /cart"

    async def direct(url: str) -> str:
        return rules if url.endswith("robots.txt") else "<html>page</html>"

    monkeypatch.setattr(web_fetch, "_download", direct)
    url = "https://www.jysk.gr/some-product"
    await web_fetch._robots(url)
    later = time.time() + 8 * 24 * 3600  # the week is over: robots.txt is asked again, and refused
    monkeypatch.setattr(time, "time", lambda: later)
    monkeypatch.setattr(web_fetch, "_download", refuse(403))
    robots = await web_fetch._robots(url)
    assert not robots.locked and robots.text == rules
