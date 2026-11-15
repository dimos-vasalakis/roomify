"""A company's own website, read for what it does and how it looks, so a room furnished for
it can follow its brand. Every fact keeps the page it came from."""

import html
import logging
import re
from collections import Counter

from pydantic import BaseModel

from app.cache import WEEK, cached
from app.tools.shops import host_of
from app.tools.web_fetch import FetchError, fetch_text, is_public_url
from app.tools.web_search import WebSearchError, web_results

log = logging.getLogger("roomify.brand")
# Sites that are about a company but are not the company's own.
_NOT_OWN = re.compile(
    r"wikipedia|linkedin|facebook|instagram|twitter|x\.com|youtube|tiktok|glassdoor|crunchbase|"
    r"bloomberg|indeed|tripadvisor|google\.|yelp|skroutz|kariera",
    re.IGNORECASE,
)


# Bootstrap's stock palette sits in half the web's CSS: never a brand's own choice.
_STOCK = {"#007bff", "#0d6efd", "#dc3545", "#28a745", "#198754", "#ffc107", "#17a2b8", "#0dcaf0",
          "#6f42c1", "#6610f2", "#e83e8c", "#d63384", "#fd7e14", "#20c997"}  # fmt: skip


class Brand(BaseModel):
    company: str
    url: str  # the page every fact below was read from
    title: str
    description: str
    colours: list[str]  # hex, most used first
    text: str  # the page's own words, shortened


def _own_site(company: str, results: list[tuple[str, str]]) -> str | None:
    words = [w for w in re.findall(r"\w{3,}", company.lower())]
    for url, _ in results:
        host = host_of(url)
        if _NOT_OWN.search(host) or not is_public_url(url):
            continue
        if any(w in host.replace("-", "") for w in words):
            return url
    return None


def _meta(page: str, name: str) -> str:
    found = re.search(
        rf"<meta[^>]+(?:name|property)=[\"']{name}[\"'][^>]*content=[\"']([^\"']*)", page, re.IGNORECASE
    ) or re.search(rf"<meta[^>]+content=[\"']([^\"']*)[\"'][^>]*(?:name|property)=[\"']{name}[\"']",
                   page, re.IGNORECASE)  # fmt: skip
    return html.unescape(found.group(1)).strip() if found else ""


def _colours(page: str) -> list[str]:
    """The brand's colours: the theme colour first, then the most used non-grey hex colours."""
    seen: Counter[str] = Counter()
    for raw in re.findall(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b", page):
        full = (raw if len(raw) == 6 else "".join(c * 2 for c in raw)).lower()
        r, g, b = (int(full[i : i + 2], 16) for i in (0, 2, 4))
        if (
            max(r, g, b) - min(r, g, b) > 24 and f"#{full}" not in _STOCK
        ):  # greys, black and white say nothing of a brand
            seen[f"#{full}"] += 1
    theme = _meta(page, "theme-color").lower()
    first = [theme] if re.fullmatch(r"#[0-9a-f]{6}", theme) else []
    ordered = first + [c for c, _ in seen.most_common(8)]
    return list(dict.fromkeys(ordered))[:5]


def _text(page: str) -> str:
    body = re.sub(
        r"<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", page, flags=re.DOTALL | re.IGNORECASE
    )
    words = html.unescape(re.sub(r"<[^>]+>", " ", body))
    return re.sub(r"\s+", " ", words).strip()[:2500]


def brand_from_page(company: str, url: str, page: str) -> Brand:
    title = re.search(r"<title[^>]*>(.*?)</title>", page, re.DOTALL | re.IGNORECASE)
    return Brand(
        company=company,
        url=url,
        title=html.unescape(title.group(1)).strip()[:200] if title else "",
        description=(_meta(page, "description") or _meta(page, "og:description"))[:400],
        colours=_colours(page),
        text=_text(page),
    )


async def read_brand(company: str, site: str | None = None) -> Brand | None:
    """The company's own homepage, read with robots.txt respected: the site the person named,
    else found by search. None when there is no own site to be found or it can't be read."""
    url = (
        f"https://{site.strip().removeprefix('https://').removeprefix('http://')}" if site else None
    )
    if url is None:
        try:
            results = await web_results(f"{company} official site")
        except WebSearchError as exc:
            log.warning("Brand search failed: %s", exc)
            return None
        url = _own_site(company, [(r.url, r.title) for r in results])
    if url is None or not host_of(url) or not is_public_url(url):
        return None
    home = f"https://{host_of(url)}/"

    async def read() -> Brand:
        return brand_from_page(company, home, await fetch_text(home))

    try:
        return await cached("brand", {"url": home}, read, Brand, WEEK)
    except FetchError as exc:
        log.warning("Brand page unreadable: %s", exc)
        return None
