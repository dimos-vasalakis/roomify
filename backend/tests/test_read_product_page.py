import re
from pathlib import Path

import httpx
import pytest

from app.tools import read_product_page as reader
from app.tools.read_product_page import (
    NotAProduct,
    compact_dimensions,
    extract_listing,
    labelled_dimensions,
    parse_price,
    read_product_page,
)
from tests.helpers import mock_http

PAGES = Path(__file__).parent / "fixtures" / "pages"


def fixture(name: str) -> tuple[str, str]:
    html = (PAGES / f"{name}.html").read_text(encoding="utf-8")
    url = re.search(r"<!-- (\S+)", html)
    assert url
    return url.group(1), html


# Facts as printed on the real pages when the fixtures were saved.
@pytest.mark.parametrize(
    ("name", "shop", "title", "price", "dims", "in_stock"),
    [
        ("ikea_mittzon_desk", "IKEA", "MITTZON γραφείο, 140x80 cm", 219.0, (140, 80, 85), True),
        ("jysk_oure_drawers", "JYSK", "Συρταριέρα 3 καλάθια OURE λευκό", 65.0, (36, 37, 76), None),
        ("praktiker_cloe_chair", "Praktiker", "Καρέκλα Cloe M56xΠ48xY76cm Μπορντό", 54.9, (56, 48, 76), False),
        ("plaisio_sitzix_chair", "Plaisio", "@Work Καρέκλα Γραφείου Sitzix", 49.0, (None, None, None), True),
        ("pepco_runner", "Pepco", "Κεντητό ράνερ - Pepco", 5.0, (None, None, None), None),
    ],
)  # fmt: skip
def test_real_shop_pages(name: str, shop: str, title: str, price: float,
                         dims: tuple[float | None, ...], in_stock: bool | None) -> None:  # fmt: skip
    url, html = fixture(name)
    listing = extract_listing(url, html)
    assert listing.shop_name == shop
    assert listing.title == title
    assert listing.price_eur == price
    assert (listing.width_cm, listing.depth_cm, listing.height_cm) == dims
    assert listing.in_stock is in_stock
    assert listing.image_url.startswith("https://")
    # Every fact shown must point at the page text it came from.
    for field in ("title", "price_eur", "image_url"):
        assert listing.evidence[field]
    for field, value in (("width_cm", dims[0]), ("depth_cm", dims[1]), ("height_cm", dims[2])):
        assert (field in listing.evidence) == (value is not None)


def test_ikea_packaging_sizes_are_not_product_sizes() -> None:
    url, html = fixture("ikea_mittzon_desk")
    listing = extract_listing(url, html)
    assert listing.evidence["width_cm"] == "Πλάτος: 140 cm"
    assert "Μέγιστο ύψος" in listing.evidence["height_cm"]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [(219.0, 219.0), ("65", 65.0), ("1.234,50", 1234.5), ("1,234.50", 1234.5),
     ("€ 59,99", 59.99), ("12,5", 12.5), ("1,299", 1299.0), ("1.299", 1299.0),
     ("1.299,00", 1299.0), ("2.5", 2.5), ("0", None), ("", None),
     (None, None), ("free", None), (-5, None)],
)  # fmt: skip
def test_parse_price(raw: object, expected: float | None) -> None:
    assert parse_price(raw) == expected


@pytest.mark.parametrize(("raw", "expected"), [("59.9", 59.9), ("219.00", 219.0), ("65", 65.0),
                                               ("1.234,50", 1234.5),
                                               ("1.299", 1299.0)])  # never €1.30  # fmt: skip
