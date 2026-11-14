"""The one function every LLM call goes through (CLAUDE.md). Swap the provider here only.

Gemini directly when configured, otherwise vision through the existing fal key.
All requests are cached, including the model and image hashes.
"""

import asyncio
import base64
import hashlib
import json
import logging
import os
from typing import Any

from google import genai
from google.genai import types
from pydantic import BaseModel

import app.config  # noqa: F401  loads backend/.env
from app.cache import cached
from app.tools.fal_client import FalError, fal

DEFAULT_MODEL = "gemini-flash-latest"
log = logging.getLogger("roomify.llm")
TIMEOUT_S = 45.0


class LLMError(Exception):
    """Plain words for the live feed."""


def llm_available() -> bool:
    return bool(os.getenv("GEMINI_API_KEY") or os.getenv("FAL_KEY"))


class LLMText(BaseModel):
    text: str


async def llm(
    prompt: str, images: list[tuple[bytes, str]] | None = None, json_out: bool = False
) -> Any:
    """Text (or parsed JSON when `json_out`) from the model. `images`: (bytes, mime type) pairs."""
    key = os.getenv("GEMINI_API_KEY")
    model = (
        os.getenv("GEMINI_MODEL") or DEFAULT_MODEL
        if key
        else os.getenv("FAL_LLM_MODEL") or "google/gemini-2.5-flash"
    )

    async def call() -> LLMText:
        if not key:
            if not os.getenv("FAL_KEY"):
                raise LLMError(
                    "Room planning is unavailable. Configure the design service on the backend."
                )
            refs = [
                f"data:{mime};base64,{base64.b64encode(data).decode()}"
                for data, mime in images or []
            ]
            try:
                result = await fal(
                    "openrouter/router/vision" if refs else "openrouter/router",
                    {
                        "model": model,
                        "prompt": prompt,
                        "system_prompt": "Return only valid JSON, no markdown."
                        if json_out
                        else "Be concise.",
                        "temperature": 0.2,
                        "max_tokens": 6000,
                        **({"image_urls": refs} if refs else {}),
                    },
                    timeout=60,
                )
                return LLMText(text=result.data["output"])
            except (FalError, KeyError) as exc:
                raise LLMError("The room designer could not answer. Please try again.") from exc
        try:
            async with genai.Client(api_key=key).aio as client:
                response = await asyncio.wait_for(
                    client.models.generate_content(
                        model=model,
                        contents=[
                            *[
                                types.Part.from_bytes(data=data, mime_type=mime)
                                for data, mime in images or []
                            ],
                            prompt,
                        ],
                        config=types.GenerateContentConfig(
                            temperature=0.2,
                            response_mime_type="application/json" if json_out else "text/plain",
                        ),
                    ),
                    TIMEOUT_S,
                )
                return LLMText(text=response.text or "")
        except TimeoutError as exc:
            raise LLMError("The room designer took too long. Please try again.") from exc
        except Exception as exc:
            log.warning("Room planner request failed (%s)", type(exc).__name__)
            raise LLMError("The room designer could not answer. Please try again.") from exc

    result = await cached(
        "llm",
        {
            "model": model,
            "prompt": prompt,
            "json": json_out,
            "images": [hashlib.sha256(data).hexdigest() for data, _ in images or []],
        },
        call,
        LLMText,
    )
    text = result.text.strip()
    if not json_out:
        return text
    try:
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        return json.loads(text)
    except ValueError as exc:
        raise LLMError("The AI answered in a shape we could not read.") from exc
