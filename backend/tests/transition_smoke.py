"""Focused check that the round timer broadcasts a role-filtered grid shift.

Runs with the full four-player roster so it works regardless of MIN_PLAYERS,
and asserts that each role receives exactly the slice of the change it owns.
"""
import asyncio
import json
import os
import urllib.request

import websockets

BASE = os.getenv("AXIOM_WS", "ws://localhost:8000")
BASE_HTTP = os.getenv(
    "AXIOM_HTTP", BASE.replace("ws://", "http://").replace("wss://", "https://")
)


async def main():
    request = urllib.request.Request(
        f"{BASE_HTTP}/api/rooms",
        data=json.dumps({"min_players": 4}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        room = json.load(response)["code"]

    conns = []
    for i in range(4):
        ws = await websockets.connect(f"{BASE}/ws/{room}?name=solo{i}")
        welcome = json.loads(await ws.recv())
        conns.append((ws, welcome["state"]["role"]))
    roles = [r for _, r in conns]
    assert sorted(roles) == ["decoder", "pathfinder", "timekeeper", "watcher"], roles

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
    assert got["pathfinder"]["moved"], "pathfinder saw no moved rooms"
    assert "sigil" not in got["pathfinder"]["moved"][0], "pathfinder leaked a sigil"
    assert got["watcher"]["moved"] == [], "watcher saw move intel"
    assert len(got["watcher"].get("sigils", [])) == len(got["pathfinder"]["moved"])
    for view in (got["watcher"], got["watcher"].get("state", {})):
        for room in view.get("arena", {}).get("rooms", []):
            assert not room.get("sigil"), "watcher leaked a sigil"
            assert not room.get("future"), "watcher leaked a future"
    assert got["timekeeper"]["timing"]["next_in"] >= 0, "timekeeper saw no timing"
    assert "dice" not in got["timekeeper"], "timekeeper saw dice"
    assert "timing" not in got["decoder"], "decoder saw the countdown"
    assert "previous" in got["decoder"], "decoder received no previous layout field"
    assert "arena" in got["pathfinder"], "round carried no arena"

    print("round:", got["pathfinder"]["round"], "pattern:", got["pathfinder"]["pattern_type"])
    print("moved rooms:", len(got["pathfinder"]["moved"]), "has arena:", "arena" in got["pathfinder"])
    print("roles filtered:", sorted(got))
    print("TRANSITION OK")


if __name__ == "__main__":
    asyncio.run(main())
