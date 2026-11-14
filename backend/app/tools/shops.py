"""The shops the agent may buy from. Priority 1 is searched and shown first.

To add a shop: check its product pages carry schema.org Product data (or og:price
tags) and that robots.txt allows them, then add an entry. If RETAILERS is set, add the domain
there too (empty RETAILERS means every shop here).
"""

import re
from urllib.parse import urlsplit

from pydantic import BaseModel

from app.config import get_settings


class Shop(BaseModel):
    domain: str  # without www.
    name: str
    priority: int  # 1 first
    sitemaps: list[str]
    # A URL counts as a product page only if it matches this.
    product_url: str
    # Keep only sub-sitemaps whose URL matches this (shops that sell far more than home goods).
    sitemap_filter: str | None = None
    # Only sitemap entries with <image:image> are products (shops that list categories too).
    sitemap_image_required: bool = False


SHOPS: tuple[Shop, ...] = (
    Shop(
        domain="ikea.gr",
        name="IKEA",
        priority=1,
        sitemaps=["https://www.ikea.gr/sitemap/Products/sitemap_index.xml"],
        product_url=r"^https://www\.ikea\.gr/proioda/[^/]+/\d+/?$",
    ),
    Shop(
        domain="jysk.gr",
        name="JYSK",
        priority=1,
        sitemaps=["https://jysk.gr/sitemap.xml"],
        # category/sub-category/product-slug; inspiration articles are not products
        product_url=r"^https://jysk\.gr/(?!inspiration/|stores-locator/)[^/?#]+/[^/?#]+/[^/?#]+(/[^/?#]+)?$",
        sitemap_image_required=True,
    ),
    Shop(
        domain="praktiker.gr",
        name="Praktiker",
        priority=2,
        sitemaps=["https://www.praktiker.gr/media/sitemap/Auto/SitemapCollection.xml"],
        product_url=r"^https://www\.praktiker\.gr/p/[^/?#]+$",
        sitemap_filter=r"(epipla|eidi-spitiou-diakosmisi|ilektrologika-fotismos|mpanio-kouzina)\.xml$",
    ),
    Shop(
        domain="plaisio.gr",
        name="Plaisio",
        priority=2,
        sitemaps=[
            "https://res.plaisio.gr/raw/upload/Sitemaps/B2C-Sitemaps/sitemap_products_plaisio-webshop-gr.xml"
        ],
        product_url=r"^https://www\.plaisio\.gr/product/karekles-epipla/",
    ),
    Shop(
        domain="pepco.gr",
        name="Pepco",
        priority=3,
        sitemaps=["https://pepco.gr/sitemap.xml"],
        product_url=r"^https://pepco\.gr/products/[^/?#]+$",
        sitemap_filter=r"products",
    ),
)


def enabled_shops() -> list[Shop]:
    """Shops listed in RETAILERS, best priority first. Empty RETAILERS means all."""
    wanted = get_settings().retailers
    shops = [s for s in SHOPS if not wanted or s.domain in wanted]
    return sorted(shops, key=lambda s: s.priority)


def host_of(url: str) -> str:
    """'https://www.IKEA.gr/x' -> 'ikea.gr'; '' for an address that cannot be read."""
    try:
        return (urlsplit(url).hostname or "").lower().removeprefix("www.")
    except ValueError:
        return ""


def shop_for_url(url: str) -> Shop | None:
    host = host_of(url)
    return next((s for s in enabled_shops() if host == s.domain), None)


def is_product_url(shop: Shop, url: str) -> bool:
    return re.search(shop.product_url, url) is not None
