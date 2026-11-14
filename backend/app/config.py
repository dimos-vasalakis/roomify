import os
from functools import cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = BACKEND_DIR.parent

load_dotenv(BACKEND_DIR / ".env")


class Settings(BaseModel):
    replay: bool
    database_url: str | None
    supabase_url: str | None
    supabase_secret_key: str | None
    supabase_jwt_secret: str | None
    frontend_origins: list[str]
    retailers: list[str]
    serper_api_key: str | None
    cache_dir: Path
    refresh_catalogues: bool

    @property
    def db_enabled(self) -> bool:
        """Replay must run with no network, so the database is off in replay."""
        return bool(self.database_url) and not self.replay

    @property
    def storage_enabled(self) -> bool:
        return bool(self.supabase_url and self.supabase_secret_key) and not self.replay


def _csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _default_cache(replay: bool) -> Path:
    """Day-to-day runs write to a gitignored folder; replay reads the committed recording.
    To record the demo run: CACHE_DIR=../demo/cache."""
    return REPO_DIR / "demo" / "cache" if replay else BACKEND_DIR / ".cache"


@cache
def get_settings() -> Settings:
    return Settings(
        replay=os.getenv("REPLAY", "0") == "1",
        database_url=os.getenv("DATABASE_URL") or None,
        supabase_url=(os.getenv("SUPABASE_URL") or "").rstrip("/") or None,
        supabase_secret_key=os.getenv("SUPABASE_SECRET_KEY") or None,
        supabase_jwt_secret=os.getenv("SUPABASE_JWT_SECRET") or None,
        frontend_origins=list(
            dict.fromkeys(
                [
                    "https://roomify-rosy.vercel.app",
                    *_csv(os.getenv("FRONTEND_ORIGINS") or "http://localhost:5173"),
                ]
            )
        ),
        retailers=[d.removeprefix("www.") for d in _csv(os.getenv("RETAILERS", ""))],
        serper_api_key=os.getenv("SERPER_API_KEY") or None,
        cache_dir=Path(os.getenv("CACHE_DIR") or _default_cache(os.getenv("REPLAY", "0") == "1")),
        refresh_catalogues=(os.getenv("REFRESH_CATALOGUES") or "1") == "1",
    )
