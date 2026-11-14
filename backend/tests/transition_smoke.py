"""Focused check that the round timer broadcasts a role-filtered grid shift.

Runs with the full four-player roster so it works regardless of MIN_PLAYERS,
and asserts that each role receives exactly the slice of the change it owns.
"""
import asyncio
import json
import os

import websockets

BASE = os.getenv("AXIOM_WS", "ws://localhost:8000")


async def main():
    room = "TRANS"
    conns = []
    for i in range(4):
        ws = await websockets.connect(f"{BASE}/ws/{room}?name=solo{i}")
        welcome = json.loads(await ws.recv())
        conns.append((ws, welcome["state"]["role"]))
    roles = [r for _, r in conns]
    assert sorted(roles) == ["archivist", "navigator", "oracle", "timekeeper"], roles

    for ws, _ in conns:
        await ws.send(json.dumps({"type": "ready", "value": True}))

    got = {}
    deadline = asyncio.get_event_loop().time() + 40
    while asyncio.get_event_loop().time() < deadline and len(got) < 4:
        for ws, role in conns:
            if role in got:
                continue
            try:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=0.5))
            except asyncio.TimeoutError:
                continue
            if msg["type"] == "round":
                got[role] = msg
    for ws, _ in conns:
        await ws.close()

    assert len(got) == 4, f"only {sorted(got)} received a round"
    assert got["navigator"]["moved"], "navigator saw no moved rooms"
    assert "sigil" not in got["navigator"]["moved"][0], "navigator leaked a sigil"
    assert got["oracle"]["sigils"], "oracle saw no sigils"
    assert got["timekeeper"]["timing"]["next_in"] >= 0, "timekeeper saw no timing"
    assert got["archivist"]["previous"], "archivist saw no previous layout"
    assert "arena" in got["navigator"], "round carried no arena"

    print("round:", got["navigator"]["round"], "pattern:", got["navigator"]["pattern_type"])
    print("moved rooms:", len(got["navigator"]["moved"]), "has arena:", "arena" in got["navigator"])
    print("roles filtered:", sorted(got))
    print("TRANSITION OK")


if __name__ == "__main__":
    asyncio.run(main())
