"""The one way a judge reaches Oumi: its hosted inference API (OpenAI-compatible), with the
deployment named in OUMI_JUDGE_MODEL. Without a key and a deployment, or when Oumi fails,
the same judge prompt goes through llm(), so a judge never stops a run."""

import json
import logging
import os
import re
from typing import Any

import httpx
from pydantic import BaseModel

from app.cache import cached
from app.llm import LLMError, llm

URL = "https://inference.oumi.ai/v1/chat/completions"
TIMEOUT = httpx.Timeout(45.0, connect=5.0)
log = logging.getLogger("roomify.oumi")


class OumiText(BaseModel):
    text: str


def _key() -> str | None:
    return (os.getenv("OUMI_API_KEY") or "").strip().strip("'\"") or None


async def _ask(prompt: str, model: str, key: str) -> OumiText:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(
                URL,
                headers={"X-API-Key": key},
                json={"model": model, "temperature": 0, "max_tokens": 2000,
                      "messages": [{"role": "system", "content": "Return only valid JSON."},
                                   {"role": "user", "content": prompt}]},
            )  # fmt: skip
    except httpx.HTTPError as exc:
        raise LLMError("The Oumi judge did not answer.") from exc
    if response.status_code >= 400:
        raise LLMError(f"The Oumi judge failed (HTTP {response.status_code}).")
    try:
        return OumiText(text=response.json()["choices"][0]["message"]["content"] or "")
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise LLMError("The Oumi judge sent back something unreadable.") from exc


def _json(text: str) -> Any:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
    found = re.search(r"\{.*\}", text, re.DOTALL)
    return json.loads(found.group(0) if found else text)


async def judge(prompt: str) -> tuple[Any, str]:
    """(parsed JSON verdict, who judged: "oumi" or "llm")."""
    key, model = _key(), os.getenv("OUMI_JUDGE_MODEL")
    if key and model:
        try:
            answer = await cached("oumi", {"model": model, "prompt": prompt},
                                  lambda: _ask(prompt, model, key), OumiText)  # fmt: skip
            return _json(answer.text), "oumi"
        except (LLMError, ValueError) as exc:
            log.warning("Oumi judge unavailable (%s); judging through llm()", exc)
    return await llm(prompt, json_out=True), "llm"
