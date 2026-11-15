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
from app.tools.catalogue import ShopCatalogue, saved_catalogue, seed_catalogue
from app.tools.greeklish import Word, index_words, split_words, word_keys
from app.tools.relevance import describe, relevant
from app.tools.shopping_search import shopping_search
from app.tools.shops import Shop, enabled_shops
from app.tools.web_search import WebSearchError, web_search

POOL_FACTOR = 3  # names shown to the relevance check per page we will read

# Words that turn a common item into something else. Added to every spec for that item
# unless the person asked for it ("πίνακας ανακοινώσεων" keeps bulletin boards).
# Each entry is a phrase: it excludes a product only if all its words are in the name.
_OTHER_SENSES: dict[str, list[str]] = {
    "πίνακας": ["ανακοινώσεων", "φελλού", "μαρκαδόρου", "διάτρητος", "πλέγμα", "μαγνητικός",
                "ζωγραφικής", "κιμωλίας", "ηλεκτρολογικός", "ασφαλειών", "στεγανός",
                "λευκός", "παιδικός", "θέσεων", "χωνευτός", "legrand", "schneider",
                "goomby", "securit"],
    "κάδρο": ["γαντζάκι", "γάντζος", "κρεμάστρα"],
    "κουρτίνα": ["σύρμα", "ράγα", "κρίκοι", "άγκιστρα", "γάντζοι", "ντους", "μπάνιου", "φόδρα",
                 "κρεβατιού", "βέργα", "κορδόνι"],
    "χαλί": ["μπάνιου", "ποντικιού", "αυτοκινήτου", "γιόγκα"],
    "τραπέζι": ["σιδερώματος", "μπιλιάρδου", "πινγκ"],
    "μαξιλάρι": ["ύπνου", "ανατομικό", "θήκη", "ταξιδιού"],
    "καθρέφτης": ["αυτοκινήτου"],
    "κρεβάτι": ["σκύλου", "γάτας", "κατοικιδίων", "ζώων"],
    "φυτό": ["σπόροι", "λίπασμα", "χώμα", "φυτοφάρμακο"],
    "ράφι": ["ψυγείου", "φούρνου"],
    "καρέκλα": ["αυτοκινήτου", "φαγητού", "μωρού"],
}  # fmt: skip


class ProductSpec(BaseModel):
    """What to look for. Written by the LLM from the photo and the user's words."""

    item: list[str] = Field(min_length=1, description="What it is, Greek, any of: ['τραπέζι']")
    keywords: list[str] = Field(default=[], description="Style, colour, material, Greek")
    exclude: list[str] = Field(
        default=[], description="Words that mean a different item, Greek: ['καρέκλα'] for a desk"
    )
    meaning: str | None = Field(
        default=None, description="What the person means, plain English: 'framed wall art'"
    )
    max_price_eur: float | None = None
    max_width_cm: float | None = None
    max_depth_cm: float | None = None
    max_height_cm: float | None = None
    shops: list[str] | None = Field(default=None, description="Domains; None means all")
    country: str = Field(default="GR", description="ISO code of where the person lives")
    language: str = Field(default="el", description="Language shops there write in")
    currency: str = Field(default="EUR", description="Currency of the budget")


class SearchHit(BaseModel):
    url: str
    retailer: str
    shop_name: str
    words: str  # slug words: a hint, not a fact about the product
    score: float
    source: str  # "catalogue" or "web"
    position: int = 0  # where the item word sits in `words`; first is most likely the item


class Dropped(BaseModel):
    """A hit that matched the words but is not the item ("Bulletin board, not wall art")."""

    hit: SearchHit
    reason: str


class SearchResult(BaseModel):
    hits: list[SearchHit]
    note: str | None  # e.g. why web search was skipped
    dropped: list[Dropped] = []


