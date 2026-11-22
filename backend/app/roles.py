"""Roles and asymmetric information.

No single player sees the full picture. The server filters every round payload
and snapshot by the player's role so no client receives another role's hidden
data.

  pathfinder  - reveals sealed doors and sanction rooms until the next shift
  watcher     - gets the full KING OF SPADES schedule and live alerts only for the watcher
  timekeeper  - sees the countdown and holds the delay puzzle key
  decoder     - sees and answers the delay puzzle question
"""
from __future__ import annotations

ROLES = ("pathfinder", "watcher", "timekeeper", "decoder")
ROLE_LABELS = {
    "pathfinder": "Pathfinder",
    "watcher": "Watcher",
    "timekeeper": "Timekeeper",
    "decoder": "Decoder",
}
ROLE_HINTS = {
    "pathfinder": "Reveal the wristband map once per shift to read blocked walls and sanction rooms.",
    "watcher": "You see the full KING OF SPADES schedule, including every appearance and teleport room. Warn the team.",
    "timekeeper": "You alone see the countdown. Queue a tier and pass the key to the Decoder.",
    "decoder": "You see the puzzle question and answer it. Ask the Timekeeper for the key.",
}


def role_for_slot(slot: int) -> str:
    return ROLES[slot % len(ROLES)]


def _futures_for(payload: dict, role: str) -> dict:
    visions = payload.get("visions") or {}
    out: dict[str, dict] = {}
    for code, room in visions.items():
        doors = room.get("doors", {})
        if role == "pathfinder":
            out[code] = {
                "rid": room.get("rid"),
                "doors": {
                    d: {"future": g.get("future") if g.get("future") == "void" else "unknown"}
                    for d, g in doors.items()
                },
            }
    return out


def filter_visions(visions: dict, role: str) -> dict:
    """Public helper: role-filtered possible futures."""
    return _futures_for({"visions": visions}, role)


def filter_round(payload: dict, role: str, prev_arena: dict | None) -> dict:
    """Return a round payload containing only what `role` may see."""
    moved = payload.get("moved", [])
    base = {
        "type": "round",
        "round": payload.get("round"),
        "pattern_type": payload.get("pattern_type"),
        "pattern_types": payload.get("pattern_types"),
        "active": payload.get("active", True),
        "pa": payload.get("pa", ""),
        "futures": _futures_for(payload, role),
    }
    if role == "pathfinder":
        base["moved"] = [
            {"from": m.get("from"), "to": m.get("to"),
             "code_from": m.get("code_from"), "code_to": m.get("code_to")}
            for m in moved
        ]
        base["ops"] = [
            {k: v for k, v in op.items() if k in ("kind", "index", "direction", "axis")}
            for op in payload.get("ops", [])
        ]
    elif role == "watcher":
        base["moved"] = []
        base["sigils"] = [m.get("sigil") for m in moved if m.get("sigil")]
    elif role == "timekeeper":
        base["moved"] = []
        base["timing"] = {"next_in": payload.get("next_round_in")}
    else:
        base["moved"] = []
        if prev_arena:
            base["previous"] = filter_arena(prev_arena, role)
    return base


def filter_arena(arena: dict, role: str, current_code: str | None = None) -> dict:
    """Strip another role's private intel from the shared arena."""
    rooms = []
    for room in arena.get("rooms", []):
        r = dict(room)
        doors = {}
        for d, door in r.get("doors", {}).items():
            doors[d] = dict(door)
        r["doors"] = doors
        r["sigil"] = None
        if not r.get("revealed"):
            r["sanction"] = None
        r["future"] = None
        rooms.append(r)
    out = dict(arena)
    out["rooms"] = rooms
    return out


def filter_snapshot(snapshot: dict, role: str) -> dict:
    """Snapshots are mostly shared; role-specific extras are appended."""
    snap = dict(snapshot)
    snap["sanction_total"] = snapshot.get("sanction_total", 0)
    snap["sanction_found"] = snapshot.get("sanction_found", 0)
    current = (snap.get("you") or {}).get("room_code")
    if "arena" in snap:
        snap["arena"] = filter_arena(snap["arena"], role, current)
    snap["dice"] = {}
    snap["role"] = role
    snap["role_label"] = ROLE_LABELS.get(role, role)
    snap["role_hint"] = ROLE_HINTS.get(role, "")
    snap.pop("king", None)
    if role != "watcher":
        snap.pop("king_watch", None)
    return snap
