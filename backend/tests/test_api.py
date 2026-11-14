"""API against a real, migrated, throwaway database (TEST_DATABASE_URL).
Never point it at the shared Supabase database: it creates and deletes users."""

import os
import time
import uuid
from collections.abc import AsyncIterator

import httpx
import jwt
import pytest
from sqlalchemy import text

from app.db.session import get_engine, session
from app.main import app

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL not set")
SECRET = "test-jwt-secret-at-least-32-bytes-long!"


def bearer(user_id: uuid.UUID) -> dict[str, str]:
    claims = {"sub": str(user_id), "aud": "authenticated", "exp": time.time() + 600}
    return {"Authorization": f"Bearer {jwt.encode(claims, SECRET, algorithm='HS256')}"}


@pytest.fixture(autouse=True)
def live_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REPLAY", "0")
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL or "")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    monkeypatch.setenv("SUPABASE_URL", "")  # no storage in tests


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    await get_engine().dispose()


@pytest.fixture
async def users() -> AsyncIterator[tuple[uuid.UUID, uuid.UUID]]:
    """Two signed-up users, as Supabase would insert them into auth.users."""
    alice, bob = uuid.uuid4(), uuid.uuid4()
    async with session() as db:
        for user_id, name in ((alice, "Alice"), (bob, "Bob")):
            await db.execute(
                text(
                    "insert into auth.users (id, email, raw_user_meta_data) "
                    "values (:id, :email, jsonb_build_object('display_name', cast(:name as text)))"
                ),
                {"id": user_id, "email": f"{name.lower()}@example.com", "name": name},
            )
    yield alice, bob
    async with session() as db:
        await db.execute(
            text("delete from auth.users where id in (:a, :b)"), {"a": alice, "b": bob}
        )
    await get_engine().dispose()


async def test_sign_up_creates_profile_and_it_can_be_edited(
    client: httpx.AsyncClient, users: tuple[uuid.UUID, uuid.UUID]
) -> None:
    alice, _ = users
    me = (await client.get("/me", headers=bearer(alice))).json()
    assert me["display_name"] == "Alice"
    assert me["home_city"] is None

    response = await client.patch("/me", json={"home_city": "Αθήνα"}, headers=bearer(alice))
    assert response.status_code == 200
    assert response.json()["home_city"] == "Αθήνα"
    assert response.json()["display_name"] == "Alice"


async def test_conversations_belong_to_their_owner(
    client: httpx.AsyncClient, users: tuple[uuid.UUID, uuid.UUID]
) -> None:
    alice, bob = users
    created = await client.post(
        "/conversations", json={"title": "Study corner"}, headers=bearer(alice)
    )
    assert created.status_code == 201
    conversation_id = created.json()["id"]

    mine = await client.get("/conversations", headers=bearer(alice))
    assert [c["title"] for c in mine.json()] == ["Study corner"]
    detail = await client.get(f"/conversations/{conversation_id}", headers=bearer(alice))
    assert detail.json()["messages"] == []
    assert detail.json()["runs"] == []

    # Bob cannot list, read, rename or delete Alice's conversation.
    assert (await client.get("/conversations", headers=bearer(bob))).json() == []
    path = f"/conversations/{conversation_id}"
    assert (await client.get(path, headers=bearer(bob))).status_code == 404
    renamed = await client.patch(path, json={"title": "Mine now"}, headers=bearer(bob))
    assert renamed.status_code == 404
    assert (await client.delete(path, headers=bearer(bob))).status_code == 404

    renamed = await client.patch(path, json={"title": "Bedroom"}, headers=bearer(alice))
    assert renamed.json()["title"] == "Bedroom"
    assert (await client.delete(path, headers=bearer(alice))).status_code == 204
    assert (await client.get(path, headers=bearer(alice))).status_code == 404


async def test_empty_title_is_refused(
    client: httpx.AsyncClient, users: tuple[uuid.UUID, uuid.UUID]
) -> None:
    alice, _ = users
    response = await client.post("/conversations", json={"title": ""}, headers=bearer(alice))
    assert response.status_code == 422


async def test_new_message_moves_conversation_to_the_top(
    client: httpx.AsyncClient, users: tuple[uuid.UUID, uuid.UUID]
) -> None:
    alice, _ = users
    older = (await client.post("/conversations", json={"title": "A"}, headers=bearer(alice))).json()
    await client.post("/conversations", json={"title": "B"}, headers=bearer(alice))
    async with session() as db:
        await db.execute(
            text("insert into messages (conversation_id, role, content) values (:c, 'user', 'hi')"),
            {"c": older["id"]},
        )
    listed = (await client.get("/conversations", headers=bearer(alice))).json()
    assert [c["title"] for c in listed] == ["A", "B"]


async def test_missing_database_url_says_so(
    client: httpx.AsyncClient, users: tuple[uuid.UUID, uuid.UUID], monkeypatch: pytest.MonkeyPatch
) -> None:
    alice, _ = users
    monkeypatch.setenv("DATABASE_URL", "")
    from app.config import get_settings

    get_settings.cache_clear()
    response = await client.get("/me", headers=bearer(alice))
    assert response.status_code == 503
    assert "DATABASE_URL" in response.json()["detail"]
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL or "")
    get_settings.cache_clear()