def _word_matches(query: Word, slug_words: Sequence[Word], loose_short: bool = False) -> bool:
    # Short words (χαλί: 'xl') could be anything with those consonants ('XL'), so they
    # must match with their vowels. Longer ones may be a prefix of the consonants,
    # which covers Greek endings and spellings (γραφείο / grafeioy / grafeiou), with at
    # most one consonant more: an ending (κουρτίν-ες, τραπεζ-άκι), not another word
    # (κουρτιν-όξυλο is a curtain rod; STOR-SINT is not a blind).
    if query.skeleton.isdigit():  # 140 matches 140x80, 14 does not
        return any(query.skeleton in re.findall(r"\d+", w.skeleton) for w in slug_words)
    if len(query.skeleton) < 3:
        return any(w.loose.startswith(query.loose) for w in slug_words)
    # Three consonants are still ambiguous (στόρι 'str' = AUSTRA = στρώμα), so those
    # must also start with the same sounds.
    return any(
        w.skeleton.startswith(query.skeleton)
        and len(w.skeleton) - len(query.skeleton) <= 1
        and (len(query.skeleton) > 3 or loose_short or w.loose[:3] == query.loose[:3])
        for w in slug_words
    )


def _querysplit_words(texts: list[str]) -> list[Word]:
    words = [word_keys(w) for text in texts for w in split_words(text)]
    return [w for w in words if len(w.skeleton) >= 2 or w.skeleton.isdigit()]  # drops 'με', 'και'


class _Query(NamedTuple):
    """The spec's words, prepared once per search instead of once per catalogue entry."""

    options: list[list[Word]]  # item: any option, all of its words
    extra: list[Word]  # keywords
    exclude: list[list[Word]]  # phrases: all words of one must be in the name


def _all_in(phrase: list[Word], words: Sequence[Word], loose_short: bool = False) -> bool:
    return all(_word_matches(w, words, loose_short) for w in phrase)


def _other_senses(options: list[list[Word]], asked: list[Word]) -> list[list[Word]]:
    """Built-in exclusions for the items asked for, minus anything the person asked for."""
    item_words = [w for opt in options for w in opt]
    found = []
    for item, phrases in _OTHER_SENSES.items():
        if not _word_matches(word_keys(item), item_words):
            continue
        for phrase in phrases:
            words = _querysplit_words([phrase])
            if words and not _all_in(words, asked):
                found.append(words)
    return found


def _prepare(item: list[str], keywords: list[str], exclude: list[str] | None) -> _Query:
    options = [opt for opt in (_querysplit_words([o]) for o in item) if opt]
    extra = _querysplit_words(keywords)
    asked = [w for opt in options for w in opt] + extra
    phrases = [p for p in (_querysplit_words([e]) for e in exclude or []) if p]
    return _Query(options, extra, phrases + _other_senses(options, asked))


def _score(query: _Query, slug_words: Sequence[Word]) -> float:
    # Exclusions skip the vowel check on three-consonant words (λευκός: leukos, leykos):
    # dropping a wrong-sense name is cheap, reading one is not.
    if any(_all_in(phrase, slug_words, loose_short=True) for phrase in query.exclude):
        return 0.0
    if not any(_all_in(opt, slug_words) for opt in query.options):
        return 0.0
    found = sum(_word_matches(w, slug_words) for w in query.extra)
    return 1.0 + (found / len(query.extra) if query.extra else 0.0)


def _item_position(query: _Query, slug_words: Sequence[Word]) -> int:
    """Where the item word sits in the name. Shops name the item first ("kadro ostaria",
    "IKEA-NAME kathreftis"); accessories name it last ("syrma koyrtinas", "bisk cadril")."""
    for i, word in enumerate(slug_words):
        if any(_word_matches(w, [word]) for opt in query.options for w in opt):
            return i
    return len(slug_words)


def _spread(hits: list[SearchHit], shops: list[Shop], limit: int) -> list[SearchHit]:
    """Best first, but no shop takes more than half the slots when others have hits."""
    priority = {s.domain: s.priority for s in shops}
    ranked = sorted(
        hits,
        key=lambda h: (-h.score, h.position > 1, priority.get(h.retailer, 9), len(h.words)),
    )
    # Colour and size links of one model share their name: one is enough to read.
    ranked = list({(h.retailer, h.words): h for h in reversed(ranked)}.values())[::-1]
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
    catalogue = saved_catalogue(shop) or seed_catalogue(shop)  # seed: before the first download
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
                              words=entry.words, score=score, source="catalogue",
                              position=_item_position(query, entry.keys))
                )  # fmt: skip
    return hits, notes


