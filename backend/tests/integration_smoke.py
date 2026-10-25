"""End-to-end integration check: 4 players, ready up, move, predict, transition.

Run against a live server:  python tests/integration_smoke.py
"""
import asyncio
import json
import os
import urllib.request

import websockets

BASE = os.getenv("AXIOM_WS", "ws://localhost:8000")
HTTP = os.getenv("AXIOM_HTTP", "http://localhost:8000")


def check_http():
    with urllib.request.urlopen(f"{HTTP}/health", timeout=5) as r:
        data = json.loads(r.read())
    assert data["ok"], data
    print("HTTP /health ok:", data)


async def player(room, name, ready=True):
    ws = await websockets.connect(f"{BASE}/ws/{room}?name={name}")
    welcome = json.loads(await ws.recv())
    assert welcome["type"] == "welcome"
    role = welcome["state"]["role"]
    maze = welcome["state"]["maze"]
    x, y = maze["start"]
    if ready:
        await ws.send(json.dumps({"type": "ready", "value": True}))
    # find a legal step
    step = None
    for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
        if maze["tiles"][y + dy][x + dx] == ".":
            step = (dx, dy)
            break
    return ws, role, step


async def main():
    check_http()
    room = "SMOKE"
    conns = [await player(room, f"sim{i}") for i in range(4)]
    roles = sorted(r for _, r, _ in conns)
    print("roles:", roles)
    # move each player
    for ws, _, step in conns:
        if step:
            await ws.send(json.dumps({"type": "move", "dx": step[0], "dy": step[1]}))
    # prediction from one player
    await conns[0][0].send(json.dumps({"type": "predict", "pattern_type": "symbol"}))
    # collect messages until we have seen a transition (bounded by the server timer)
    seen = set()
    deadline = asyncio.get_event_loop().time() + 40
    while asyncio.get_event_loop().time() < deadline:
        for ws, _, _ in conns:
            try:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=0.4))
            except asyncio.TimeoutError:
                continue
            seen.add(msg.get("type"))
            if msg.get("type") == "transition":
                break
        if "transition" in seen:
            break
    for ws, _, _ in conns:
        await ws.close()
    print("message types seen:", sorted(seen))
    assert "players" in seen or "state" in seen
    assert "transition" in seen, "no transition observed"
    print("SMOKE OK")


if __name__ == "__main__":
    asyncio.run(main())