def test_structured_prices_use_a_dot_for_decimals(raw: str, expected: float) -> None:
    assert parse_price(raw, structured=True) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Πλάτος: 140 cm Βάθος: 80 cm Μέγιστο ύψος: 85 cm Ελάχιστο ύψος: 65 cm",
         {"width": 140, "depth": 80, "height": 85}),
        ("Μήκος: 120 cm Πλάτος: 80 cm Ύψος: 76 cm", {"width": 120, "depth": 80, "height": 76}),
        ("Διάμετρος: 100 cm Ύψος: 75 cm", {"width": 100, "depth": 100, "height": 75}),
        ("Πλάτος: 1200 mm Βάθος: 0,6 m", {"width": 120, "depth": 60}),
        ("Width: 90 cm Depth: 45 cm", {"width": 90, "depth": 45}),
        ("Διαστάσεις Συσκευασίας Πλάτος: 31 cm", {}),
        ("Πλάτος: 40 cm Μέγεθος ασυναρμολόγητο Βάθος: 81 cm", {"width": 40}),
        ("Ελάχιστο ύψος: 65 cm Μέγιστο ύψος: 85 cm", {"height": 85}),  # never the minimum
        ("Seat width: 45 cm Width: 60 cm", {"width": 60}),  # never a part of the product
        ("Ύψος καθίσματος: 45 cm Ύψος: 80 cm", {"height": 80}),
        ("Συνολικό πλάτος: 90 cm", {"width": 90}),
    ],
)  # fmt: skip
def test_labelled_dimensions(text: str, expected: dict[str, float]) -> None:
    found, evidence = labelled_dimensions(text)
    assert found == expected
    assert set(evidence) == set(expected)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Μασίφ ξύλο και MDF. Π36 x Υ76 x Β37 cm", {"width": 36, "depth": 37, "height": 76}),
        ("Καρέκλα Cloe M56xΠ48xY76cm Μπορντό", {"width": 56, "depth": 48, "height": 76}),
        ("Γραφείο Forma Μ120xΠ60xΥ75cm Λευκό", {"width": 120, "depth": 60, "height": 75}),
        ("Lotus 160x40x80εκ", {"width": 160, "depth": 40, "height": 80}),
        ("MITTZON γραφείο, 140x80 cm", {"width": 140, "depth": 80}),
        ("Σταντ 55 x 90mm", {"width": 5.5, "depth": 9}),
        ("Τραπέζι Ø100 λευκό", {}),
        ("Πακέτο 3x2 τεμάχια", {}),
        ("Διαστάσεις συσκευασίας 120x60x10 cm. Γραφείο 100x50x75 cm", {}),  # box, not product
        ("Γραφείο 100x50x75 cm. Διαστάσεις συσκευασίας 120x60x10 cm",
         {"width": 100, "depth": 50, "height": 75}),
    ],
)  # fmt: skip
def test_compact_dimensions(text: str, expected: dict[str, float]) -> None:
    assert compact_dimensions(text)[0] == expected


def _page(product: str = "", metas: str = "") -> str:
    ld = f'<script type="application/ld+json">{product}</script>' if product else ""
    return f"<html><head>{metas}{ld}</head><body><p>text</p></body></html>"


IKEA_URL = "https://www.ikea.gr/proioda/x/123/"


def test_price_from_og_tags_when_no_structured_data() -> None:
    metas = ('<meta property="og:title" content="Κερί">'
             '<meta property="og:image" content="https://img/x.jpg">'
             '<meta property="product:price:amount" content="7,50">'
             '<meta property="product:price:currency" content="EUR">')  # fmt: skip
    listing = extract_listing(IKEA_URL, _page(metas=metas))
    assert (listing.title, listing.price_eur) == ("Κερί", 7.5)


@pytest.mark.parametrize(
    ("product", "message"),
    [
        ('{"@type":"Product","name":"X","image":"https://i/x.jpg"}', "No price"),
        ('{"@type":"Product","name":"X","offers":{"price":"10","priceCurrency":"EUR"}}', "No product photo"),
        ('{"@type":"Organization","name":"Shop"}', "No product found"),
    ],
)  # fmt: skip
def test_pages_that_are_not_usable_products(product: str, message: str) -> None:
    with pytest.raises(NotAProduct, match=message):
        extract_listing(IKEA_URL, _page(product))


