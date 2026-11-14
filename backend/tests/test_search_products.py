import pytest

from app.tools import search_products as search_module
from app.tools.catalogue import CatalogueEntry, ShopCatalogue
from app.tools.greeklish import index_words, skeleton
from app.tools.search_products import ProductSpec, _prepare, _score, search_products
from app.tools.shops import SHOPS
from app.tools.web_search import WebHit, WebSearchError


def score_entry(item: list[str], keywords: list[str], slug: str, exclude: list[str]) -> float:
    return _score(_prepare(item, keywords, exclude), index_words(slug))


@pytest.mark.parametrize(
    "spellings",
    [
        ("γραφείο", "grafeio", "grafeioy", "grafeiou"),
        ("βιβλιοθήκη", "bibliothiki", "bibliotiki", "vivliothiki"),
        ("σχέδιο", "sxedia", "schedio"),
        ("ντουλάπα", "ntoylapa", "doulapa"),
        ("μπάνιο", "mpanio", "banio"),
        ("κρεβάτι", "krebati", "krevati"),
        ("στρογγυλό", "strogylo", "stroggylo"),
    ],
)
def test_greek_and_greeklish_spellings_meet(spellings: tuple[str, ...]) -> None:
    assert len({skeleton(w) for w in spellings}) == 1


@pytest.mark.parametrize(
    ("item", "keywords", "slug", "exclude", "expected"),
    [
        (["τραπέζι"], ["στρογγυλό", "λευκό"], "trapezi trapezarias ringsted strogylo leyko", [], 2.0),
        (["τραπέζι"], ["στρογγυλό", "μαύρο"], "trapezi trapezarias ringsted strogylo leyko", [], 1.5),
        (["τραπέζι"], [], "karekla cloe", [], 0.0),
        (["χαλί"], [], "xali bioafrol florence 250x200cm", [], 1.0),
        (["χαλί"], [], "mpoyrnoyzi bullmark l xl gkri", [], 0.0),  # 'XL' is not a rug
        (["γραφείο"], [], "karekla grafeioy slice leyki", ["καρέκλα"], 0.0),
        (["γραφείο"], [], "grafeio forma m120xp60xy75cm leyko", ["καρέκλα"], 1.0),
        (["καρέκλα γραφείου"], [], "karekla grafeioy slice", [], 1.0),
        (["καρέκλα γραφείου"], [], "karekla trapezarias", [], 0.0),  # all words of an option
        (["καναπές", "καναπέ"], [], "kanapes krebati vejlby", [], 1.0),  # any option
        (["γραφείο"], ["140"], "mittzon grafeio 140x80 cm", [], 2.0),  # a size inside 140x80
        (["γραφείο"], ["14"], "mittzon grafeio 140x80 cm", [], 1.0),  # but not part of a number
        (["γραφείο"], ["με", "για"], "grafeio", [], 1.0),  # little words are ignored
        (["κουρτίνα"], [], "lill diafanis koyrtina 2 tem", [], 1.0),
        (["κουρτίνα"], [], "teresia koyrtines", [], 1.0),  # an ending
        (["κουρτίνα"], [], "hugad koyrtinoksylo", [], 0.0),  # a curtain rod is another word
        (["στόρι"], [], "tretur stori pliroys syskotisis", [], 1.0),
        (["στόρι"], [], "storsint karafa", [], 0.0),  # a product name is not a blind
        (["στόρι"], [], "koyrtina austra 1x140x175 veloydo", [], 0.0),  # AUSTRA is 'str' too
        (["στόρι"], [], "stroma elatirion reva", [], 0.0),  # a mattress is not a blind
        (["ντουλάπα"], [], "doulapa royxon", [], 1.0),
        (["τραπέζι"], [], "trapezaki salonioy agerby", [], 1.0),  # the diminutive
    ],
)  # fmt: skip
def test_score_entry(item: list[str], keywords: list[str], slug: str, exclude: list[str],
                     expected: float) -> None:  # fmt: skip
    assert score_entry(item, keywords, slug, exclude) == expected


def _catalogues() -> list[ShopCatalogue]:
    def cat(domain: str, *words: str) -> ShopCatalogue:
        entries = [
            CatalogueEntry(
                url=f"https://{domain}/p/{w.replace(' ', '-')}", words=w, keys=index_words(w)
            )
            for w in words
        ]
        return ShopCatalogue(domain=domain, entries=entries, sitemap_errors=[])

    return [
        cat("ikea.gr", *(f"grafeio model{i} leyko" for i in range(10)), "karekla grafeioy"),
        cat("jysk.gr", "grafeio lindved leyko", "grafeio knabstrup mayro"),
        cat("praktiker.gr", "grafeio forma leyko"),
        cat("plaisio.gr", "karekla gaming mayri"),
        cat("pepco.gr", "kapitone kouverta"),
    ]


@pytest.fixture
def fake_catalogues(monkeypatch: pytest.MonkeyPatch) -> None:
    by_domain = {c.domain: c for c in _catalogues()}
    monkeypatch.setattr(search_module, "saved_catalogue", lambda shop: by_domain.get(shop.domain))


@pytest.mark.usefixtures("fake_catalogues")
async def test_best_matches_first_and_no_shop_takes_every_slot() -> None:
    result = await search_products(ProductSpec(item=["γραφείο"], keywords=["λευκό"]), limit=6)
    shops = [h.retailer for h in result.hits]
    assert shops.count("ikea.gr") <= 3
    assert "jysk.gr" in shops and "praktiker.gr" in shops
    assert all("leyko" in h.words for h in result.hits[:5])
    assert result.hits[0].retailer in ("ikea.gr", "jysk.gr")  # priority 1 shops first on ties


