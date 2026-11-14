import uuid
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import storage
from app.auth import CurrentUser, User
from app.db.session import DB
from app.db.tables import Conversation, Message, Run
from app.models import (
    ConversationCreate,
    ConversationDetail,
    ConversationSummary,
    ConversationUpdate,
    MessageOut,
    RunSummary,
)

router = APIRouter(prefix="/conversations", tags=["conversations"])


async def owned_conversation(
    db: AsyncSession, conversation_id: uuid.UUID, user: User
) -> Conversation:
    """404 for someone else's conversation too, so ids of other users are not confirmed."""
    conversation = await db.scalar(
        select(Conversation).where(
            Conversation.id == conversation_id, Conversation.user_id == user.id
        )
    )
    if conversation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found.")
    return conversation


def _summary(conversation: Conversation) -> ConversationSummary:
    return ConversationSummary.model_validate(conversation, from_attributes=True)


@router.get("")
async def list_conversations(user: CurrentUser, db: DB) -> list[ConversationSummary]:
    rows = await db.scalars(
        select(Conversation)
        .where(Conversation.user_id == user.id)
        .order_by(Conversation.updated_at.desc())
    )
    return [_summary(c) for c in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_conversation(
    body: ConversationCreate, user: CurrentUser, db: DB
) -> ConversationSummary:
    conversation = Conversation(user_id=user.id, title=body.title.strip())
    db.add(conversation)
    await db.flush()
    await db.refresh(conversation)
    return _summary(conversation)


@router.get("/{conversation_id}")
async def get_conversation(
    conversation_id: uuid.UUID, user: CurrentUser, db: DB
) -> ConversationDetail:
    conversation = await owned_conversation(db, conversation_id, user)
    messages = await db.scalars(
        select(Message).where(Message.conversation_id == conversation.id).order_by(Message.id)
    )
    runs = await db.scalars(
        select(Run).where(Run.conversation_id == conversation.id).order_by(Run.created_at)
    )
    return ConversationDetail(
        **_summary(conversation).model_dump(),
        room_photo_url=await storage.try_signed_url(conversation.room_photo_path),
        messages=[MessageOut.model_validate(m, from_attributes=True) for m in messages],
        runs=[RunSummary.model_validate(r, from_attributes=True) for r in runs],
    )


@router.post("/{conversation_id}/photo")
async def upload_photo(
    conversation_id: uuid.UUID,
    file: Annotated[UploadFile, File()],
    user: CurrentUser,
    db: DB,
) -> ConversationDetail:
    conversation = await owned_conversation(db, conversation_id, user)
    if file.content_type != "image/jpeg":
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Use a JPEG room photo.")
    max_bytes = 5 * 1024 * 1024
    data = await file.read(max_bytes + 1)
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The room photo is empty.")
    if len(data) > max_bytes:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Room photo must be under 5 MB.")
    try:
        path = await storage.upload(f"rooms/{conversation_id}.jpg", data, "image/jpeg")
    except storage.StorageError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    conversation.room_photo_path = path
    await db.flush()
    return await get_conversation(conversation_id, user, db)


@router.patch("/{conversation_id}")
async def rename_conversation(
    conversation_id: uuid.UUID, body: ConversationUpdate, user: CurrentUser, db: DB
) -> ConversationSummary:
    conversation = await owned_conversation(db, conversation_id, user)
    conversation.title = body.title.strip()
    await db.flush()
    await db.refresh(conversation)
    return _summary(conversation)


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(conversation_id: uuid.UUID, user: CurrentUser, db: DB) -> None:
    await db.delete(await owned_conversation(db, conversation_id, user))