def test_product_inside_graph_and_offer_list() -> None:
    product = ('{"@graph":[{"@type":"WebPage"},{"@type":["Product"],"name":"Λάμπα",'
               '"image":[{"url":"https://i/1.jpg"}],"offers":[{"price":12,"priceCurrency":"EUR",'
               '"availability":"https://schema.org/OutOfStock"}]}]}')  # fmt: skip
    listing = extract_listing(IKEA_URL, _page(product))
    assert (listing.title, listing.price_eur, listing.in_stock) == ("Λάμπα", 12.0, False)
    assert listing.image_url == "https://i/1.jpg"


def test_broken_json_ld_is_skipped() -> None:
    html = '<script type="application/ld+json">{oops</script>' + _page(
        '{"@type":"Product","name":"X","image":"https://i/x.jpg","offers":{"price":3}}'
    )
    assert extract_listing(IKEA_URL, html).price_eur == 3.0


def test_any_shop_is_read_in_its_own_currency() -> None:
    product = '{"@type":"Product","name":"Lamp","image":"https://i/x.jpg","offers":{"price":"89.99","priceCurrency":"USD"}}'
    metas = '<meta property="og:site_name" content="CB2">'
    listing = extract_listing("https://www.cb2.com/lamp/s123", _page(product, metas=metas))
    assert (listing.retailer, listing.shop_name) == ("cb2.com", "CB2")
    assert (listing.price_eur, listing.currency) == (89.99, "USD")


def test_a_price_without_a_currency_is_refused_outside_our_shops() -> None:
    product = '{"@type":"Product","name":"Lamp","image":"https://i/x.jpg","offers":{"price":"89"}}'
    with pytest.raises(NotAProduct, match="which currency"):
        extract_listing("https://shop.example.com/lamp", _page(product))


def test_inch_sizes_become_centimetres() -> None:
    dims, _ = labelled_dimensions('Width: 30" Depth: 32 in Height: 36 inches')
    assert dims == {"width": 76.2, "depth": 81.3, "height": 91.4}


@pytest.mark.parametrize(
    "url", ["http://localhost:8000/x", "http://127.0.0.1/x", "http://169.254.169.254/latest",
            "http://10.0.0.5/p", "http://intranet/p"],
)  # fmt: skip
async def test_private_addresses_are_never_requested(
    monkeypatch: pytest.MonkeyPatch, url: str
) -> None:
    requests = mock_http(monkeypatch, lambda r: httpx.Response(200))
    result = await read_product_page(url)
    assert result.listing is None and result.error == "Not a valid web address"
    assert requests == []


async def test_network_errors_are_reported_and_not_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    url, html = fixture("ikea_mittzon_desk")
    attempts = 0

    async def flaky(_url: str) -> str:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            from app.tools.web_fetch import FetchError

            raise FetchError("ikea.gr took too long to answer")
        return html

    monkeypatch.setattr(reader, "fetch_text", flaky)
    first = await read_product_page(url)
    assert first.error == "ikea.gr took too long to answer"
    second = await read_product_page(url)
    assert second.listing is not None and second.listing.price_eur == 219.0
    third = await read_product_page(url)  # from cache now
    assert third == second and attempts == 2


async def test_replay_without_recording_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REPLAY", "1")
    from app.config import get_settings

    get_settings.cache_clear()
    result = await read_product_page("https://www.ikea.gr/proioda/x/123/")
    assert result.error == "This page was not recorded for replay"


def test_sizes_from_labels_and_title_are_merged() -> None:
    product = ('{"@type":"Product","name":"Γραφείο 120x60 cm","image":"https://i/x.jpg",'
               '"offers":{"price":99,"priceCurrency":"EUR"}}')  # fmt: skip
    html = _page(product).replace("<p>text</p>", "<p>Ύψος: 76 cm</p>")
    listing = extract_listing(IKEA_URL, html)
    assert (listing.width_cm, listing.depth_cm, listing.height_cm) == (120, 60, 76)
    assert listing.evidence["height_cm"] == "Ύψος: 76 cm"
    assert listing.evidence["width_cm"] == "120x60 cm"


