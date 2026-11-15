"""Phone to laptop: a drop box with a random code, picked up once, gone after a while."""

from fastapi.testclient import TestClient

from app.main import app
from app.routes import handoff

JPEG = b"\xff\xd8\xff\xe0 room photo"


def test_each_photo_goes_from_the_phone_to_the_laptop_once() -> None:
    with TestClient(app) as client:
        code = client.post("/handoff").json()["code"]
        assert len(code) >= 16
        assert client.get(f"/handoff/{code}").status_code == 204  # nothing sent yet
        sent = client.post(
            f"/handoff/{code}/photo", files={"photo": ("room.jpg", JPEG, "image/jpeg")}
        )
        assert sent.status_code == 204
        got = client.get(f"/handoff/{code}")
        assert got.status_code == 200
        assert got.content == JPEG
        assert got.headers["content-type"] == "image/jpeg"
        assert client.get(f"/handoff/{code}").status_code == 204  # picked up, box still open
        client.post(f"/handoff/{code}/photo", files={"photo": ("b.jpg", b"second", "image/jpeg")})
        assert client.get(f"/handoff/{code}").content == b"second"  # a retake replaces it


def test_unknown_codes_and_wrong_files_read_as_sentences() -> None:
    with TestClient(app) as client:
        missing = client.post("/handoff/nope/photo", files={"photo": ("a.jpg", JPEG, "image/jpeg")})
        assert missing.status_code == 404
        assert "expired" in missing.json()["detail"]
        code = client.post("/handoff").json()["code"]
        wrong = client.post(
            f"/handoff/{code}/photo", files={"photo": ("a.txt", b"x", "text/plain")}
        )
        assert wrong.status_code == 415


def test_old_boxes_expire(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    with TestClient(app) as client:
        code = client.post("/handoff").json()["code"]
        handoff._boxes[code].created -= handoff.TTL_S + 1
        assert client.get(f"/handoff/{code}").status_code == 404
