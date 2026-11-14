"""Keep only search hits that ARE the requested item, best match first.

Word matching cannot tell senses apart: "πίνακας" is a painting, a whiteboard, a
bulletin board and an electrical panel; "κουρτίνα" also finds curtain wire and shower
rails. One quick text-only LLM pass reads the product names and drops the wrong sense,
with a short reason the live feed can show. If the LLM is unavailable or slow, the
word-matching order is kept, so search never fails because of this step.
"""

import asyncio
import logging

from pydantic import BaseModel, ValidationError

from app.cache import ReplayMiss
from app.llm import LLMError, llm, llm_available

log = logging.getLogger("roomify")
TIMEOUT_S = 25.0

PROMPT = """You shortlist products for an interior designer. The person wants ONE kind of item:
{want}
Below are product names from Greek furniture and decor shops, mostly Greek written in Latin
letters ("pinakas" = πίνακας, "kadro" = κάδρο, "koyrtina" = κουρτίνα, "fotistiko" = φωτιστικό).
Brand words such as BLODFLADER, PJATTERYD, MOSEBY or GOOMBY are product names, not meanings.
Decide for each name whether it IS that item, as a person furnishing a room means it.
Reject: a different item that shares a word (a whiteboard, cork, bulletin, magnetic or drawing
board is not a painting; an electrical panel is not a painting), parts and accessories (rails,
wire, rings, hooks, linings, bulbs, frames without art when art is wanted), children's toys and
office supplies unless asked for, and pieces for a different room (shower curtain for a window).
Then order the kept ones best first: closest to the request and its style words, varied
designs and shops near the top rather than many sizes of one model.
Return JSON only: {{"keep":[<numbers, best first, at most {limit}>],
"rejected":[{{"n":<number>,"why":"<at most 8 plain English words, e.g. 'Bulletin board, not wall art'>"}}]}}
List at most 6 rejected names, the most tempting wrong ones.
Names:
{names}"""


class _Rejected(BaseModel):
    n: int
    why: str


class _Verdict(BaseModel):
    keep: list[int]
    rejected: list[_Rejected] = []


class Relevance(BaseModel):
    keep: list[int]  # indices into the names, best first
    rejected: dict[int, str]  # index -> plain reason
    checked: bool  # False when the LLM was not asked or did not answer


def describe(item: list[str], keywords: list[str], meaning: str | None) -> str:
    parts = [f'"{meaning}"' if meaning else "", "Greek: " + " / ".join(item)]
    if keywords:
        parts.append("style words: " + ", ".join(keywords))
    return "; ".join(p for p in parts if p)


async def relevant(want: str, names: list[str], limit: int) -> Relevance:
    """Which of `names` are the wanted item. Never raises."""
    unchecked = Relevance(keep=list(range(len(names))), rejected={}, checked=False)
    if not names or not llm_available():
        return unchecked
    listing = "\n".join(f"{i}. {n}" for i, n in enumerate(names))
    prompt = PROMPT.format(want=want, limit=limit, names=listing)
    try:
        raw = await asyncio.wait_for(llm(prompt, json_out=True), TIMEOUT_S)
        verdict = _Verdict.model_validate(raw)
    except (LLMError, ReplayMiss, TimeoutError, ValidationError, TypeError) as exc:
        log.warning("Relevance check skipped (%s)", type(exc).__name__)
        return unchecked
    valid = range(len(names))
    keep = list(dict.fromkeys(i for i in verdict.keep if i in valid))[:limit]
    rejected = {
        r.n: r.why.strip().rstrip(".")[:80]
        for r in verdict.rejected
        if r.n in valid and r.n not in keep and r.why.strip()
    }
    return Relevance(keep=keep, rejected=rejected, checked=True)
