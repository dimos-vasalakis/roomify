import asyncio
import logging
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routes import conversations, me
from app.tools.catalogue import refresh_catalogues

log = logging.getLogger("roomify")
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


app = FastAPI(title="Roomify", lifespan=lifespan)

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
