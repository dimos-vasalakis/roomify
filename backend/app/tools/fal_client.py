"""One cached, timed boundary for every fal call."""

import asyncio
from contextlib import suppress
from typing import Any

import fal_client
from pydantic import BaseModel

from app.cache import cached


class FalError(Exception):
    """Readable error with no provider payloads or credentials."""


class FalResult(BaseModel):
    data: dict[str, Any]


async def fal(
    model: str, arguments: dict[str, Any], timeout: float = 90, max_age_s: float | None = 0
) -> FalResult:
    """`max_age_s=None` reuses any saved result: for calls whose answer never changes."""

    async def call() -> FalResult:
        handle = None
        try:
            async with asyncio.timeout(timeout):
                handle = await fal_client.submit_async(model, arguments=arguments)
                return FalResult(data=await handle.get(interval=1))
        except (TimeoutError, asyncio.CancelledError) as exc:
            if handle is not None:
                with suppress(Exception):
                    await asyncio.wait_for(handle.cancel(), 3)
            if isinstance(exc, asyncio.CancelledError):
                raise
            raise FalError("This step took too long. Please try again.") from exc
        except Exception as exc:
            raise FalError(
                "The design service could not finish this step. Please try again."
            ) from exc

    # Live, every render is new by default: a saved one made "try again" hand back the same
    # picture. Results are still saved, so a REPLAY=1 recording reads them.
    return await cached(
        "fal", {"model": model, "arguments": arguments}, call, FalResult, max_age_s=max_age_s
    )


async def fal_upload(data: bytes, content_type: str, file_name: str, timeout: float = 20) -> str:
    """Put a file on fal's storage for a model to read; returns its link. Never cached."""
    try:
        async with asyncio.timeout(timeout):
            return await fal_client.upload_async(data, content_type, file_name)
    except TimeoutError as exc:
        raise FalError("This step took too long. Please try again.") from exc
    except Exception as exc:
        raise FalError("The design service could not take this file. Please try again.") from exc
