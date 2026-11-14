"""Backwards-compatible shim for the old maze module.

The game is now a 5x5 matrix of rooms; the real model lives in ``app.arena``.
This module only keeps old import paths working while the codebase migrates.
"""
from .arena import (  # noqa: F401
    Arena,
    Arena as Maze,
    Door,
    PATTERN_TYPES,
    Room,
    Room as Block,
    Shift,
    START_ROOM,
    EXIT_ROOM,
    DOOR_COLORS,
    SIGILS,
    STEP,
    OPPOSITE,
    room_code,
    code_to_pos,
    astar,
    reachable_after_changes,
)

BLOCK = 1
SYMBOLS = SIGILS
MATERIALS = ("concrete", "steel", "glass")
GATE_COLORS = DOOR_COLORS
