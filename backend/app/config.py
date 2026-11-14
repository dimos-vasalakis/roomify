import os
from functools import cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


class Settings(BaseModel):
    replay: bool
    database_url: str | None
    supabase_url: str | None
    supabase_secret_key: str | None
    supabase_jwt_secret: str | None
    frontend_origins: list[str]

    @property
    def db_enabled(self) -> bool:
        """Replay must run with no network, so the database is off in replay."""
        return bool(self.database_url) and not self.replay

    @property
    def storage_enabled(self) -> bool:
        return bool(self.supabase_url and self.supabase_secret_key) and not self.replay


def _csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


@cache
def get_settings() -> Settings:
    return Settings(
        replay=os.getenv("REPLAY", "0") == "1",
        database_url=os.getenv("DATABASE_URL") or None,
        supabase_url=(os.getenv("SUPABASE_URL") or "").rstrip("/") or None,
        supabase_secret_key=os.getenv("SUPABASE_SECRET_KEY") or None,
        supabase_jwt_secret=os.getenv("SUPABASE_JWT_SECRET") or None,
        frontend_origins=_csv(os.getenv("FRONTEND_ORIGINS", "http://localhost:5173")),
    )
