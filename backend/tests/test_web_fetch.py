import httpx
import pytest

from app.tools.web_fetch import FetchError, fetch_text
from tests.helpers import mock_http

PAGE = "https://www.ikea.gr/proioda/x/1/"


def site(robots: str = "", page: httpx.Response | None = None):  # type: ignore[no-untyped-def]
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text=robots)
        return page or httpx.Response(200, text="<html>ok</html>")

    return handler


async def test_reads_an_allowed_page(monkeypatch: pytest.MonkeyPatch) -> None:
    requests = mock_http(monkeypatch, site("User-agent: *\nDisallow: /account/"))
    assert await fetch_text(PAGE) == "<html>ok</html>"
    assert requests[-1].headers["Accept-Language"].startswith("el-GR")


async def test_robots_disallow_is_respected(monkeypatch: pytest.MonkeyPatch) -> None:
    requests = mock_http(monkeypatch, site("User-agent: *\nDisallow: /proioda/"))
    with pytest.raises(FetchError, match="does not allow reading"):
        await fetch_text(PAGE)
    assert [r.url.path for r in requests] == ["/robots.txt"]


async def test_robots_rules_for_other_bots_do_not_apply(monkeypatch: pytest.MonkeyPatch) -> None:
    mock_http(monkeypatch, site("User-agent: Baiduspider\nDisallow: /"))
    assert await fetch_text(PAGE) == "<html>ok</html>"


async def test_robots_is_fetched_once_per_site(monkeypatch: pytest.MonkeyPatch) -> None:
    requests = mock_http(monkeypatch, site())
    await fetch_text(PAGE)
    await fetch_text("https://www.ikea.gr/proioda/y/2/")
    assert [r.url.path for r in requests].count("/robots.txt") == 1


@pytest.mark.parametrize(
    ("response", "message"),
    [
        (httpx.Response(403), r"refused the request \(HTTP 403\)"),
        (httpx.Response(429), r"refused the request \(HTTP 429\)"),
        (httpx.Response(404), "no longer exists"),
        (httpx.Response(503), r"answered with an error \(HTTP 503\)"),
    ],
)
async def test_http_errors_become_plain_messages(
    monkeypatch: pytest.MonkeyPatch, response: httpx.Response, message: str
) -> None:
    mock_http(monkeypatch, site(page=response))
    with pytest.raises(FetchError, match=message):
        await fetch_text(PAGE)


async def test_redirect_to_another_site_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "www.ikea.gr" and request.url.path != "/robots.txt":
            return httpx.Response(302, headers={"Location": "https://evil.example/x"})
        return httpx.Response(200, text="")

    mock_http(monkeypatch, handler)
    with pytest.raises(FetchError, match="redirected to another site"):
        await fetch_text(PAGE)


async def test_timeouts_become_plain_messages(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text="")
        raise httpx.ReadTimeout("slow", request=request)

    mock_http(monkeypatch, handler)
    with pytest.raises(FetchError, match="took too long"):
        await fetch_text(PAGE)


async def test_missing_robots_means_no_rules(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        return httpx.Response(200, text="page")

    mock_http(monkeypatch, handler)
    assert await fetch_text(PAGE) == "page"


async def test_robots_server_trouble_reads_nothing_and_is_retried(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    robots_status = 503

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return httpx.Response(robots_status, text="User-agent: *\nDisallow: /proioda/")
        return httpx.Response(200, text="page")

    requests = mock_http(monkeypatch, handler)
    with pytest.raises(FetchError, match="Could not check what ikea.gr allows"):
        await fetch_text(PAGE)
    robots_status = 200  # the site is back: its real rules apply, nothing was cached
    with pytest.raises(FetchError, match="does not allow"):
        await fetch_text(PAGE)
    assert [r.url.path for r in requests] == ["/robots.txt", "/robots.txt"]


async def test_robots_locked_away_means_read_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return httpx.Response(403)
        return httpx.Response(200, text="page")

    mock_http(monkeypatch, handler)
    with pytest.raises(FetchError, match="does not allow reading"):
        await fetch_text(PAGE)


@pytest.mark.parametrize(
    "url", ["https:///x", "https://[invalid/x", "https://www.ikea.gr/\x00x", "ftp://ikea.gr/x"]
)
async def test_malformed_address_is_a_plain_error(
    monkeypatch: pytest.MonkeyPatch, url: str
) -> None:
    mock_http(monkeypatch, site())
    with pytest.raises(FetchError, match="Not a valid web address"):
        await fetch_text(url)


async def test_a_server_that_trickles_bytes_hits_the_deadline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import asyncio

    from app.tools import web_fetch

    class Trickle(httpx.AsyncByteStream):
        async def __aiter__(self):  # type: ignore[no-untyped-def]
            while True:
                await asyncio.sleep(0.01)  # each read is quick, so httpx never times out
                yield b"<"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text="")
        return httpx.Response(200, stream=Trickle())

    mock_http(monkeypatch, handler)
    monkeypatch.setattr(web_fetch, "DOWNLOAD_DEADLINE_S", 0.2)
    with pytest.raises(FetchError, match="took too long"):
        await fetch_text(PAGE)


async def test_oversized_page_stops_early(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.tools import web_fetch

    monkeypatch.setattr(web_fetch, "MAX_BYTES", 1000)
    mock_http(monkeypatch, site(page=httpx.Response(200, text="x" * 5000)))
    with pytest.raises(FetchError, match="too large"):
        await fetch_text(PAGE)


async def test_greek_text_is_decoded(monkeypatch: pytest.MonkeyPatch) -> None:
    page = httpx.Response(
        200, content="Γραφείο".encode(), headers={"Content-Type": "text/html; charset=utf-8"}
    )
    mock_http(monkeypatch, site(page=page))
    assert await fetch_text(PAGE) == "Γραφείο"


@pytest.mark.parametrize(
    ("path", "allowed"),
    [
        ("/proioda/x/1/", True),
        ("/old/page.aspx", False),  # 'Disallow: /*.aspx$'
        ("/old/page.aspx?x=1", True),  # $ anchors the end
        ("/el/search-results/?q=desk", False),  # 'Disallow: /*search-results/'
        ("/p/ok-1", True),  # the longer Allow beats the shorter Disallow
        ("/p/no", False),
    ],
)
def test_robots_wildcards(path: str, allowed: bool) -> None:
    from app.tools.web_fetch import robots_allow, robots_rules

    rules = robots_rules(
        "User-agent: *\nDisallow: /*.aspx$\nDisallow: /*search-results/\nDisallow: /p/\n"
        "Allow: /p/ok\n\nUser-agent: Baiduspider\nDisallow: /"
    )
    assert robots_allow(rules, f"https://www.ikea.gr{path}") is allowed


@pytest.mark.parametrize(
    ("response", "transient"),
    [(httpx.Response(503), True), (httpx.Response(429), True), (httpx.Response(404), False),
     (httpx.Response(403), False)],
)  # fmt: skip
async def test_only_passing_trouble_is_transient(
    monkeypatch: pytest.MonkeyPatch, response: httpx.Response, transient: bool
) -> None:
    mock_http(monkeypatch, site(page=response))
    with pytest.raises(FetchError) as error:
        await fetch_text(PAGE)
    assert error.value.transient is transient
