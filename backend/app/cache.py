"""Every external call goes through `cached()`, keyed by a hash of its inputs.

Live: a fresh enough saved result is reused, otherwise the call runs and is saved.
REPLAY=1: only saved results are used, so the demo runs with no network.
Files live in demo/cache/<namespace>/<hash>.json and can be committed for replay.
"""

import hashlib
import json
import os
import time
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from pydantic import TypeAdapter, ValidationError

from app.config import get_settings

HOUR = 3600
DAY = 24 * HOUR
WEEK = 7 * DAY


class ReplayMiss(Exception):
    """REPLAY=1 asked for something that was never recorded."""


def cache_key(inputs: dict[str, Any]) -> str:
    raw = json.dumps(inputs, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def cache_path(namespace: str, inputs: dict[str, Any]) -> Path:
    return get_settings().cache_dir / namespace / f"{cache_key(inputs)}.json"


def load_saved[T](path: Path, result_type: type[T]) -> T | None:
    """The saved result whatever its age, or None. Never touches the network."""
    saved = _load(path, TypeAdapter(result_type))
    return saved[1] if saved else None


def _load[T](path: Path, adapter: TypeAdapter[T]) -> tuple[float, T] | None:
    """A file that is half written or from an older data layout counts as missing."""
    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
        return float(saved["saved_at"]), adapter.validate_python(saved["result"])
    except (OSError, ValueError, KeyError, TypeError, ValidationError):
        return None


async def cached[T](
    namespace: str,
    inputs: dict[str, Any],
    call: Callable[[], Awaitable[T]],
    result_type: type[T],
    max_age_s: float | None | Callable[[T], float | None] = None,
) -> T:
    """`max_age_s=None`: any saved copy is good. A function picks the age per result,
    e.g. keep good reads for a day but retry failures after an hour."""
    adapter = TypeAdapter(result_type)
    path = cache_path(namespace, inputs)
    saved = _load(path, adapter)

    if saved is not None:
        saved_at, result = saved
        limit = max_age_s(result) if callable(max_age_s) else max_age_s
        if get_settings().replay or limit is None or time.time() - saved_at < limit:
            return result
    if get_settings().replay:
        raise ReplayMiss(
            f"No recorded result for {namespace} {json.dumps(inputs, ensure_ascii=False)}"
        )

    result = await call()
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "saved_at": time.time(),
        "inputs": inputs,
        "result": adapter.dump_python(result, mode="json"),
    }
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")  # one per writer
    tmp.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)  # atomic: a crash never leaves half a file
    return result
