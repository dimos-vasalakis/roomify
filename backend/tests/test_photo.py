"""Photo upload validation without shared database or storage writes."""
import uuid
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from app import storage
from app.auth import User
from app.routes import conversations


@pytest.mark.parametrize('data,expected', [(b'', 400), (b'x' * (5 * 1024 * 1024 + 1), 413), (b'jpeg', 200)])
async def test_photo_upload(monkeypatch, data, expected):
    room_id = uuid.uuid4()
    room = SimpleNamespace(room_photo_path=None)
    db = SimpleNamespace(flush=AsyncMock())
    upload = AsyncMock(return_value=f'rooms/{room_id}.jpg')
    detail = object()
    monkeypatch.setattr(conversations, 'owned_conversation', AsyncMock(return_value=room))
    monkeypatch.setattr(conversations, 'get_conversation', AsyncMock(return_value=detail))
    monkeypatch.setattr(storage, 'upload', upload)
    photo = UploadFile(BytesIO(data), headers=Headers({'content-type': 'image/jpeg'}))
    if expected != 200:
        with pytest.raises(HTTPException) as error:
            await conversations.upload_photo(room_id, photo, User(id=uuid.uuid4()), db)
        assert error.value.status_code == expected
        upload.assert_not_awaited()
    else:
        assert await conversations.upload_photo(room_id, photo, User(id=uuid.uuid4()), db) is detail
        upload.assert_awaited_once_with(f'rooms/{room_id}.jpg', data, 'image/jpeg')
        assert room.room_photo_path == f'rooms/{room_id}.jpg'
        db.flush.assert_awaited_once()


async def test_storage_failure_is_readable(monkeypatch):
    room = SimpleNamespace(room_photo_path=None)
    monkeypatch.setattr(conversations, 'owned_conversation', AsyncMock(return_value=room))
    monkeypatch.setattr(storage, 'upload', AsyncMock(side_effect=storage.StorageError('Upload failed')))
    photo = UploadFile(BytesIO(b'jpeg'), headers=Headers({'content-type': 'image/jpeg'}))
    with pytest.raises(HTTPException) as error:
        await conversations.upload_photo(uuid.uuid4(), photo, User(id=uuid.uuid4()), AsyncMock())
    assert error.value.status_code == 502
    assert error.value.detail == 'Upload failed'
    assert room.room_photo_path is None