@pytest.mark.usefixtures("fake_catalogues")
async def test_shop_filter_and_exclude() -> None:
    spec = ProductSpec(item=["γραφείο"], exclude=["καρέκλα"], shops=["jysk.gr"])
    result = await search_products(spec, limit=10)
    assert {h.retailer for h in result.hits} == {"jysk.gr"}
    assert not any("karekla" in h.words for h in result.hits)


@pytest.mark.usefixtures("fake_catalogues")
async def test_too_few_hits_without_web_search_key_explains_why() -> None:
    result = await search_products(ProductSpec(item=["κουβέρτα"]), limit=10)
    assert len(result.hits) == 1
    assert result.note and "SERPER_API_KEY" in result.note


@pytest.mark.usefixtures("fake_catalogues")
async def test_web_search_tops_up_few_hits(monkeypatch: pytest.MonkeyPatch) -> None:
    jysk = next(s for s in SHOPS if s.domain == "jysk.gr")

    async def fake_web(query: str, shops: list) -> list[WebHit]:  # type: ignore[type-arg]
        assert "κουβέρτα" in query
        return [WebHit(url="https://jysk.gr/a/b/kouverta-x", title="Κουβέρτα X", shop=jysk),
                WebHit(url="https://pepco.gr/p/kapitone-kouverta", title="dup", shop=jysk)]  # fmt: skip

    monkeypatch.setattr(search_module, "web_search", fake_web)
    result = await search_products(ProductSpec(item=["κουβέρτα"]), limit=10)
    assert [h.source for h in result.hits] == ["catalogue", "web"]
    assert result.note is None


@pytest.mark.usefixtures("fake_catalogues")
async def test_web_search_failure_is_a_note_not_a_crash(monkeypatch: pytest.MonkeyPatch) -> None:
    async def broken(query: str, shops: list) -> list[WebHit]:  # type: ignore[type-arg]
        raise WebSearchError("Web search is rate limited, try again in a minute")

    monkeypatch.setattr(search_module, "web_search", broken)
    result = await search_products(ProductSpec(item=["κουβέρτα"]), limit=10)
    assert result.note == "Web search is rate limited, try again in a minute"


@pytest.mark.usefixtures("fake_catalogues")
async def test_web_results_follow_the_same_item_and_exclude_rules(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ikea = next(s for s in SHOPS if s.domain == "ikea.gr")

    async def fake_web(query: str, shops: list) -> list[WebHit]:  # type: ignore[type-arg]
        return [WebHit(url="https://www.ikea.gr/proioda/chair/1/", title="Καρέκλα γραφείου X", shop=ikea),
                WebHit(url="https://www.ikea.gr/proioda/lamp/2/", title="Φωτιστικό Y", shop=ikea),
                WebHit(url="https://www.ikea.gr/proioda/desk/3/", title="Γραφείο Z λευκό", shop=ikea)]  # fmt: skip

    monkeypatch.setattr(search_module, "web_search", fake_web)
    spec = ProductSpec(item=["γραφείο"], keywords=["λευκό"], exclude=["καρέκλα"], shops=["ikea.gr"])
    result = await search_products(spec, limit=40)
    web = [h for h in result.hits if h.source == "web"]
    assert [h.words for h in web] == ["Γραφείο Z λευκό"]
    assert web[0].score == 2.0


async def test_replay_without_recordings_is_a_note_not_a_crash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("REPLAY", "1")
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr(search_module, "saved_catalogue", lambda shop: None)
    result = await search_products(ProductSpec(item=["γραφείο"]), limit=10)
    assert result.hits == []
    assert result.note and "IKEA was not recorded for replay" in result.note


async def test_a_catalogue_not_downloaded_yet_is_skipped_at_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(search_module, "saved_catalogue", lambda shop: None)
    result = await search_products(ProductSpec(item=["γραφείο"], shops=["jysk.gr"]), limit=10)
    assert result.note and "JYSK is not searchable right now" in result.note


async def test_one_missing_catalogue_does_not_stop_the_others(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    by_domain = {c.domain: c for c in _catalogues() if c.domain != "jysk.gr"}
    monkeypatch.setattr(search_module, "saved_catalogue", lambda shop: by_domain.get(shop.domain))
    result = await search_products(ProductSpec(item=["γραφείο"]), limit=4)
    assert {h.retailer for h in result.hits} == {"ikea.gr", "praktiker.gr"}
    assert (
        result.note == "JYSK is not searchable right now: its product list has not been downloaded"
    )


@pytest.mark.usefixtures("fake_catalogues")
@pytest.mark.parametrize("name", ["JYSK", "jysk", "www.jysk.gr", "https://jysk.gr/", "jysk.gr"])
async def test_shop_names_from_the_llm_are_understood(name: str) -> None:
    result = await search_products(ProductSpec(item=["γραφείο"], shops=[name]), limit=10)
    assert {h.retailer for h in result.hits} == {"jysk.gr"}
    assert result.note and "SERPER_API_KEY" in result.note  # only the web-search note


@pytest.mark.usefixtures("fake_catalogues")
async def test_unknown_shop_names_search_everywhere_and_say_so() -> None:
    result = await search_products(ProductSpec(item=["γραφείο"], shops=["Leroy Merlin"]), limit=10)
    assert len({h.retailer for h in result.hits}) > 1
    assert result.note and "Leroy Merlin are not ones we use" in result.note
