import httpx
import pytest

from app.tools.shops import enabled_shops
from app.tools.web_search import WebSearchError, web_search
from tests.helpers import mock_http


async def test_off_without_key() -> None:
    with pytest.raises(WebSearchError, match="no SERPER_API_KEY"):
        await web_search("γραφείο", enabled_shops())


async def test_keeps_only_product_pages_of_our_shops(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SERPER_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()
    organic = [
        {"link": "https://www.ikea.gr/proioda/mittzon-grafeio/59528113/", "title": "MITTZON"},
        {"link": "https://www.ikea.gr/katigories/grafeia/", "title": "category page"},
        {"link": "https://www.amazon.de/dp/123", "title": "other site"},
    ]
    requests = mock_http(monkeypatch, lambda r: httpx.Response(200, json={"organic": organic}))
    hits = await web_search("γραφείο", enabled_shops())
    assert [h.url for h in hits] == ["https://www.ikea.gr/proioda/mittzon-grafeio/59528113/"]
    assert requests[0].headers["X-API-KEY"] == "test-key"
    assert b"site:ikea.gr" in requests[0].content


async def test_unreadable_answer_is_a_plain_message(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SERPER_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()
    mock_http(monkeypatch, lambda r: httpx.Response(200, text="<html>captive portal</html>"))
    with pytest.raises(WebSearchError, match="unreadable"):
        await web_search("γραφείο", enabled_shops())


async def test_rate_limit_is_a_plain_message(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SERPER_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()
    mock_http(monkeypatch, lambda r: httpx.Response(429))
    with pytest.raises(WebSearchError, match="rate limited"):
        await web_search("γραφείο", enabled_shops())


async def test_replay_uses_the_recording_even_without_a_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.config import get_settings

    monkeypatch.setenv("SERPER_API_KEY", "recording-key")
    get_settings.cache_clear()
    organic = [
        {"link": "https://www.ikea.gr/proioda/mittzon-grafeio/59528113/", "title": "MITTZON"}
    ]
    mock_http(monkeypatch, lambda r: httpx.Response(200, json={"organic": organic}))
    recorded = await web_search("γραφείο", enabled_shops())

    monkeypatch.setenv("SERPER_API_KEY", "")  # the stage laptop has no key
    monkeypatch.setenv("REPLAY", "1")
    get_settings.cache_clear()

    def no_network(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no network in replay")

    mock_http(monkeypatch, no_network)
    assert await web_search("γραφείο", enabled_shops()) == recorded
