"""Focused check that the transition timer broadcasts a role-filtered change.

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
    assert sorted(roles) == ["archivist", "chronologist", "mover", "symbolist"], roles

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
            if msg["type"] == "transition":
                got[role] = msg
    for ws, _ in conns:
        await ws.close()

    assert len(got) == 4, f"only {sorted(got)} received a transition"
    assert got["mover"]["moved"], "mover saw no moved blocks"
    assert "symbol" not in got["mover"]["moved"][0], "mover leaked a symbol"
    assert got["symbolist"]["symbols"], "symbolist saw no symbols"
    assert got["chronologist"]["timing"]["next_in"] > 0, "chronologist saw no timing"
    assert got["archivist"]["previous"], "archivist saw no previous layout"
    assert "maze" in got["mover"], "transition carried no maze"

    print("transition cycle:", got["mover"]["cycle"], "pattern:", got["mover"]["pattern_type"])
    print("moved blocks:", len(got["mover"]["moved"]), "has maze:", "maze" in got["mover"])
    print("roles filtered:", sorted(got))
    print("TRANSITION OK")


if __name__ == "__main__":
    asyncio.run(main())
