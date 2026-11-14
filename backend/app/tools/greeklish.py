"""Greek and Greeklish words reduced to keys that meet however a shop spells them.

Shop URLs spell Greek in Latin letters, inconsistently ("bibliothiki", "bibliotiki",
"sxedia", "schedio"): both queries and slugs become a consonant skeleton ("vltk"),
plus a looser form that keeps vowel sounds for short words ("xali" for χαλί, not "XL").
"""

import re
import unicodedata
from typing import NamedTuple

_GREEK_TO_LATIN = str.maketrans(
    {
        "α": "a", "β": "v", "γ": "g", "δ": "d", "ε": "e", "ζ": "z", "η": "i", "θ": "th",
        "ι": "i", "κ": "k", "λ": "l", "μ": "m", "ν": "n", "ξ": "ks", "ο": "o", "π": "p",
        "ρ": "r", "σ": "s", "ς": "s", "τ": "t", "υ": "y", "φ": "f", "χ": "x", "ψ": "ps",
        "ω": "o",
    }
)  # fmt: skip
# Order matters: multi-letter spellings first.
_SPELLINGS = (
    ("mp", "v"), ("nt", "d"), ("gk", "g"), ("gg", "g"), ("th", "t"), ("ph", "f"),
    ("ch", "x"), ("h", "x"), ("b", "v"), ("ks", "x"), ("w", "o"), ("j", "g"), ("c", "k"),
)  # fmt: skip
_VOWELS = re.compile(r"[aeiouy]")


def latin(text: str) -> str:
    """'Γραφείο' -> 'grafeio'. Accents dropped, Greek transliterated."""
    plain = unicodedata.normalize("NFD", text.lower())
    plain = "".join(c for c in plain if not unicodedata.combining(c))
    return plain.translate(_GREEK_TO_LATIN)


def skeleton(word: str) -> str:
    """'grafeioy', 'γραφείο' -> 'grf'. Numbers are kept as they are."""
    word = latin(word)
    if any(c.isdigit() for c in word):
        return word
    for spelling, sound in _SPELLINGS:
        word = word.replace(spelling, sound)
    word = _VOWELS.sub("", word)
    return re.sub(r"(.)\1+", r"\1", word)  # double letters once


def split_words(text: str) -> list[str]:
    return [w for w in re.split(r"[^\w]+", latin(text)) if w]


_VOWEL_SOUNDS = (
    ("ou", "u"),
    ("oy", "u"),
    ("ei", "i"),
    ("oi", "i"),
    ("ai", "e"),
    ("y", "i"),
)


def loose(word: str) -> str:
    """Like skeleton() but keeps vowel sounds: 'χαλί' -> 'xali', 'XL' -> 'xl'."""
    word = latin(word)
    for spelling, sound in _SPELLINGS + _VOWEL_SOUNDS:
        word = word.replace(spelling, sound)
    return re.sub(r"(.)\1+", r"\1", word)


class Word(NamedTuple):
    skeleton: str
    loose: str


def word_keys(text: str) -> Word:
    return Word(skeleton(text), loose(text))


def index_words(text: str) -> list[Word]:
    """A slug or title as search keys. Catalogues store these, computed once per build."""
    return [word_keys(w) for w in split_words(text)]
