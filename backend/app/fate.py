"""Fate Dice, door seals, visions and Sanction resolution.

Each round every room rolls its four coloured d10s. A roll of 0 or 1 seals an
otherwise open door; 2-9 leaves it open. A room always keeps at least one open
door.

Visions ("possible futures") are deterministic previews derived from the seed,
round and the hidden pattern state. They are filtered per role by ``roles.py``.
"""
from __future__ import annotations

import random

from .arena import DOOR_COLORS, DIRECTIONS, Arena, Room

START_VITALITY = 15
START_POINTS = START_VITALITY
MAX_ROUNDS = 0
DOOR_COST = 1
MOVE_COST = DOOR_COST  # backwards-compatible alias
WAIT_COST = 1
REVIVE_COST = 1


def roll_round(arena: Arena, rng: random.Random, relief: int = 0) -> dict:
    """Roll every room's four d10s and set each open door's seal state.

    ``relief`` is the Dealer's bounded public dice modification: a positive
    value adds a bonus to every roll, making seals less likely. The number of
    random draws is unchanged, so seeded replays stay comparable.
    """
    bonus = max(0, min(2, int(relief or 0)))
    summary: dict[str, dict] = {}
    for room in arena.rooms:
        doors: dict[str, dict] = {}
        open_dirs = [d for d in DIRECTIONS if arena.door_open(room, d)]
        for d in DIRECTIONS:
            door = room.doors[d]
            if d not in open_dirs:
                door.rolled_sealed = False
                continue
            roll = rng.randint(0, 9) + bonus
            door.rolled_sealed = roll <= 1
            doors[d] = {"color": door.color}

        # Never seal every door in a room: a zero round would deadlock it.
        if open_dirs and all(room.doors[d].rolled_sealed for d in open_dirs):
            d = rng.choice(open_dirs)
            room.doors[d].rolled_sealed = False

        summary[room.code] = {"room": room.code, "rid": room.rid, "doors": doors}
    return summary


def neighbour(arena: Arena, room: Room, d: str) -> Room | None:
    return arena.door_target(room, d)


def gate_preview(arena: Arena, room: Room, d: str) -> str:
    """Ground-truth preview of what lies beyond a door."""
    target = arena.door_target(room, d)
    if target is None:
        return "void"
    if target.sanction:
        return "sanction"
    return "open"


def build_visions(arena: Arena, rng: random.Random, round_no: int) -> dict[str, dict]:
    """Deterministic door visions for the round.

    Ground truth is mixed with a small amount of seeded noise so a vision is a
    *possible* future, not a perfect map. The Pathfinder sees the cleanest signal.
    """
    visions: dict[str, dict] = {}
    for room in arena.rooms:
        doors: dict[str, dict] = {}
        for d in DIRECTIONS:
            truth = gate_preview(arena, room, d)
            noisy = truth
            if truth not in ("void",) and rng.random() < 0.18:
                noisy = rng.choice(["open", "sanction", "open"])
            doors[d] = {
                "future": noisy,
                "truth": truth,
                "color": room.doors[d].color,
            }
        visions[room.code] = {"rid": room.rid, "sigil": room.sigil, "doors": doors}
        special = [doors[d]["future"] for d in DIRECTIONS
                   if doors[d]["future"] == "sanction"]
        room.future = special[0] if special else "open"
    return visions


def reveal(arena: Arena, room: Room) -> bool:
    """Reveal a room's Sanction the first time it is discovered."""
    if room.revealed:
        return False
    room.revealed = True
    return True


def sanitize_positions(arena: Arena, players) -> None:
    """Compatibility hook: players are always inside a room now."""
    for p in players:
        if arena.room_by_id(getattr(p, "room_id", "")) is None:
            p.room_id = arena.start_room().rid


def gate_between(arena: Arena, a: Room, b: Room) -> str | None:
    from .arena import STEP
    dx, dy = b.bx - a.bx, b.by - a.by
    return next((d for d, step in STEP.items() if step == (dx, dy)), None)


def opposite(d: str) -> str:
    from .arena import OPPOSITE
    return OPPOSITE[d]


def colors() -> tuple[str, ...]:
    return DOOR_COLORS
