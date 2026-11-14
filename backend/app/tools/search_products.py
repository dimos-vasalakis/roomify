"""Find candidate product pages for a spec: shop sitemaps first, web search if too few.

Shop URLs spell Greek in Latin letters, inconsistently ("bibliothiki", "bibliotiki",
"sxedia", "schedio"). Both the query and the URLs are reduced to a consonant
skeleton so those spellings meet.
"""

import asyncio
import re
from collections.abc import Sequence
from typing import NamedTuple

from pydantic import BaseModel, Field

from app.cache import ReplayMiss
from app.config import get_settings
from app.tools.catalogue import ShopCatalogue, saved_catalogue
from app.tools.greeklish import Word, index_words, split_words, word_keys
from app.tools.shops import Shop, enabled_shops
from app.tools.web_search import WebSearchError, web_search


class ProductSpec(BaseModel):
    """What to look for. Written by the LLM from the photo and the user's words."""

    item: list[str] = Field(min_length=1, description="What it is, Greek, any of: ['τραπέζι']")
    keywords: list[str] = Field(default=[], description="Style, colour, material, Greek")
    exclude: list[str] = Field(
        default=[], description="Words that mean a different item, Greek: ['καρέκλα'] for a desk"
    )
    max_price_eur: float | None = None
    max_width_cm: float | None = None
    max_depth_cm: float | None = None
    max_height_cm: float | None = None
    shops: list[str] | None = Field(default=None, description="Domains; None means all")


class SearchHit(BaseModel):
    url: str
    retailer: str
    shop_name: str
    words: str  # slug words: a hint, not a fact about the product
    score: float
    source: str  # "catalogue" or "web"


class SearchResult(BaseModel):
    hits: list[SearchHit]
    note: str | None  # e.g. why web search was skipped


def _word_matches(query: Word, slug_words: Sequence[Word]) -> bool:
    # Short words (χαλί: 'xl') could be anything with those consonants ('XL'), so they
    # must match with their vowels. Longer ones may be a prefix of the consonants,
    # which covers Greek endings and spellings (γραφείο / grafeioy / grafeiou).
    if query.skeleton.isdigit():  # 140 matches 140x80, 14 does not
        return any(query.skeleton in re.findall(r"\d+", w.skeleton) for w in slug_words)
    if len(query.skeleton) < 3:
        return any(w.loose.startswith(query.loose) for w in slug_words)
    return any(w.skeleton.startswith(query.skeleton) for w in slug_words)


def _querysplit_words(texts: list[str]) -> list[Word]:
    words = [word_keys(w) for text in texts for w in split_words(text)]
    return [w for w in words if len(w.skeleton) >= 2 or w.skeleton.isdigit()]  # drops 'με', 'και'


class _Query(NamedTuple):
    """The spec's words, prepared once per search instead of once per catalogue entry."""

    options: list[list[Word]]  # item: any option, all of its words
    extra: list[Word]  # keywords
    exclude: list[Word]


def _prepare(item: list[str], keywords: list[str], exclude: list[str] | None) -> _Query:
    options = [opt for opt in (_querysplit_words([o]) for o in item) if opt]
    return _Query(options, _querysplit_words(keywords), _querysplit_words(exclude or []))


def _score(query: _Query, slug_words: Sequence[Word]) -> float:
    if any(_word_matches(w, slug_words) for w in query.exclude):
        return 0.0
    if not any(all(_word_matches(w, slug_words) for w in opt) for opt in query.options):
        return 0.0
    found = sum(_word_matches(w, slug_words) for w in query.extra)
    return 1.0 + (found / len(query.extra) if query.extra else 0.0)


def _spread(hits: list[SearchHit], shops: list[Shop], limit: int) -> list[SearchHit]:
    """Best first, but no shop takes more than half the slots when others have hits."""
    priority = {s.domain: s.priority for s in shops}
    ranked = sorted(hits, key=lambda h: (-h.score, priority.get(h.retailer, 9), len(h.words)))
    cap = max(limit // 2, 1)
    picked: list[SearchHit] = []
    per_shop: dict[str, int] = {}
    for hit in ranked:
        if per_shop.get(hit.retailer, 0) < cap:
            picked.append(hit)
            per_shop[hit.retailer] = per_shop.get(hit.retailer, 0) + 1
    chosen = {h.url for h in picked}
    picked += [h for h in ranked if h.url not in chosen]  # fill if few shops had hits
    return picked[:limit]


def _wanted_shops(spec: ProductSpec) -> tuple[list[Shop], str | None]:
    """spec.shops comes from the LLM: accept 'IKEA', 'www.ikea.gr', 'https://jysk.gr/'."""
    shops = enabled_shops()
    if not spec.shops:
        return shops, None

    def clean(name: str) -> str:
        name = name.strip().lower().removeprefix("https://").removeprefix("http://")
        return name.removeprefix("www.").rstrip("/")

    wanted = {clean(n) for n in spec.shops}
    picked = [s for s in shops if {s.domain, s.name.lower(), s.domain.split(".")[0]} & wanted]
    if picked:
        return picked, None
    return shops, f"Shops {', '.join(spec.shops)} are not ones we use; searched all shops"


def _catalogue_or_reason(shop: Shop) -> ShopCatalogue | str:
    catalogue = saved_catalogue(shop)
    if catalogue is not None:
        return catalogue
    if get_settings().replay:
        return f"{shop.name} was not recorded for replay"
    return f"{shop.name} is not searchable right now: its product list has not been downloaded"


def _scan(query: _Query, shops: list[Shop]) -> tuple[list[SearchHit], list[str]]:
    """CPU-bound: runs in a worker thread so live event streams keep flowing."""
    hits: list[SearchHit] = []
    notes: list[str] = []
    for shop in shops:
        catalogue = _catalogue_or_reason(shop)
        if isinstance(catalogue, str):
            notes.append(catalogue)
            continue
        for entry in catalogue.entries:
            score = _score(query, entry.keys)
            if score:
                hits.append(
                    SearchHit(url=entry.url, retailer=shop.domain, shop_name=shop.name,
                              words=entry.words, score=score, source="catalogue")
                )  # fmt: skip
    return hits, notes


async def _web_hits(spec: ProductSpec, query: _Query, shops: list[Shop]) -> list[SearchHit]:
    text = " ".join(spec.item[:1] + spec.keywords)
    hits = []
    for web_hit in await web_search(text, shops):
        # The page title stands in for the slug, so the same rules apply as in catalogues.
        score = _score(query, index_words(web_hit.title))
        if score:
            hits.append(
                SearchHit(url=web_hit.url, retailer=web_hit.shop.domain,
                          shop_name=web_hit.shop.name, words=web_hit.title,
                          score=score, source="web")
            )  # fmt: skip
    return hits


async def search_products(spec: ProductSpec, limit: int = 12) -> SearchResult:
    """Never raises and never downloads catalogues: a shop that cannot be searched
    becomes part of `note`."""
    shops, shop_note = _wanted_shops(spec)
    query = _prepare(spec.item, spec.keywords, spec.exclude)
    hits, notes = await asyncio.to_thread(_scan, query, shops)
    if shop_note:
        notes.insert(0, shop_note)
    hits = _spread(hits, shops, limit)

    if len(hits) < limit // 2:
        try:
            known = {h.url for h in hits}
            hits += [h for h in await _web_hits(spec, query, shops) if h.url not in known]
        except WebSearchError as exc:
            notes.append(str(exc))
        except ReplayMiss:
            notes.append("Web search was not recorded for replay")
    return SearchResult(hits=hits[:limit], note="; ".join(notes) or None)
