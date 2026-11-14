"""Pydantic shapes that cross the API boundary. Shared contract with the front end:
mirror any change in frontend/src/types.ts and tell the team."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ProfileOut(BaseModel):
    id: uuid.UUID
    email: str | None
    display_name: str | None
    avatar_url: str | None  # short-lived signed link
    home_city: str | None


class ProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=80)
    home_city: str | None = Field(default=None, max_length=80)


class ConversationCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class ConversationUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class ConversationSummary(BaseModel):
    id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime


class MessageOut(BaseModel):
    id: int
    role: str  # "user" or "agent"
    content: str
    run_id: uuid.UUID | None
    created_at: datetime


class RunSummary(BaseModel):
    id: uuid.UUID
    status: str
    prompt: str
    budget_eur: float
    total_eur: float | None
    created_at: datetime


class ConversationDetail(ConversationSummary):
    room_photo_url: str | None  # short-lived signed link
    messages: list[MessageOut]
    runs: list[RunSummary]