GROUP = ('{"@type":"ProductGroup","name":"Κρεβάτι","image":"https://i/bed.jpg","hasVariant":['
         '{"@type":"Product","sku":"9020","url":"https://www.ikea.gr/proioda/bed-90/9020/",'
         '"offers":{"price":199,"priceCurrency":"EUR"}},'
         '{"@type":"Product","sku":"1620","url":"https://www.ikea.gr/proioda/bed-160/1620/",'
         '"offers":{"price":299,"priceCurrency":"EUR"}}]}')  # fmt: skip


def test_variant_is_the_one_the_link_shows() -> None:
    listing = extract_listing("https://www.ikea.gr/proioda/bed-160/1620/", _page(GROUP))
    assert (listing.title, listing.price_eur, listing.image_url) == (
        "Κρεβάτι",
        299.0,
        "https://i/bed.jpg",
    )


def test_variant_that_cannot_be_told_apart_is_refused() -> None:
    with pytest.raises(NotAProduct, match="several sizes or colours"):
        extract_listing("https://www.ikea.gr/proioda/bed/7777/", _page(GROUP))


async def test_malformed_address_never_raises() -> None:
    result = await read_product_page("https://[broken/x")
    assert result.listing is None and result.error == "Not a valid web address"


def test_meta_values_keep_apostrophes() -> None:
    metas = ('<meta property="og:title" content="Kid\'s desk 120cm">'
             '<meta property="og:image" content="https://img/x.jpg">'
             "<meta content='12.50' property='product:price:amount'>")  # fmt: skip
    listing = extract_listing(IKEA_URL, _page(metas=metas))
    assert (listing.title, listing.price_eur) == ("Kid's desk 120cm", 12.5)


def test_judge_excerpt_contains_every_fact_even_far_down_the_page() -> None:
    product = ('{"@type":"Product","name":"Γραφείο X","image":"https://i/x.jpg",'
               '"offers":{"price":99,"priceCurrency":"EUR"}}')  # fmt: skip
    filler = "<p>" + "μενού " * 3000 + "</p>"
    html = _page(product).replace("<p>text</p>", f"<p>Γραφείο X</p>{filler}<p>Πλάτος: 120 cm</p>")
    listing = extract_listing(IKEA_URL, html)
    assert listing.width_cm == 120
    assert "Γραφείο X" in listing.page_text and "Πλάτος: 120 cm" in listing.page_text
    assert len(listing.page_text) < 2000  # windows, not the whole menu


def test_the_word_package_in_a_menu_does_not_hide_sizes() -> None:
    assert labelled_dimensions("Package tracking | Πλάτος: 80 cm")[0] == {"width": 80}


@pytest.mark.parametrize(
    ("title", "known"), [("Χαλί 160x230 cm", False), ("Καρέκλα M56xΠ48xY76cm", True)]
)
def test_unlabelled_sizes_are_marked_as_order_unknown(title: str, known: bool) -> None:
    product = (f'{{"@type":"Product","name":"{title}","image":"https://i/x.jpg",'
               '"offers":{"price":99,"priceCurrency":"EUR"}}')  # fmt: skip
    assert extract_listing(IKEA_URL, _page(product)).sizes_order_known is known


async def test_shop_down_falls_back_to_the_last_good_read(monkeypatch: pytest.MonkeyPatch) -> None:
    url, html = fixture("ikea_mittzon_desk")

    async def up(_url: str) -> str:
        return html

    monkeypatch.setattr(reader, "fetch_text", up)
    first = await read_product_page(url)
    assert first.listing and not first.from_saved_copy

    import time

    later = time.time() + 3 * 24 * 3600  # the saved read is now too old to reuse as is
    monkeypatch.setattr(time, "time", lambda: later)

    async def down(_url: str) -> str:
        from app.tools.web_fetch import FetchError

        raise FetchError("ikea.gr took too long to answer", transient=True)

    monkeypatch.setattr(reader, "fetch_text", down)
    second = await read_product_page(url)
    assert second.from_saved_copy and second.listing == first.listing

    async def gone(_url: str) -> str:
        from app.tools.web_fetch import FetchError

        raise FetchError("Page no longer exists", 404)

    monkeypatch.setattr(reader, "fetch_text", gone)
    third = await read_product_page(url)  # removed from the shop: no old price may stand in
    assert third.listing is None and third.error == "Page no longer exists"


