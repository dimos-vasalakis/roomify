"""Read a page through Firecrawl when a shop refuses our own request.

Shops such as IKEA turn away requests from cloud servers (Render) while serving the same
page to a laptop. Firecrawl fetches it from its own browsers. Optional: needs
FIRECRAWL_API_KEY. Callers cache what they extract, as with a direct read.
"""

import html
import re

import httpx

from app.config import get_settings

SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape"
TIMEOUT = httpx.Timeout(45.0, connect=8.0)


class FirecrawlError(Exception):
    """Plain words, no provider payloads or credentials."""


def firecrawl_enabled() -> bool:
    settings = get_settings()
    return bool(settings.firecrawl_api_key) and not settings.replay


async def firecrawl_html(url: str) -> str:
    """The page's HTML as a browser received it. Raises FirecrawlError in plain words."""
    key = get_settings().firecrawl_api_key
    if not key:
        raise FirecrawlError("Page reading service is off (no FIRECRAWL_API_KEY)")
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(
                SCRAPE_URL,
                headers={"Authorization": f"Bearer {key}"},
                json={"url": url, "formats": ["rawHtml"], "onlyMainContent": False},
            )
    except httpx.HTTPError as exc:
        raise FirecrawlError("The page reading service did not answer") from exc
    if response.status_code == 402:
        raise FirecrawlError("The page reading service is out of credits")
    if response.status_code == 429:
        raise FirecrawlError("The page reading service is busy, try again in a minute")
    if response.status_code >= 400:
        raise FirecrawlError(f"The page reading service failed (HTTP {response.status_code})")
    try:
        data = response.json().get("data") or {}
        page = data.get("rawHtml") or data.get("html") or ""
        status = int((data.get("metadata") or {}).get("statusCode") or 200)
    except (ValueError, AttributeError, TypeError) as exc:
        raise FirecrawlError("The page reading service sent back something unreadable") from exc
    if status >= 400 or not page:
        raise FirecrawlError(f"The shop refused the page reading service too (HTTP {status})")
    return page


def plain_text(page: str) -> str:
    """A text file (robots.txt) that came back wrapped in a browser's HTML."""
    if "<pre" not in page and "<body" not in page:
        return page
    inner = re.search(r"<pre[^>]*>(.*?)</pre>", page, re.DOTALL | re.IGNORECASE)
    text = inner.group(1) if inner else re.sub(r"<[^>]+>", "\n", page)
    return html.unescape(text)
