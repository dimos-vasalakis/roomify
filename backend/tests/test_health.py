from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_cors_allows_local_frontend() -> None:
    response = client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_allows_production_upload_preflight() -> None:
    origin = "https://roomify-rosy.vercel.app"
    response = client.options(
        "/conversations/00000000-0000-0000-0000-000000000001/photo",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_cors_rejects_unknown_sites() -> None:
    response = client.options(
        "/conversations",
        headers={"Origin": "https://unrelated.example", "Access-Control-Request-Method": "POST"},
    )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
