"""Runs only when TEST_DATABASE_URL points at a migrated, throwaway database.
Never point it at the shared Supabase database: the test writes rows."""

import os
import uuid

import pytest
from sqlalchemy import select, text

from app.db.session import get_engine, session
from app.db.tables import Candidate, Conversation, Product, Run, RunEvent

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL not set")


@pytest.fixture(autouse=True)
def use_test_database(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL or "")


async def test_run_with_events_and_candidates_round_trips() -> None:
    product_id = uuid.uuid4().hex
    user_id = uuid.uuid4()
    async with session() as db:
        await db.execute(text("insert into auth.users (id) values (:id)"), {"id": user_id})
        conversation = Conversation(user_id=user_id, title="Study corner")
        db.add(conversation)
        await db.flush()
        run = Run(
            conversation_id=conversation.id,
            prompt="study corner",
            budget_eur=300,
            wall_width_cm=140,
        )
        db.add(run)
        db.add(
            Product(
                id=product_id,
                url=f"https://www.ikea.gr/{product_id}",
                retailer="ikea.gr",
                title="Γραφείο",
                image_url="https://www.ikea.gr/desk.jpg",
                price_eur=79.9,
                width_cm=120,
                judged=True,
            )
        )
        await db.flush()
        db.add(RunEvent(run_id=run.id, seq=1, type="step.started", payload={"step": "search"}))
        db.add(
            Candidate(
                run_id=run.id,
                product_id=product_id,
                slot="desk",
                status="rejected",
                price_eur=79.9,
                reason="Desk 160 cm, your wall is 140.",
            )
        )
        run_id = run.id

    async with session() as db:
        loaded = await db.get(Run, run_id)
        assert loaded is not None
        assert loaded.status == "created"
        assert loaded.budget_eur == 300.0
        reason = await db.scalar(select(Candidate.reason).where(Candidate.run_id == run_id))
        assert reason == "Desk 160 cm, your wall is 140."
        await db.delete(loaded)  # cascades to events and candidates

    async with session() as db:
        left = await db.scalar(select(RunEvent.id).where(RunEvent.run_id == run_id))
        assert left is None
        await db.execute(text("delete from auth.users where id = :id"), {"id": user_id})
    await get_engine().dispose()