def test_price_range_is_not_taken_as_the_price() -> None:
    product = ('{"@type":"Product","name":"Ντουλάπα","image":"https://i/x.jpg","offers":'
               '{"@type":"AggregateOffer","lowPrice":"149.00","highPrice":"329.00","priceCurrency":"EUR"}}')  # fmt: skip
    with pytest.raises(NotAProduct, match="price range"):
        extract_listing(IKEA_URL, _page(product))


def test_single_price_aggregate_offer_is_fine() -> None:
    product = ('{"@type":"Product","name":"Ντουλάπα","image":"https://i/x.jpg","offers":'
               '{"@type":"AggregateOffer","lowPrice":"149.00","highPrice":"149.00","priceCurrency":"EUR"}}')  # fmt: skip
    assert extract_listing(IKEA_URL, _page(product)).price_eur == 149.0


def test_sizes_with_thousands_are_not_half_read() -> None:
    assert compact_dimensions("Πάγκος 1.200x800 mm")[0] == {}


async def test_not_a_product_is_retried_after_an_hour(monkeypatch: pytest.MonkeyPatch) -> None:
    import time

    calls = 0

    async def fetch(_url: str) -> str:
        nonlocal calls
        calls += 1
        return "<html>please wait, checking your browser</html>"

    monkeypatch.setattr(reader, "fetch_text", fetch)
    url = "https://www.ikea.gr/proioda/x/123/"
    assert (await read_product_page(url)).error == "No product found on this page"
    await read_product_page(url)
    assert calls == 1  # kept for a while...
    later = time.time() + 2 * 3600
    monkeypatch.setattr(time, "time", lambda: later)
    await read_product_page(url)
    assert calls == 2  # ...but not for a day


async def test_unexpected_failure_is_a_plain_error(monkeypatch: pytest.MonkeyPatch) -> None:
    async def broken(_url: str) -> str:
        raise OSError("No space left on device")

    monkeypatch.setattr(reader, "fetch_text", broken)
    result = await read_product_page("https://www.ikea.gr/proioda/x/123/")
    assert result.listing is None and result.error == "Could not read this page"


def test_a_guessed_height_does_not_make_labelled_sizes_turnable() -> None:
    product = ('{"@type":"Product","name":"Γραφείο 160x60x75 εκ","image":"https://i/x.jpg",'
               '"offers":{"price":99,"priceCurrency":"EUR"}}')  # fmt: skip
    html = _page(product).replace("<p>text</p>", "<p>Πλάτος: 160 εκ Βάθος: 60 εκ</p>")
    listing = extract_listing(IKEA_URL, html)
    assert (listing.width_cm, listing.depth_cm, listing.height_cm) == (160, 60, 75)
    assert listing.sizes_order_known is True


def test_variant_codes_match_whole_ids_only() -> None:
    group = ('{"@type":"ProductGroup","name":"X","image":"https://i/x.jpg","hasVariant":['
             '{"@type":"Product","sku":"1234","offers":{"price":99,"priceCurrency":"EUR"}},'
             '{"@type":"Product","sku":"5678","offers":{"price":199,"priceCurrency":"EUR"}}]}')  # fmt: skip
    with pytest.raises(NotAProduct, match="several sizes"):
        extract_listing("https://www.ikea.gr/proioda/x/91234567/", _page(group))
    assert extract_listing("https://www.ikea.gr/proioda/x/5678/", _page(group)).price_eur == 199