async def _web_hits(spec: ProductSpec, query: _Query, shops: list[Shop]) -> list[SearchHit]:
    text = " ".join(spec.item[:1] + spec.keywords)
    hits = []
    for web_hit in await web_search(text, shops):
        # The page title stands in for the slug, so the same rules apply as in catalogues.
        words = index_words(web_hit.title)
        score = _score(query, words)
        if score:
            hits.append(
                SearchHit(url=web_hit.url, retailer=web_hit.shop.domain,
                          shop_name=web_hit.shop.name, words=web_hit.title,
                          score=score, source="web", position=_item_position(query, words))
            )  # fmt: skip
    return hits


async def _only_the_item(
    spec: ProductSpec, hits: list[SearchHit], shops: list[Shop], limit: int
) -> tuple[list[SearchHit], list[Dropped]]:
    """The LLM reads the names and keeps the ones that are the item, best first.
    Unchecked (no LLM), the word-matching order stands, spread across shops."""
    want = describe(spec.item, spec.keywords, spec.meaning)
    verdict = await relevant(want, [h.words for h in hits], limit)
    if not verdict.checked:
        return _spread(hits, shops, limit), []
    kept = [hits[i] for i in verdict.keep]
    dropped = [Dropped(hit=hits[i], reason=why) for i, why in verdict.rejected.items()]
    return kept, dropped


async def _shopping_hits(spec: ProductSpec, query: _Query) -> tuple[list[SearchHit], str | None]:
    """Google Shopping leads for the item, minus the other senses. Never raises."""
    hits: dict[str, SearchHit] = {}
    note = None
    try:
        for option in spec.item[:2]:  # the main name, and one alternative
            text = " ".join([option, *spec.keywords])
            for lead in await shopping_search(text, spec.country, spec.language):
                words = index_words(lead.title)
                if lead.url in hits or any(_all_in(p, words, True) for p in query.exclude):
                    continue
                hits[lead.url] = SearchHit(
                    url=lead.url, retailer=lead.retailer, shop_name=lead.shop_name,
                    words=lead.title, score=1.0, source="web",
                )  # fmt: skip
    except WebSearchError as exc:
        note = str(exc)
    except ReplayMiss:
        note = "Shopping search was not recorded for replay"
    return list(hits.values()), note


async def _anywhere(spec: ProductSpec, limit: int) -> SearchResult:
    """Outside Greece: Google Shopping leads, then the same relevance check."""
    hits, note = await _shopping_hits(spec, _prepare(spec.item, spec.keywords, spec.exclude))
    if not hits:
        return SearchResult(hits=[], note=note)
    kept, dropped = await _only_the_item(spec, hits[: limit * POOL_FACTOR], [], limit)
    return SearchResult(hits=kept, note=None, dropped=dropped)


async def search_products(spec: ProductSpec, limit: int = 12) -> SearchResult:
    """Never raises and never downloads catalogues: a shop that cannot be searched
    becomes part of `note`."""
    if spec.country.upper() != "GR":
        return await _anywhere(spec, limit)
    shops, shop_note = _wanted_shops(spec)
    query = _prepare(spec.item, spec.keywords, spec.exclude)
    hits, notes = await asyncio.to_thread(_scan, query, shops)
    if shop_note:
        notes.insert(0, shop_note)
    # Word matching casts the net; the relevance check picks from a wider pool than we read.
    pool = _spread(hits, shops, limit * POOL_FACTOR)
    if get_settings().serper_api_key or get_settings().replay:
        # Google Shopping adds the rest of the web: shops beyond our catalogues, and items
        # whose shop names them differently. The same relevance check ranks them all.
        web, _ = await _shopping_hits(spec, query)
        wanted = {s.domain for s in shops} if spec.shops else None
        known = {h.url for h in pool}
        web = [h for h in web if h.url not in known and (wanted is None or h.retailer in wanted)]
        pool += web[: limit // 2]
    hits, dropped = await _only_the_item(spec, pool, shops, limit)

    if len(hits) < limit // 2:
        try:
            known = {h.url for h in hits} | {d.hit.url for d in dropped}
            web = [h for h in await _web_hits(spec, query, shops) if h.url not in known]
            web, web_dropped = await _only_the_item(spec, web, shops, limit - len(hits))
            hits += web
            dropped += web_dropped
        except WebSearchError as exc:
            notes.append(str(exc))
        except ReplayMiss:
            notes.append("Web search was not recorded for replay")
    return SearchResult(hits=hits[:limit], note="; ".join(notes) or None, dropped=dropped)
