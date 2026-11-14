"""The one function every LLM call goes through (CLAUDE.md). Swap the provider here only.

Gemini through google-genai. Needs GEMINI_API_KEY; GEMINI_MODEL picks the model.
"""

import asyncio
import json
import logging
import os
from typing import Any

from google import genai
from google.genai import types

import app.config  # noqa: F401  loads backend/.env

DEFAULT_MODEL = "gemini-flash-latest"
log = logging.getLogger("roomify.llm")
TIMEOUT_S = 45.0


class LLMError(Exception):
    """Plain words for the live feed."""


def llm_available() -> bool:
    return bool(os.getenv("GEMINI_API_KEY"))


async def llm(prompt: str, images: list[tuple[bytes, str]] | None = None, json_out: bool = False) -> Any:
    """Text (or parsed JSON when `json_out`) from the model. `images`: (bytes, mime type) pairs."""
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise LLMError("The AI is not configured on the server (GEMINI_API_KEY).")
    client = genai.Client(api_key=key)
    parts: list[Any] = [types.Part.from_bytes(data=data, mime_type=mime) for data, mime in images or []]
    parts.append(prompt)
    config = types.GenerateContentConfig(
        temperature=0.2,
        response_mime_type="application/json" if json_out else "text/plain",
    )
    try:
        response = await asyncio.wait_for(
            client.aio.models.generate_content(
                model=os.getenv("GEMINI_MODEL", DEFAULT_MODEL), contents=parts, config=config
            ),
            TIMEOUT_S,
        )
    except TimeoutError as exc:
        raise LLMError("The AI took too long to answer.") from exc
    except Exception as exc:  # provider errors: rate limits, bad key, outages, unknown model
        log.warning("LLM call failed: %s: %s", exc.__class__.__name__, str(exc)[:300])
        raise LLMError(f"The AI could not answer ({exc.__class__.__name__}).") from exc
    text = response.text or ""
    if not json_out:
        return text
    try:
        return json.loads(text)
    except ValueError as exc:
        raise LLMError("The AI answered in a shape we could not read.") from exc
