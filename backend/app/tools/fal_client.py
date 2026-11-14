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


async def fal(model: str, arguments: dict[str, Any], timeout: float = 90) -> FalResult:
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

    return await cached("fal", {"model": model, "arguments": arguments}, call, FalResult)
