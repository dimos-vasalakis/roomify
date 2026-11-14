import time

import pytest
from pydantic import BaseModel

from app.cache import ReplayMiss, cached


class Answer(BaseModel):
    value: int


class Counter:
    def __init__(self) -> None:
        self.calls = 0

    async def __call__(self) -> Answer:
        self.calls += 1
        return Answer(value=self.calls)


async def test_second_call_is_served_from_cache() -> None:
    call = Counter()
    first = await cached("t", {"q": 1}, call, Answer)
    second = await cached("t", {"q": 1}, call, Answer)
    assert first == second == Answer(value=1)
    assert call.calls == 1


async def test_different_inputs_are_different_entries() -> None:
    call = Counter()
    await cached("t", {"q": 1}, call, Answer)
    await cached("t", {"q": 2}, call, Answer)
    assert call.calls == 2


async def test_stale_entry_is_refreshed_live(monkeypatch: pytest.MonkeyPatch) -> None:
    call = Counter()
    await cached("t", {"q": 1}, call, Answer, max_age_s=60)
    later = time.time() + 120
    monkeypatch.setattr(time, "time", lambda: later)
    assert (await cached("t", {"q": 1}, call, Answer, max_age_s=60)).value == 2


async def test_replay_uses_stale_entries_and_never_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    call = Counter()
    await cached("t", {"q": 1}, call, Answer, max_age_s=60)
    monkeypatch.setenv("REPLAY", "1")
    from app.config import get_settings

    get_settings.cache_clear()
    later = time.time() + 10_000
    monkeypatch.setattr(time, "time", lambda: later)
    assert (await cached("t", {"q": 1}, call, Answer, max_age_s=60)).value == 1
    with pytest.raises(ReplayMiss, match="No recorded result"):
        await cached("t", {"q": 99}, call, Answer)
    assert call.calls == 1


async def test_failed_calls_are_not_cached() -> None:
    attempts = 0

    async def flaky() -> Answer:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("network down")
        return Answer(value=7)

    with pytest.raises(RuntimeError):
        await cached("t", {"q": 1}, flaky, Answer)
    assert (await cached("t", {"q": 1}, flaky, Answer)).value == 7


async def test_lists_of_models_round_trip() -> None:
    async def many() -> list[Answer]:
        return [Answer(value=1), Answer(value=2)]

    await cached("t", {"q": "list"}, many, list[Answer])
    assert await cached("t", {"q": "list"}, many, list[Answer]) == [
        Answer(value=1),
        Answer(value=2),
    ]


async def test_unreadable_saved_file_counts_as_missing(
    tmp_path_factory: pytest.TempPathFactory,
) -> None:
    from app.cache import cache_path as _path

    call = Counter()
    await cached("t", {"q": 1}, call, Answer)
    _path("t", {"q": 1}).write_text('{"saved_at": 1, "result": {"wrong_field": true}}')
    assert (await cached("t", {"q": 1}, call, Answer)).value == 2
    _path("t", {"q": 1}).write_text("{half a fi")
    assert (await cached("t", {"q": 1}, call, Answer)).value == 3


async def test_age_can_depend_on_the_result(monkeypatch: pytest.MonkeyPatch) -> None:
    call = Counter()
    keep = lambda answer: 60 if answer.value % 2 else 3600
    await cached("t", {"q": 1}, call, Answer, max_age_s=keep)  # value 1: kept 60 s
    later = time.time() + 120
    monkeypatch.setattr(time, "time", lambda: later)
    assert (await cached("t", {"q": 1}, call, Answer, max_age_s=keep)).value == 2  # refreshed
    assert (await cached("t", {"q": 1}, call, Answer, max_age_s=keep)).value == 2  # kept an hour


async def test_two_writers_of_the_same_entry_do_not_collide() -> None:
    import asyncio

    async def slow_answer(value: int) -> Answer:
        await asyncio.sleep(0.01)
        return Answer(value=value)

    results = await asyncio.gather(
        *(cached("t", {"q": "same"}, lambda v=v: slow_answer(v), Answer) for v in range(20))
    )
    assert len(results) == 20
    from app.cache import cache_path

    folder = cache_path("t", {"q": "same"}).parent
    assert [p.suffix for p in folder.iterdir()] == [".json"]  # no temp files left behind
