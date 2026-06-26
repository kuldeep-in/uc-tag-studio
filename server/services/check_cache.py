"""Short-lived in-process cache for expensive health/permission checks.

Results are stored keyed by an arbitrary string and expire after TTL seconds.
Both the health-check stream and the permissions-tree endpoint share this cache
so repeated calls on the same page hit each warehouse/catalog check only once.
"""

from __future__ import annotations

import threading
import time
from typing import Any

_DEFAULT_TTL = 120  # seconds

_store: dict[str, tuple[float, Any]] = {}
_lock = threading.Lock()


def get(key: str) -> tuple[bool, Any]:
    """Return (hit, value). hit=False means expired or missing."""
    with _lock:
        entry = _store.get(key)
    if entry is None:
        return False, None
    expires_at, value = entry
    if time.time() > expires_at:
        return False, None
    return True, value


def put(key: str, value: Any, ttl: int = _DEFAULT_TTL) -> None:
    with _lock:
        _store[key] = (time.time() + ttl, value)


def get_or_run(key: str, fn, ttl: int = _DEFAULT_TTL) -> Any:
    """Return cached value if fresh; otherwise call fn(), cache, and return result."""
    hit, value = get(key)
    if hit:
        return value
    value = fn()
    put(key, value, ttl)
    return value


def delete(key: str) -> None:
    """Remove a single cache entry (e.g. after a mutation)."""
    with _lock:
        _store.pop(key, None)


def delete_prefix(prefix: str) -> None:
    """Remove all entries whose key starts with prefix."""
    with _lock:
        for k in [k for k in _store if k.startswith(prefix)]:
            del _store[k]
