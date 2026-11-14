"""The hosted planner must use the same working provider as the render path."""

from unittest.mock import AsyncMock, Mock

from app import llm as module
from app.tools.fal_client import FalResult


async def test_fal_planning_is_used_even_with_a_stale_gemini_key(monkeypatch):
    monkeypatch.setenv("FAL_KEY", "test-only")
    monkeypatch.setenv("GEMINI_API_KEY", "stale-test-key")
    monkeypatch.setenv("FAL_LLM_MODEL", "google/gemini-2.5-flash")
    call = AsyncMock(return_value=FalResult(data={"output": '{"ready": true}'}))
    direct = Mock(side_effect=AssertionError("Should use the configured fal service"))
    monkeypatch.setattr(module, "fal", call)
    monkeypatch.setattr(module.genai, "Client", direct)
    assert await module.llm("Return JSON", images=[(b"image", "image/jpeg")], json_out=True) == {
        "ready": True
    }
    assert call.await_args.args[0] == "openrouter/router/vision"
    assert call.await_args.args[1]["model"] == "google/gemini-2.5-flash"
    direct.assert_not_called()


def test_replay_planning_does_not_require_provider_credentials(monkeypatch):
    monkeypatch.setenv("REPLAY", "1")
    monkeypatch.delenv("FAL_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    assert module.llm_available()


async def test_vision_judgements_use_the_sharper_model_and_survive_one_broken_answer(
    monkeypatch,
):
    monkeypatch.setenv("FAL_KEY", "test-only")
    monkeypatch.delenv("VISION_MODEL", raising=False)
    answers = [FalResult(data={"output": '{"ok": [1}}'}), FalResult(data={"output": '{"ok": 1}'})]
    call = AsyncMock(side_effect=answers)
    monkeypatch.setattr(module, "fal", call)
    assert await module.llm("Judge", json_out=True, vision=True) == {"ok": 1}
    assert call.await_count == 2
    assert call.await_args.args[1]["model"] == module.VISION_MODEL
    assert call.await_args.args[1]["prompt"].endswith("Return strictly valid JSON.")


async def test_box_closed_with_a_brace_is_repaired(monkeypatch):
    monkeypatch.setenv("FAL_KEY", "test-only")
    raw = '{"products": [{"box_2d": [1, 2, 3, 4]}, {"box_2d": [764, 356, 988, 644}]}'
    monkeypatch.setattr(module, "fal", AsyncMock(return_value=FalResult(data={"output": raw})))
    assert await module.llm("Judge", json_out=True, vision=True) == {
        "products": [{"box_2d": [1, 2, 3, 4]}, {"box_2d": [764, 356, 988, 644]}]
    }
    raw = raw.replace("644}]}", "659}}]}")
    monkeypatch.setattr(module, "fal", AsyncMock(return_value=FalResult(data={"output": raw})))
    result = await module.llm("Judge again", json_out=True, vision=True)
    assert result["products"][1]["box_2d"] == [764, 356, 988, 659]
