"""Shared persistence errors exposed by the API layer."""
from __future__ import annotations


class MatchStoreUnavailable(RuntimeError):
    pass
