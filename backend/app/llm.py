"""The one function every LLM call goes through (CLAUDE.md). Swap the provider here only.

Vision through the existing fal key, or direct Gemini when only that is configured.
All requests are cached, including the model and image hashes.
"""

import asyncio
import base64
import hashlib
import json
import logging
import os
import re
from typing import Any

from google import genai
from google.genai import types
from pydantic import BaseModel

import app.config  # noqa: F401  loads backend/.env
from app.cache import cached
from app.config import get_settings
from app.tools.fal_client import FalError, fal

DEFAULT_MODEL = "gemini-flash-latest"
# Judging pictures (placement, render check, basket fit) needs the sharper eye: the older
# flash model misread shapes and missed furniture clipping into furniture.
VISION_MODEL = "google/gemini-3-flash-preview"
log = logging.getLogger("roomify.llm")
TIMEOUT_S = 45.0


class LLMError(Exception):
    """Plain words for the live feed."""


def llm_available() -> bool:
    return get_settings().replay or bool(os.getenv("GEMINI_API_KEY") or os.getenv("FAL_KEY"))


class LLMText(BaseModel):
    text: str


async def llm(
    prompt: str,
    images: list[tuple[bytes, str]] | None = None,
    json_out: bool = False,
    vision: bool = False,
) -> Any:
    """Text (or parsed JSON when `json_out`) from the model. `images`: (bytes, mime type) pairs.
    `vision`: a judgement that rests on looking closely at the images."""
    key = os.getenv("GEMINI_API_KEY")
    use_fal = bool(os.getenv("FAL_KEY"))
    if vision:
        chosen = os.getenv("VISION_MODEL") or VISION_MODEL
        model = chosen if use_fal else chosen.removeprefix("google/")
    else:
        model = (
            os.getenv("FAL_LLM_MODEL") or "google/gemini-2.5-flash"
            if use_fal
            else os.getenv("GEMINI_MODEL") or DEFAULT_MODEL
        )
    try:
        return await _answer(prompt, images, json_out, key, use_fal, model)
    except _Unreadable:
        # One typo in a long JSON answer should not end a run: ask once more, strictly.
        try:
            return await _answer(
                prompt + "\nReturn strictly valid JSON.", images, json_out, key, use_fal, model
            )
        except _Unreadable as exc:
            raise LLMError("The AI answered in a shape we could not read.") from exc


class _Unreadable(Exception):
    pass


async def _answer(
    prompt: str,
    images: list[tuple[bytes, str]] | None,
    json_out: bool,
    key: str | None,
    use_fal: bool,
    model: str,
) -> Any:

    async def call() -> LLMText:
        if use_fal or not key:
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
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    try:
        return json.loads(text)
    except ValueError:
        pass
    try:
        # Gemini 3 sometimes closes a four-number box with "}" or "}}" instead of "]}".
        return json.loads(re.sub(r"(\[\s*-?[\d.]+(?:\s*,\s*-?[\d.]+){3})\s*\}+", r"\1]}", text))
    except ValueError as exc:
        raise _Unreadable from exc
