"""The mic's fallback: audio in, the sentence out, readable errors, nothing cached."""

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from app.main import app
from app.tools import transcribe as tool
from app.tools.fal_client import FalError, FalResult


def post(data: bytes = b"\x1aE\xdf\xa3 webm", kind: str = "audio/webm;codecs=opus"):
    with TestClient(app) as client:
        return client.post("/transcribe", files={"audio": ("speech.webm", data, kind)})


def test_returns_what_was_said(monkeypatch):
    upload = AsyncMock(return_value="https://v3b.fal.media/files/speech.webm")
    fal = AsyncMock(
        return_value=FalResult(data={"text": "  A warmer lamp, please. ", "chunks": []})
    )
    monkeypatch.setattr(tool, "fal_upload", upload)
    monkeypatch.setattr(tool, "fal", fal)
    response = post()
    assert response.status_code == 200
    assert response.json() == {"text": "A warmer lamp, please."}
    assert upload.await_args.args[1] == "audio/webm"
    assert fal.await_args.args[1]["audio_url"] == "https://v3b.fal.media/files/speech.webm"
    assert fal.await_args.kwargs.get("max_age_s", 0) == 0


def test_refuses_what_is_not_audio(monkeypatch):
    fal = AsyncMock()
    monkeypatch.setattr(tool, "fal", fal)
    assert post(kind="image/png").status_code == 415
    assert post(data=b"").status_code == 400
    fal.assert_not_awaited()


def test_a_failed_call_reads_as_a_sentence(monkeypatch):
    monkeypatch.setattr(tool, "fal_upload", AsyncMock(return_value="https://x.fal.media/a"))
    monkeypatch.setattr(tool, "fal", AsyncMock(side_effect=FalError("took too long")))
    response = post()
    assert response.status_code == 502
    assert response.json()["detail"] == "Couldn't hear that. Try again, or type it."
