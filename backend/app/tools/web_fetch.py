"""Fetch shop pages politely: robots.txt respected, hard timeouts, readable errors."""

import asyncio
import ipaddress
import logging
import re
from typing import NamedTuple
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel

from app.cache import HOUR, WEEK, cached
from app.tools.firecrawl import FirecrawlError, firecrawl_enabled, firecrawl_html, plain_text
from app.tools.shops import host_of, shop_for_url

log = logging.getLogger("roomify")

# Shops block obvious bots; a normal browser identity with low volume is what we send.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0 Safari/537.36"
    ),
    "Accept-Language": "el-GR,el;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
TIMEOUT = httpx.Timeout(20.0, connect=8.0)
MAX_BYTES = 12 * 1024 * 1024
DOWNLOAD_DEADLINE_S = 60.0


class FetchError(Exception):
    """Message is shown to the user in the live feed, so it is plain words."""

    def __init__(self, message: str, status: int | None = None, transient: bool = False) -> None:
        super().__init__(message)
        self.status = status  # HTTP status; None when there was no answer
        # True for trouble that passes (timeouts, overload): an earlier read may stand in.
        # False when the page is gone, forbidden or not allowed: nothing may stand in.
        self.transient = transient


class Robots(BaseModel):
    text: str
    locked: bool = False  # robots.txt itself answered 401/403: often a passing bot check


def _check_response(url: str, response: httpx.Response) -> None:
    if host_of(str(response.url)) != host_of(url):
        raise FetchError(f"{host_of(url)} redirected to another site")
    status = response.status_code
    if status in (401, 403, 429):
        raise FetchError(
            f"{host_of(url)} refused the request (HTTP {status})", status, transient=status == 429
        )
    if status in (404, 410):
        raise FetchError("Page no longer exists", status)
    if status >= 400:
        raise FetchError(
            f"{host_of(url)} answered with an error (HTTP {status})",
            status,
            transient=status >= 500,
        )


async def _download(url: str) -> str:
    """httpx times out each read, not the whole download: a server trickling bytes could
    hold a request open for ever. The deadline and size cap cover the whole body."""
    try:
        async with (
            asyncio.timeout(DOWNLOAD_DEADLINE_S),
            httpx.AsyncClient(
                headers=HEADERS, timeout=TIMEOUT, follow_redirects=True, max_redirects=5
            ) as client,
            client.stream("GET", url) as response,
        ):
            _check_response(url, response)
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body += chunk
                if len(body) > MAX_BYTES:
                    raise FetchError("Page is too large to read")
            return body.decode(response.encoding or "utf-8", errors="replace")
    except (TimeoutError, httpx.TimeoutException) as exc:
        raise FetchError(f"{host_of(url)} took too long to answer", transient=True) from exc
    except httpx.HTTPError as exc:
        raise FetchError(f"Could not reach {host_of(url)}", transient=True) from exc
    except (httpx.InvalidURL, ValueError) as exc:
        raise FetchError("Not a valid web address") from exc


class _Rule(NamedTuple):
    allow: bool
    pattern: re.Pattern[str]
    length: int  # the longest matching rule wins


def robots_rules(text: str) -> list[_Rule]:
    """The rules for every crawler ('User-agent: *'), with Google's '*' and '$' wildcards,
    which Python's urllib.robotparser does not understand."""
    rules: list[_Rule] = []
    agents: list[str] = []
    in_rules = False
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        key, _, value = line.partition(":")
        key, value = key.strip().lower(), value.strip()
        if key == "user-agent":
            if in_rules:  # a new group starts
                agents, in_rules = [], False
            agents.append(value.lower())
        elif key in ("allow", "disallow"):
            in_rules = True
            if "*" in agents and value:  # an empty Disallow allows everything
                regex = re.escape(value).replace(r"\*", ".*")
                regex = regex[:-2] + "$" if regex.endswith(r"\$") else regex
                rules.append(_Rule(key == "allow", re.compile(regex), len(value)))
    return rules


def robots_allow(rules: list[_Rule], url: str) -> bool:
    parts = urlsplit(url)
    path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    best: _Rule | None = None
    for rule in rules:
        if rule.pattern.match(path) and (
            best is None or rule.length > best.length or (rule.length == best.length and rule.allow)
        ):
            best = rule
    return best is None or best.allow


