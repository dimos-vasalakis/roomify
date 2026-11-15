"""Does the chosen basket do what the room assessment asked, for that person? Through Oumi
when it is configured (judges/oumi.py). Never stops a run: no verdict is said as none."""

import json
import logging
import re
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from app.judges.oumi import judge
from app.llm import LLMError
from app.tools.analyse_room import Assessment
from app.tools.read_product_page import ProductListing

log = logging.getLogger("roomify.story")
PROMPT = Path(__file__).with_suffix(".yaml").read_text().removeprefix("|").strip()


class Covered(BaseModel):
    need: str
    by: str


class StoryVerdict(BaseModel):
    covered: list[Covered] = Field(default=[], max_length=10)
    unclear: list[str] = Field(default=[], max_length=10)
    open: list[str] = Field(default=[], max_length=10)
    risks: list[str] = Field(default=[], max_length=6)
    verdict: str = ""
    judged_by: str = "llm"

    @field_validator("unclear", "open", "risks", mode="before")
    @classmethod
    def _plain(cls, value: Any) -> Any:
        """Models sometimes answer {"need": ...} where a plain phrase was asked for."""
        if not isinstance(value, list):
            return value
        return [v.get("need") or v.get("risk") or next(iter(v.values()), "")
                if isinstance(v, dict) else v for v in value][:10]  # fmt: skip

    @field_validator("covered", mode="before")
    @classmethod
    def _cap(cls, value: Any) -> Any:
        return value[:10] if isinstance(value, list) else value

    @model_validator(mode="after")
    def _one_list_each(self) -> "StoryVerdict":
        """A need is covered or in doubt, never both; a bare size is not a risk."""
        doubted = {n.strip().lower() for n in [*self.unclear, *self.open]}
        self.covered = [c for c in self.covered if c.need.strip().lower() not in doubted]
        self.risks = [r for r in self.risks if len(re.findall(r"[^\W\d_]{3,}", r)) >= 2]
        return self


def _size(p: ProductListing) -> str:
    dims = [
        f"{n} {v:g} cm" for n, v in (("W", p.width_cm), ("D", p.depth_cm), ("H", p.height_cm)) if v
    ]
    return " × ".join(dims) or "not listed"


async def judge_story(
    assessment: Assessment, chosen: dict[str, ProductListing], removed: list[str]
) -> StoryVerdict | None:
    data = {
        "who": assessment.who,
        "findings": [f.model_dump(exclude={"box_2d"}) for f in assessment.findings],
        "chosen": [
            {"slot": slot, "title": p.title, "size": _size(p)} for slot, p in chosen.items()
        ],
        "taken_out": removed,
        "advice_given": assessment.advice,
    }
    try:
        raw, by = await judge(PROMPT + "\n" + json.dumps(data, ensure_ascii=False))
        return StoryVerdict.model_validate(raw).model_copy(update={"judged_by": by})
    except (LLMError, ValidationError, ValueError) as exc:
        log.warning("Story judge gave no verdict (%s)", type(exc).__name__)
        return None
