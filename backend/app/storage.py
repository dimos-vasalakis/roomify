"""Supabase Storage: room photos and renders, in one private bucket.

Rows store the object path; the front end gets a short-lived signed URL.
"""

import httpx

from app.config import get_settings

BUCKET = "roomify"  # created by the first migration
TIMEOUT = httpx.Timeout(30.0, connect=5.0)


class StorageError(Exception):
    pass


def _headers() -> dict[str, str]:
    key = get_settings().supabase_secret_key or ""
    headers = {"apikey": key}
    if key.startswith("eyJ"):  # legacy service_role JWT also needs the bearer header
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _base() -> str:
    settings = get_settings()
    if not settings.storage_enabled:
        raise StorageError("Storage is off (replay mode or Supabase keys missing)")
    return f"{settings.supabase_url}/storage/v1"


async def upload(path: str, data: bytes, content_type: str) -> str:
    """Upload or overwrite one file. Returns the object path to store in the row."""
    url = f"{_base()}/object/{BUCKET}/{path}"
    headers = _headers() | {"Content-Type": content_type, "x-upsert": "true"}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(url, content=data, headers=headers)
    except httpx.HTTPError as exc:
        raise StorageError(f"Upload of {path} failed: {exc.__class__.__name__}") from exc
    if response.status_code >= 400:
        raise StorageError(f"Upload of {path} failed: HTTP {response.status_code}")
    return path


async def signed_url(path: str, expires_in: int = 3600) -> str:
    """A temporary link the browser can load without any key."""
    base = _base()
    url = f"{base}/object/sign/{BUCKET}/{path}"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(url, json={"expiresIn": expires_in}, headers=_headers())
    except httpx.HTTPError as exc:
        raise StorageError(f"Signing {path} failed: {exc.__class__.__name__}") from exc
    if response.status_code >= 400:
        raise StorageError(f"Signing {path} failed: HTTP {response.status_code}")
    try:
        return base + response.json()["signedURL"]
    except (ValueError, KeyError, TypeError) as exc:
        raise StorageError(f"Signing {path} failed: unexpected answer from storage") from exc


async def try_signed_url(path: str | None) -> str | None:
    """For display only: a missing image must not break the page."""
    if not path:
        return None
    try:
        return await signed_url(path)
    except StorageError:
        return None
