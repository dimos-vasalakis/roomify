"""Web search restricted to our shops (Serper, Google results). Optional: needs SERPER_API_KEY."""

import httpx
from pydantic import BaseModel

from app.cache import DAY, cached
from app.config import get_settings
from app.tools.shops import Shop, is_product_url

SERPER_URL = "https://google.serper.dev/search"
TIMEOUT = httpx.Timeout(15.0, connect=5.0)


class WebSearchError(Exception):
    pass


class WebResult(BaseModel):
    url: str
    title: str


class WebHit(BaseModel):
    url: str
    title: str
    shop: Shop


async def _serper(query: str, key: str) -> list[WebResult]:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(
                SERPER_URL,
                headers={"X-API-KEY": key},
                json={"q": query, "gl": "gr", "hl": "el", "num": 20},
            )
    except httpx.HTTPError as exc:
        raise WebSearchError("Web search did not answer") from exc
    if response.status_code == 429:
        raise WebSearchError("Web search is rate limited, try again in a minute")
    if response.status_code >= 400:
        raise WebSearchError(f"Web search failed (HTTP {response.status_code})")
    try:
        organic = response.json().get("organic", [])
        return [
            WebResult(url=r["link"], title=r.get("title", "")) for r in organic if r.get("link")
        ]
    except (ValueError, AttributeError, TypeError) as exc:
        raise WebSearchError("Web search sent back something unreadable") from exc


async def web_search(query: str, shops: list[Shop]) -> list[WebHit]:
    """Results that are product pages of our shops; anything else is dropped."""
    settings = get_settings()
    key = settings.serper_api_key or ""
    if not key and not settings.replay:  # replay uses the recording, with or without a key
        raise WebSearchError("Web search is off (no SERPER_API_KEY); used shop catalogues only")
    sites = " OR ".join(f"site:{s.domain}" for s in shops)
    full_query = f"{query} ({sites})"
    results = await cached(
        "web_search", {"q": full_query}, lambda: _serper(full_query, key), list[WebResult], DAY
    )
    hits = []
    for result in results:
        shop = next((s for s in shops if is_product_url(s, result.url)), None)
        if shop:
            hits.append(WebHit(url=result.url, title=result.title, shop=shop))
    return hits
