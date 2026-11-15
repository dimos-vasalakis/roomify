"""Fit maths for the pieces whose size the shop's page gives, against the wall the person
measured or confirmed. A rule judge (no model call): it signs off only what it can prove,
and stays silent about pieces without a listed size instead of guessing."""

from pydantic import BaseModel

from app.tools.read_product_page import ProductListing

TIGHT_CM = 10  # less spare than this is called tight


class FitProof(BaseModel):
    product_id: str
    ok: bool
    lines: list[str]  # plain words for the feed and the shopping list


def _cm(value: float) -> str:
    return f"{value:g} cm"


def _sourced_width(p: ProductListing) -> float | None:
    """The width only if the page snippet it came from is on record: the judge's rule."""
    if p.width_cm and any(k.startswith("width") for k in p.evidence):
        return p.width_cm
    return None


def fit_proofs(chosen: dict[str, ProductListing], wall_cm: float | None) -> list[FitProof]:
    """One proof per piece with a sourced width, plus how much wall the pieces take together."""
    if not wall_cm:
        return []
    proofs = []
    for slot, p in chosen.items():
        width = _sourced_width(p)
        if width is None:
            continue
        spare = wall_cm - width
        if spare < 0:
            line = f"{slot}: {_cm(width)} wide, {_cm(-spare)} more than your {_cm(wall_cm)} wall"
        elif spare < TIGHT_CM:
            line = f"{slot}: {_cm(width)} on your {_cm(wall_cm)} wall, a tight fit ({_cm(spare)} to spare)"
        else:
            line = f"{slot}: {_cm(width)} on your {_cm(wall_cm)} wall, {_cm(spare)} to spare"
        proofs.append(FitProof(product_id=p.id, ok=spare >= 0, lines=[line]))
    return proofs


def together(chosen: dict[str, ProductListing], wall_cm: float | None) -> str | None:
    """'Together the desk and the bookcase take 210 of your 320 cm' when two or more are sized."""
    sized = {slot: w for slot, p in chosen.items() if (w := _sourced_width(p))}
    if not wall_cm or len(sized) < 2:
        return None
    total = sum(sized.values())
    names = " and the ".join(slot.lower() for slot in sized)
    verdict = "" if total <= wall_cm else ", so they can't all stand along it"
    return f"Side by side the {names} take {total:g} of your {_cm(wall_cm)}{verdict}."
