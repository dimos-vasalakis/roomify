"""Database tables. Change a table here, then generate a migration:
    alembic revision --autogenerate -m "what changed"
Row level security and storage buckets are not detected by autogenerate:
write those by hand with op.execute() in the migration.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Identity,
    Integer,
    MetaData,
    Numeric,
    String,
    Table,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

Money = Numeric(10, 2, asdecimal=False)


class Base(DeclarativeBase):
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(column_0_label)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )


# Supabase's own auth table. Declared only so runs.user_id can reference it;
# migrations/env.py skips the auth schema so Alembic never tries to manage it.
auth_users = Table(
    "users",
    Base.metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    schema="auth",
)


def _created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Run(Base):
    """One request: a room photo, what the user asked for, and how it ended."""

    __tablename__ = "runs"
    __table_args__ = (
        CheckConstraint(
            "status in ('created', 'running', 'waiting_for_user', 'done', 'failed')",
            name="status",
        ),
        CheckConstraint("budget_eur > 0", name="budget_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("auth.users.id", ondelete="SET NULL"), index=True
    )
    status: Mapped[str] = mapped_column(String(20), server_default="created", nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    budget_eur: Mapped[float] = mapped_column(Money, nullable=False)
    wall_width_cm: Mapped[float | None] = mapped_column(Float)
    city: Mapped[str | None] = mapped_column(Text)
    room_photo_path: Mapped[str | None] = mapped_column(Text)
    room_analysis: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    total_eur: Mapped[float | None] = mapped_column(Money)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class RunEvent(Base):
    """Every server-sent event of a run, in order, so a run can be reopened or replayed."""

    __tablename__ = "run_events"
    __table_args__ = (UniqueConstraint("run_id", "seq"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = _created_at()


class Product(Base):
    """A product page as last read from the shop. Shared across runs."""

    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # hash of url
    url: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    retailer: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    image_url: Mapped[str] = mapped_column(Text, nullable=False)
    price_eur: Mapped[float] = mapped_column(Money, nullable=False)
    width_cm: Mapped[float | None] = mapped_column(Float)
    depth_cm: Mapped[float | None] = mapped_column(Float)
    height_cm: Mapped[float | None] = mapped_column(Float)
    delivery_text: Mapped[str | None] = mapped_column(Text)
    in_stock: Mapped[bool | None] = mapped_column()
    judged: Mapped[bool] = mapped_column(server_default="false", nullable=False)
    judge_verdict: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    read_at: Mapped[datetime] = _created_at()


class Candidate(Base):
    """A product the agent considered for one slot of one run, and what it decided."""

    __tablename__ = "candidates"
    __table_args__ = (
        CheckConstraint("status in ('found', 'rejected', 'chosen', 'swapped_out')", name="status"),
        UniqueConstraint("run_id", "slot", "product_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
    )
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), nullable=False)
    slot: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(20), server_default="found", nullable=False)
    # Price at decision time: the receipt must not change if the shop changes it later.
    price_eur: Mapped[float] = mapped_column(Money, nullable=False)
    score: Mapped[float | None] = mapped_column(Float)
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()


class Render(Base):
    """A rendered room (first render or a swap) and its check against the listings."""

    __tablename__ = "renders"
    __table_args__ = (CheckConstraint("kind in ('render', 'swap')", name="kind"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(10), server_default="render", nullable=False)
    image_path: Mapped[str] = mapped_column(Text, nullable=False)
    product_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    verify_passed: Mapped[bool | None] = mapped_column()
    verify_result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _created_at()


class Walkin(Base):
    """A walk-in preview video made from one render. Never call it 3D."""

    __tablename__ = "walkins"
    __table_args__ = (CheckConstraint("status in ('queued', 'ready', 'failed')", name="status"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    render_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("renders.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(10), server_default="queued", nullable=False)
    video_path: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()
