from collections.abc import Callable

import httpx
import pytest

Handler = Callable[[httpx.Request], httpx.Response]


def mock_http(monkeypatch: pytest.MonkeyPatch, handler: Handler) -> list[httpx.Request]:
    """Route every httpx.AsyncClient through `handler`; returns the requests made."""
    seen: list[httpx.Request] = []
    original = httpx.AsyncClient

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    def client(**kwargs: object) -> httpx.AsyncClient:
        kwargs.pop("transport", None)
        return original(transport=httpx.MockTransport(record), **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(httpx, "AsyncClient", client)
    return seen
