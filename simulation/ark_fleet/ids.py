"""Crockford-base32 ULIDs that draw their randomness from a caller-supplied RNG, so runs are reproducible."""

from __future__ import annotations

import random

_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # Crockford: no I, L, O, U


def ulid(rng: random.Random, time_ms: int) -> str:
    """26 characters: 10 of millisecond time (48 bits), 16 of randomness (80 bits)."""
    t = time_ms & ((1 << 48) - 1)
    r = rng.getrandbits(80)
    value = (t << 80) | r
    return "".join(_ALPHABET[(value >> shift) & 31] for shift in range(125, -1, -5))
