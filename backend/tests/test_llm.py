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
