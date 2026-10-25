"""AXIOM roles and asymmetric information (WP3, task 28; WP1 contracts).

No single player sees the full picture. The server filters every snapshot by the
player's role so no client receives another role's hidden data (O3).

  mover        - sees which blocks moved this transition (positions)
  symbolist    - sees the symbols attached to the moved blocks
  chronologist - sees the timing / schedule of the next transition
  archivist    - sees the previous maze configuration
"""
from __future__ import annotations

ROLES = ("mover", "symbolist", "chronologist", "archivist")
ROLE_LABELS = {
    "mover": "Mover",
    "symbolist": "Symbolist",
    "chronologist": "Chronologist",
    "archivist": "Archivist",
}
ROLE_HINTS = {
    "mover": "You see WHERE blocks move each change. Watch the floor flashes.",
    "symbolist": "You see the SYMBOL carried by every block that moves.",
    "chronologist": "You see WHEN the next change happens. Share the timing.",
    "archivist": "You see the PREVIOUS layout as a violet ghost. Compare the two states.",
}


def role_for_slot(slot: int) -> str:
    return ROLES[slot % len(ROLES)]


def filter_transition(payload: dict, role: str, prev_maze: dict | None) -> dict:
    """Return a transition payload containing only what `role` may see."""
    moved = payload.get("moved", [])
    base = {
        "type": "transition",
        "cycle": payload.get("cycle"),
        "pattern_type": payload.get("pattern_type"),
        "active": payload.get("active", True),
    }
    if role == "mover":
        base["moved"] = [{"bx": m["bx"], "by": m["by"]} for m in moved]
    elif role == "symbolist":
        base["moved"] = [{"bx": m["bx"], "by": m["by"], "symbol": m["symbol"]} for m in moved]
        base["symbols"] = sorted({m["symbol"] for m in moved})
    elif role == "chronologist":
        base["moved"] = []
        base["timing"] = {"next_in": payload.get("next_transition_in")}
    elif role == "archivist":
        base["moved"] = []
        base["previous"] = prev_maze
    else:
        base["moved"] = moved
    return base


def filter_snapshot(snapshot: dict, role: str) -> dict:
    """Snapshots are mostly shared; only role-specific extras are appended."""
    snap = dict(snapshot)
    snap["role"] = role
    snap["role_label"] = ROLE_LABELS.get(role, role)
    snap["role_hint"] = ROLE_HINTS.get(role, "")
    return snap
