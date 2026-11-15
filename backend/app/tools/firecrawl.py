"""Read a page through Firecrawl when a shop refuses our own request.

Shops such as IKEA turn away requests from cloud servers (Render) while serving the same
page to a laptop. Firecrawl fetches it from its own browsers. Optional: needs
FIRECRAWL_API_KEY. Callers cache what they extract, as with a direct read.
"""

import html
import logging
import re

import httpx

from app.config import get_settings

log = logging.getLogger("roomify")

SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape"
TIMEOUT = httpx.Timeout(45.0, connect=8.0)


class FirecrawlError(Exception):
    """Plain words, no provider payloads or credentials."""


# Set when Firecrawl rejects the key (401/403) or has no credits (402): every later call
# would fail the same way, and each one cost a shop page its read. Cleared on restart.
_off_reason: str | None = None


def firecrawl_enabled() -> bool:
    settings = get_settings()
    return bool(settings.firecrawl_api_key) and not settings.replay and _off_reason is None


def _turn_off(reason: str) -> None:
    global _off_reason
    if _off_reason is None:
        log.error("Firecrawl turned off until restart: %s", reason)
    _off_reason = reason


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
        raise FirecrawlError("the page reading service did not answer") from exc
    if response.status_code in (401, 403):
        # Firecrawl charges nothing for a rejected key: no credits are used while this lasts.
        _turn_off(f"FIRECRAWL_API_KEY was rejected (HTTP {response.status_code}); "
                  "check the key set on the server")  # fmt: skip
        raise FirecrawlError("the page reading service is not set up on this server")
    if response.status_code == 402:
        _turn_off("Firecrawl is out of credits (HTTP 402)")
        raise FirecrawlError("the page reading service is out of credits")
    if response.status_code == 429:
        raise FirecrawlError("the page reading service is busy, try again in a minute")
    if response.status_code >= 400:
        raise FirecrawlError(f"the page reading service failed (HTTP {response.status_code})")
    try:
        data = response.json().get("data") or {}
        page = data.get("rawHtml") or data.get("html") or ""
        status = int((data.get("metadata") or {}).get("statusCode") or 200)
    except (ValueError, AttributeError, TypeError) as exc:
        raise FirecrawlError("the page reading service sent back something unreadable") from exc
    if status >= 400 or not page:
        raise FirecrawlError(f"the shop refused the page reading service too (HTTP {status})")
    return page


def plain_text(page: str) -> str:
    """A text file (robots.txt) that came back wrapped in a browser's HTML."""
    if "<pre" not in page and "<body" not in page:
        return page
    inner = re.search(r"<pre[^>]*>(.*?)</pre>", page, re.DOTALL | re.IGNORECASE)
    text = inner.group(1) if inner else re.sub(r"<[^>]+>", "\n", page)
    return html.unescape(text)
