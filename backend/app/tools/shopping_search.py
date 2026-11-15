"""Products from any shop in any country: Google Shopping results through Serper.

Used wherever the person is not in Greece (Greece has its own instant shop catalogues).
A result is only a lead: its price and size are read again from the shop's own page.
"""

import httpx
from pydantic import BaseModel

from app.cache import DAY, cached
from app.config import get_settings
from app.tools.shops import host_of
from app.tools.web_search import WebSearchError

SHOPPING_URL = "https://google.serper.dev/shopping"
SEARCH_URL = "https://google.serper.dev/search"
TIMEOUT = httpx.Timeout(15.0, connect=5.0)

# Marketplaces and shops that wall off automated page reads: a lead there can never be
# verified, so it would only use up a read and end as a rejection.
UNREADABLE = (
    "amazon.", "ebay.", "walmart.", "wayfair.", "etsy.", "temu.", "aliexpress.", "shein.",
    "google.", "youtube.", "pinterest.", "facebook.", "instagram.", "reddit.", "tiktok.",
    "skroutz.", "bestprice.",  # price comparison: many shops' prices on one page, no one price
)  # fmt: skip


class ShoppingLead(BaseModel):
    url: str
    title: str
    shop_name: str
    retailer: str  # host without www.


def _readable(url: str) -> bool:
    host = host_of(url)
    return bool(host) and not any(host.startswith(b) or f".{b}" in host for b in UNREADABLE)


async def _post(url: str, body: dict[str, object], key: str) -> dict[str, object]:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(url, headers={"X-API-KEY": key}, json=body)
    except httpx.HTTPError as exc:
        raise WebSearchError("Shopping search did not answer") from exc
    if response.status_code == 429:
        raise WebSearchError("Shopping search is rate limited, try again in a minute")
    if response.status_code >= 400:
        raise WebSearchError(f"Shopping search failed (HTTP {response.status_code})")
    try:
        data = response.json()
    except ValueError as exc:
        raise WebSearchError("Shopping search sent back something unreadable") from exc
    if not isinstance(data, dict):
        raise WebSearchError("Shopping search sent back something unreadable")
    return data


class _Raw(BaseModel):
    url: str
    title: str
    source: str


async def _search(query: str, country: str, language: str, key: str) -> list[_Raw]:
    body = {"q": query, "gl": country.lower(), "hl": language, "num": 40}
    shopping = (await _post(SHOPPING_URL, body, key)).get("shopping") or []
    found = [
        _Raw(url=r["link"], title=r.get("title", ""), source=r.get("source", ""))
        for r in shopping
        if isinstance(r, dict) and r.get("link")
    ]
    if sum(_readable(r.url) for r in found) < 8:
        # Shopping links can point back at Google; shop pages from the plain search fill in.
        organic = (await _post(SEARCH_URL, body | {"q": f"{query} buy"}, key)).get("organic") or []
        found += [
            _Raw(url=r["link"], title=r.get("title", ""), source="")
            for r in organic
            if isinstance(r, dict) and r.get("link")
        ]
    return found


async def shopping_search(query: str, country: str, language: str) -> list[ShoppingLead]:
    """Product leads at shops whose pages can be read. Raises WebSearchError in plain words."""
    settings = get_settings()
    key = settings.serper_api_key or ""
    if not key and not settings.replay:
        raise WebSearchError(
            "Shopping outside Greece needs web search, which is off (no SERPER_API_KEY)"
        )
    raw = await cached(
        "shopping_search",
        {"q": query, "gl": country, "hl": language},
        lambda: _search(query, country, language, key),
        list[_Raw],
        DAY,
    )
    leads: dict[str, ShoppingLead] = {}
    for r in raw:
        if _readable(r.url) and r.url not in leads:
            host = host_of(r.url)
            name = r.source or host.split(".")[0].replace("-", " ").title()
            leads[r.url] = ShoppingLead(url=r.url, title=r.title, shop_name=name, retailer=host)
    return list(leads.values())
