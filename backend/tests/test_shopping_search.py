import httpx
import pytest

from app.tools import relevance
from app.tools import search_products as search_module
from app.tools import shopping_search as shopping
from app.tools.search_products import ProductSpec, search_products
from app.tools.web_search import WebSearchError
from tests.helpers import mock_http

US = {"country": "US", "language": "en", "currency": "USD"}


@pytest.fixture(autouse=True)
def key_and_no_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SERPER_API_KEY", "test")
    monkeypatch.setattr(relevance, "llm_available", lambda: False)


def serper(shopping_results: list[dict], organic: list[dict] | None = None):  # type: ignore[type-arg]
    def answer(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/shopping":
            return httpx.Response(200, json={"shopping": shopping_results})
        return httpx.Response(200, json={"organic": organic or []})

    return answer


async def test_leads_skip_marketplaces_and_google_links(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = mock_http(monkeypatch, serper(
        [{"title": "LERSTA floor lamp", "source": "IKEA", "link": "https://www.ikea.com/us/en/p/lersta-1/"},
         {"title": "Lamp", "source": "Amazon.com", "link": "https://www.amazon.com/dp/X"},
         {"title": "Lamp", "source": "Store", "link": "https://www.google.com/shopping/product/1"}],
        [{"title": "Arc lamp - CB2", "link": "https://www.cb2.com/arc-lamp/s1"}],
    ))  # fmt: skip
    leads = await shopping.shopping_search("floor lamp", "US", "en")
    assert [(lead.shop_name, lead.retailer) for lead in leads] == [
        ("IKEA", "ikea.com"),
        ("Cb2", "cb2.com"),
    ]
    assert '"gl":"us"' in calls[0].content.decode().replace(" ", "")


async def test_no_key_is_a_plain_note(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SERPER_API_KEY", "")
    from app.config import get_settings

    get_settings.cache_clear()
    with pytest.raises(WebSearchError, match="SERPER_API_KEY"):
        await shopping.shopping_search("floor lamp", "US", "en")


async def test_outside_greece_search_uses_shopping_not_catalogues(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(search_module, "saved_catalogue", lambda shop: pytest.fail("catalogue"))
    mock_http(monkeypatch, serper(
        [{"title": f"Armchair {i}", "source": "Castlery", "link": f"https://www.castlery.com/us/products/a{i}"}
         for i in range(12)]
        + [{"title": "Kids armchair", "source": "Toys", "link": "https://toys.example.com/kid"}],
    ))  # fmt: skip
    spec = ProductSpec(item=["armchair"], exclude=["kids"], **US)
    result = await search_products(spec, limit=4)
    assert len(result.hits) == 4 and result.note is None
    assert all(h.source == "web" and "castlery" in h.retailer for h in result.hits)


async def test_outside_greece_without_search_says_why(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SERPER_API_KEY", "")
    from app.config import get_settings

    get_settings.cache_clear()
    result = await search_products(ProductSpec(item=["armchair"], **US), limit=4)
    assert result.hits == [] and result.note and "SERPER_API_KEY" in result.note
