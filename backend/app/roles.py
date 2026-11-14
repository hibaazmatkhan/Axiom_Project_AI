"""Roles and asymmetric information.

No single player sees the full picture. The server filters every round payload
and snapshot by the player's role so no client receives another role's hidden
data.

  navigator   - sees the grid and exactly which rooms shifted
  oracle      - sees sigils, door colours and the cleanest possible futures
  timekeeper  - sees d10 results, remaining door capacity and timing
  archivist   - sees the previous grid configuration
"""
from __future__ import annotations

ROLES = ("navigator", "oracle", "timekeeper", "archivist")
ROLE_LABELS = {
    "navigator": "Navigator",
    "oracle": "Oracle",
    "timekeeper": "Timekeeper",
    "archivist": "Archivist",
}
ROLE_HINTS = {
    "navigator": "You see the grid and which rooms shifted. Call the route.",
    "oracle": "You see sigils and the clearest possible futures. Find the exit.",
    "timekeeper": "You see d10 results and remaining door capacity. Call the timing.",
    "archivist": "You see the previous grid. Compare it with the living one.",
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
        elif role == "timekeeper":
            out[code] = {
                "rid": room.get("rid"),
                "doors": {
                    d: {"capacity": g.get("capacity")}
                    for d, g in doors.items()
                },
            }
        elif role == "navigator":
            out[code] = {
                "rid": room.get("rid"),
                "doors": {
                    d: {"future": g.get("future") if g.get("future") in ("exit", "void") else "unknown"}
                    for d, g in doors.items()
                },
            }
        # archivist receives the previous arena instead of visions
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
        "exit_unsealed": payload.get("exit_unsealed", False),
        "futures": _futures_for(payload, role),
    }
    if role == "navigator":
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
        base["dice"] = payload.get("dice", {})
    elif role == "archivist":
        base["moved"] = []
        base["previous"] = prev_arena
    else:
        base["moved"] = moved
    return base


def filter_arena(arena: dict, role: str, current_code: str | None = None) -> dict:
    """Strip another role's private intel from the shared arena."""
    rooms = []
    for room in arena.get("rooms", []):
        r = dict(room)
        doors = {}
        for d, door in r.get("doors", {}).items():
            dd = dict(door)
            if role != "timekeeper":
                dd["capacity"] = None
                dd["roll"] = None
            doors[d] = dd
        r["doors"] = doors
        if role not in ("oracle", "archivist"):
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
    current = (snap.get("you") or {}).get("room_code")
    if "arena" in snap:
        snap["arena"] = filter_arena(snap["arena"], role, current)
    if role != "timekeeper":
        dice = snap.get("dice") or {}
        snap["dice"] = {current: dice[current]} if current in dice else {}
    snap["role"] = role
    snap["role_label"] = ROLE_LABELS.get(role, role)
    snap["role_hint"] = ROLE_HINTS.get(role, "")
    return snap
