"""Speech to text, so the mic works in every browser (Firefox, Brave, in-app browsers, phones)."""

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.tools.transcribe import TranscribeError, Transcript, transcribe

router = APIRouter(tags=["speech"])
AUDIO_MAX_BYTES = 6 * 1024 * 1024  # about three minutes of browser audio; a sentence is ~50 kB
AUDIO_TYPES = (
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
    "audio/mpeg",
    "audio/wav",
    "audio/x-m4a",
    "video/webm",
    "video/mp4",
)


@router.post("/transcribe")
async def transcribe_audio(audio: Annotated[UploadFile, File()]) -> Transcript:
    kind = (audio.content_type or "").split(";")[0].strip().lower()
    if kind not in AUDIO_TYPES:
        raise HTTPException(415, "This recording format isn't supported. Type it instead.")
    data = await audio.read(AUDIO_MAX_BYTES + 1)
    if not data:
        raise HTTPException(400, "Nothing was recorded. Try again.")
    if len(data) > AUDIO_MAX_BYTES:
        raise HTTPException(413, "That recording is too long. Say it in one sentence.")
    try:
        return await transcribe(data, kind)
    except TranscribeError as exc:
        raise HTTPException(502, str(exc)) from exc
