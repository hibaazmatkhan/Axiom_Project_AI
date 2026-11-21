"""Roles and asymmetric information.

No single player sees the full picture. The server filters every round payload
and snapshot by the player's role so no client receives another role's hidden
data.

  pathfinder  - reveals sealed doors and sanction rooms until the next shift
  oracle      - sees sigils, door colours and the cleanest possible futures
  timekeeper  - sees the countdown and holds the delay puzzle key
  decoder     - sees and answers the delay puzzle question
"""
from __future__ import annotations

ROLES = ("pathfinder", "oracle", "timekeeper", "decoder")
ROLE_LABELS = {
    "pathfinder": "Pathfinder",
    "oracle": "Oracle",
    "timekeeper": "Timekeeper",
    "decoder": "Decoder",
}
ROLE_HINTS = {
    "pathfinder": "Reveal the wristband map once per shift to read blocked walls and sanction rooms.",
    "oracle": "You see sigils and the clearest possible futures. Find the exit.",
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
        if role == "oracle":
            out[code] = {
                "rid": room.get("rid"),
                "sigil": room.get("sigil"),
                "doors": {
                    d: {"future": g.get("future"), "color": g.get("color")}
                    for d, g in doors.items()
                },
            }
        elif role == "pathfinder":
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
    elif role == "oracle":
        base["moved"] = [
            {"from": m.get("from"), "to": m.get("to"),
             "code_from": m.get("code_from"), "code_to": m.get("code_to"),
             "sigil": m.get("sigil")}
            for m in moved
        ]
        base["sigils"] = sorted({m["sigil"] for m in moved if m.get("sigil")})
        base["ops"] = payload.get("ops", [])
    elif role == "timekeeper":
        base["moved"] = []
        base["timing"] = {"next_in": payload.get("next_round_in")}
    else:
        base["moved"] = []
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
        if role != "oracle":
            r["sigil"] = None
        if not r.get("revealed"):
            r["sanction"] = None
        if role != "oracle":
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
    return snap
