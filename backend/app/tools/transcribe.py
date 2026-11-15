"""What the person said into the mic, for browsers whose own speech recognition fails."""

from pydantic import BaseModel

from app.tools.fal_client import FalError, fal, fal_upload

TRANSCRIBE_MODEL = "fal-ai/whisper"
NOT_HEARD = "Couldn't hear that. Try again, or type it."


class TranscribeError(Exception):
    """Readable error for the person talking to the room."""


class Transcript(BaseModel):
    text: str


async def transcribe(audio: bytes, content_type: str) -> Transcript:
    """Whisper on fal, any language. Every clip is new, so nothing is reused."""
    ext = "m4a" if "mp4" in content_type else "ogg" if "ogg" in content_type else "webm"
    try:
        url = await fal_upload(audio, content_type, f"speech.{ext}")
        result = await fal(
            TRANSCRIBE_MODEL,
            {"audio_url": url, "task": "transcribe", "chunk_level": "none"},
            timeout=30,
        )
        return Transcript(text=str(result.data["text"]).strip())
    except (FalError, KeyError, TypeError) as exc:
        raise TranscribeError(NOT_HEARD) from exc
