"""Database failures must remain readable to the deployed browser."""

import uuid
from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import ProgrammingError

from app.auth import User, current_user
from app.db import session as database
from app.main import app


@pytest.mark.parametrize(
    "error,expected,text",
    [
        (ProgrammingError("select", {}, Exception("missing table")), 503, "alembic upgrade head"),
        (OSError("private connection details"), 503, "DATABASE_URL"),
        (RuntimeError("private internal details"), 500, "backend configuration"),
    ],
)
def test_database_errors_keep_cors(monkeypatch, error, expected, text):
    monkeypatch.setenv("DATABASE_URL", "postgresql://unused")

    @asynccontextmanager
    async def failed_session():
        raise error
        yield

    monkeypatch.setattr(database, "session", failed_session)
    app.dependency_overrides[current_user] = lambda: User(id=uuid.uuid4())
    try:
        response = TestClient(app).post(
            "/conversations",
            json={"title": "Upload"},
            headers={"Origin": "https://roomify-rosy.vercel.app"},
        )
        assert response.status_code == expected
        assert text in response.json()["detail"]
        assert "private" not in response.text
        assert response.headers["access-control-allow-origin"] == "https://roomify-rosy.vercel.app"
    finally:
        app.dependency_overrides.pop(current_user, None)
