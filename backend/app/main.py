import asyncio
import logging
import os
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import Response

from app.config import get_settings
from app.routes import conversations, me, offer
from app.tools.catalogue import refresh_catalogues

log = logging.getLogger("roomify")
# Step and slow-call timings (agent/loop.py, cache.py) at INFO; everything else stays quiet.
logging.basicConfig(format="%(asctime)s %(name)s %(levelname)s %(message)s")
log.setLevel(logging.INFO)
REFRESH_EVERY_S = 3600


def _keep_catalogues_fresh(stop: threading.Event) -> None:
    """Hourly: download missing or week-old shop catalogues. Runs in its own thread with
    its own event loop, so parsing megabytes of sitemaps never stalls live requests."""
    while not stop.is_set():
        try:
            for result in asyncio.run(refresh_catalogues()):
                if isinstance(result, str):
                    log.warning("Catalogue refresh: %s", result)
        except Exception:
            log.exception("Catalogue refresh crashed; trying again next hour")
        stop.wait(REFRESH_EVERY_S)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Searches use whatever catalogues are saved and never wait for a download."""
    settings = get_settings()
    stop = threading.Event()
    if settings.refresh_catalogues and not settings.replay:
        threading.Thread(target=_keep_catalogues_fresh, args=(stop,), daemon=True).start()
    yield
    stop.set()


app = FastAPI(title="Roomify", version=os.getenv("RENDER_GIT_COMMIT", "development")[:12], lifespan=lifespan)


@app.middleware("http")
async def readable_server_error(request: Request, call_next: RequestResponseEndpoint) -> Response:
    """Keep unexpected failures inside CORS so browsers can display the actual error."""
    try:
        return await call_next(request)
    except Exception as exc:  # noqa: BLE001 - final HTTP boundary; never expose raw errors
        # Exception text can contain database credentials or SQL parameters.
        log.error(
            "Request failed: %s %s (%s)", request.method, request.url.path, type(exc).__name__
        )
        return JSONResponse(
            status_code=500,
            content={
                "detail": "The server could not complete this request. Check the backend configuration and logs."
            },
        )


app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().frontend_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(me.router)
app.include_router(conversations.router)
app.include_router(offer.router)
