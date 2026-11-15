"""Read a page through Firecrawl when a shop refuses our own request.

Shops such as IKEA turn away requests from cloud servers (Render) while serving the same
page to a laptop. Firecrawl fetches it from its own browsers. Optional: needs
FIRECRAWL_API_KEY. Callers cache what they extract, as with a direct read.
"""

import html
import logging
import re
import time

import httpx

from app.config import get_settings

log = logging.getLogger("roomify")

SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape"
TIMEOUT = httpx.Timeout(45.0, connect=8.0)


class FirecrawlError(Exception):
    """Plain words, no provider payloads or credentials."""


OFF_FOR_S = 600

# Set when Firecrawl rejects the key (401) or has no credits (402): every call in the next few
# minutes would fail the same way, and each one cost a shop page its read. It switches itself
# back on after OFF_FOR_S, so fixed credits or a passing outage never need a restart.
_off_reason: str | None = None
_off_until = 0.0
# What happened lately, for GET /health/services. Never holds the key or a provider payload.
_recent: dict[str, int | str | None] = {"ok": 0, "failed": 0, "last_error": None}


def firecrawl_enabled() -> bool:
    global _off_reason
    settings = get_settings()
    if _off_reason is not None and time.monotonic() >= _off_until:
        log.warning("Firecrawl back on after: %s", _off_reason)
        _off_reason = None
    return bool(settings.firecrawl_api_key) and not settings.replay and _off_reason is None


def _turn_off(reason: str) -> None:
    global _off_reason, _off_until
    if _off_reason is None:
        log.error("Firecrawl off for %d min: %s", OFF_FOR_S // 60, reason)
    _off_reason = reason
    _off_until = time.monotonic() + OFF_FOR_S


def firecrawl_status() -> dict[str, object]:
    """Is the page reading service set up and working? No key, no payloads."""
    settings = get_settings()
    state = (
        "replay" if settings.replay
        else "no FIRECRAWL_API_KEY" if not settings.firecrawl_api_key
        else f"off: {_off_reason}" if not firecrawl_enabled()
        else "on"
    )  # fmt: skip
    return {"state": state, "pages_read": _recent["ok"], "pages_failed": _recent["failed"],
            "last_error": _recent["last_error"]}  # fmt: skip


def _failed(message: str) -> FirecrawlError:
    _recent["failed"] = int(_recent["failed"] or 0) + 1
    _recent["last_error"] = message
    return FirecrawlError(message)


def _error_text(response: httpx.Response) -> str:
    try:
        body = response.json()
        return str(body.get("error") or body.get("message") or "") if isinstance(body, dict) else ""
    except ValueError:
        return ""


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
        raise _failed("the page reading service did not answer") from exc
    if response.status_code == 401 or (
        response.status_code == 403
        and re.search(r"key|token|unauthori[sz]ed|auth", _error_text(response), re.IGNORECASE)
    ):
        _turn_off(f"FIRECRAWL_API_KEY was rejected (HTTP {response.status_code}); "
                  "check the key set on the server")  # fmt: skip
        raise _failed("the page reading service is not set up on this server")
    if response.status_code == 402:
        _turn_off("Firecrawl is out of credits (HTTP 402)")
        raise _failed("the page reading service is out of credits")
    if response.status_code == 403:
        # Firecrawl answers 403 for a site it won't read: that site only, never every shop.
        raise _failed("the page reading service can't read this site")
    if response.status_code == 429:
        raise _failed("the page reading service is busy, try again in a minute")
    if response.status_code >= 400:
        raise _failed(f"the page reading service failed (HTTP {response.status_code})")
    try:
        data = response.json().get("data") or {}
        page = data.get("rawHtml") or data.get("html") or ""
        status = int((data.get("metadata") or {}).get("statusCode") or 200)
    except (ValueError, AttributeError, TypeError) as exc:
        raise _failed("the page reading service sent back something unreadable") from exc
    if status >= 400 or not page:
        raise _failed(f"the shop refused the page reading service too (HTTP {status})")
    _recent["ok"] = int(_recent["ok"] or 0) + 1
    return page


def plain_text(page: str) -> str:
    """A text file (robots.txt) that came back wrapped in a browser's HTML."""
    if "<pre" not in page and "<body" not in page:
        return page
    inner = re.search(r"<pre[^>]*>(.*?)</pre>", page, re.DOTALL | re.IGNORECASE)
    text = inner.group(1) if inner else re.sub(r"<[^>]+>", "\n", page)
    return html.unescape(text)
