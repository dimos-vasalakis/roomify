from app.judges.fit import fit_proofs, together
from tests.test_find_products import listing


def piece(pid: str, width: float | None, sourced: bool = True):  # type: ignore[no-untyped-def]
    evidence = {"width_cm": f"Width: {width} cm"} if sourced and width else {}
    return listing(f"https://shop.example.com/{pid}", id=pid, width_cm=width, evidence=evidence)


def test_spare_room_tight_fit_and_too_wide() -> None:
    chosen = {"Desk": piece("d", 140), "Shelf": piece("s", 315), "Sofa": piece("f", 330)}
    proofs = {p.product_id: p for p in fit_proofs(chosen, 320)}
    assert (
        proofs["d"].lines == ["Desk: 140 cm on your 320 cm wall, 180 cm to spare"]
        and proofs["d"].ok
    )
    assert "tight fit (5 cm to spare)" in proofs["s"].lines[0]
    assert not proofs["f"].ok and "10 cm more than your 320 cm wall" in proofs["f"].lines[0]


def test_only_what_the_page_proves() -> None:
    chosen = {"Lamp": piece("l", None), "Rug": piece("r", 160, sourced=False)}
    assert fit_proofs(chosen, 320) == []  # no size, or a size with no page snippet: silent
    assert fit_proofs({"Desk": piece("d", 140)}, None) == []  # no wall width: silent


def test_pieces_together() -> None:
    chosen = {"Desk": piece("d", 140), "Bookcase": piece("b", 80), "Lamp": piece("l", None)}
    assert (
        together(chosen, 320) == "Side by side the desk and the bookcase take 220 of your 320 cm."
    )
    assert together(chosen, 200).endswith("so they can't all stand along it.")
    assert together({"Desk": piece("d", 140)}, 320) is None