def _through_service(url: str) -> bool:
    shop = shop_for_url(url)
    return bool(shop and shop.read_through_service and firecrawl_enabled())


async def _robots(url: str) -> Robots:
    parts = urlsplit(url)
    robots_url = f"{parts.scheme}://{parts.netloc}/robots.txt"

    async def load() -> Robots:
        if _through_service(url):
            try:
                return Robots(text=plain_text(await firecrawl_html(robots_url)))
            except FirecrawlError as exc:  # never worse than no service: read it directly
                log.warning("Firecrawl robots for %s failed: %s", host_of(url), exc)
        try:
            return Robots(text=await _download(robots_url))
        except FetchError as exc:
            if exc.status in (401, 403, 429) and firecrawl_enabled():
                try:  # the shop refuses this server, not reading: ask through Firecrawl
                    return Robots(text=plain_text(await firecrawl_html(robots_url)))
                except FirecrawlError:
                    pass
            if exc.status in (401, 403):  # read nothing now; ask again in an hour, not a week
                return Robots(text="User-agent: *\nDisallow: /", locked=True)
            if exc.status is not None and 400 <= exc.status < 500 and exc.status != 429:
                return Robots(text="")  # the site has no robots.txt: no rules
            # Server trouble: its rules are unknown, so read nothing now and try again later.
            raise FetchError(
                f"Could not check what {host_of(url)} allows; try again soon", transient=True
            ) from exc

    robots = await cached(
        "robots", {"url": robots_url}, load, Robots,
        max_age_s=lambda r: HOUR if r.locked else WEEK,
    )  # fmt: skip
    return robots


async def warm_robots(urls: list[str]) -> None:
    """Check each site's robots.txt once before reading its pages in parallel, so parallel
    reads find it saved instead of all downloading it at the same moment."""
    sites = {f"{urlsplit(u).scheme}://{urlsplit(u).netloc}/": u for u in urls if host_of(u)}

    async def one(url: str) -> None:
        try:
            await _robots(url)
        except FetchError:
            pass  # each page read reports this in its own words

    await asyncio.gather(*(one(u) for u in sites.values()))


def _public_host(host: str) -> bool:
    """Search results are untrusted: never let one point us at a private address."""
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        return False
    try:
        ip = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return "." in host  # a public name, not a bare intranet name
    return ip.is_global


def is_public_url(url: str) -> bool:
    try:
        _check_address(url)
    except FetchError:
        return False
    return True


def _check_address(url: str) -> None:
    try:
        parts = urlsplit(url)
        valid = parts.scheme in ("http", "https") and bool(parts.hostname)
        valid = valid and _public_host((parts.hostname or "").lower())
    except ValueError:
        valid = False
    if not valid:
        raise FetchError("Not a valid web address")


async def fetch_text(url: str) -> str:
    """Raw page text, uncached: callers cache what they extract, not megabytes of HTML."""
    _check_address(url)
    robots = await _robots(url)
    if robots.locked:  # passing trouble: an earlier read of the page may stand in
        raise FetchError(f"{host_of(url)} is refusing requests right now", transient=True)
    if not robots_allow(robots_rules(robots.text), url):
        raise FetchError(f"{host_of(url)} does not allow reading this page")
    if _through_service(url):
        try:
            return await fetch_through_service(url)
        except FetchError as exc:  # never worse than no service: read it directly
            log.warning("Firecrawl read for %s failed: %s", host_of(url), exc)
    try:
        return await _download(url)
    except FetchError as exc:
        if exc.status not in (401, 403, 429) or not firecrawl_enabled():
            raise
        return await fetch_through_service(url, exc)


async def fetch_through_service(url: str, cause: Exception | None = None) -> str:
    """The page through Firecrawl, for shops that refuse this server or show it a bot check
    instead of the product. Same robots rules; raises FetchError in plain words."""
    try:
        return await firecrawl_html(url)
    except FirecrawlError as exc:
        raise FetchError(f"{host_of(url)} refused the request, and {exc}") from (cause or exc)
