"""ULID ids (`<prefix>_<26 Crockford base32 chars>`) with no dependency."""

from __future__ import annotations

import secrets
import time

_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def new_id(prefix: str) -> str:
    """48-bit ms timestamp + 80 random bits, e.g. new_id("evt") -> evt_01JD8X5Q2M9VTRC3B7K4N6P0WY."""
    n = (int(time.time() * 1000) << 80) | secrets.randbits(80)
    return f"{prefix}_" + "".join(_ALPHABET[(n >> s) & 31] for s in range(125, -1, -5))
