"""End-to-end integration check: 4 players, ready up, door move, round.

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


async def player(room, name):
    ws = await websockets.connect(f"{BASE}/ws/{room}?name={name}")
    welcome = json.loads(await ws.recv())
    assert welcome["type"] == "welcome"
    role = welcome["state"]["role"]
    doors = welcome["state"]["you"]["doors"]
    door = next((d for d, v in doors.items() if v["open"]), None)
    await ws.send(json.dumps({"type": "ready", "value": True}))
    return ws, role, door


async def main():
    check_http()
    room = "SMOKE"
    conns = [await player(room, f"sim{i}") for i in range(4)]
    print("roles:", sorted(r for _, r, _ in conns))
    for ws, _, door in conns:
        if door:
            await ws.send(json.dumps({"type": "choose_door", "door": door}))
    await conns[0][0].send(json.dumps({"type": "predict", "pattern_type": "translation"}))
    seen = set()
    deadline = asyncio.get_event_loop().time() + 40
    while asyncio.get_event_loop().time() < deadline:
        for ws, _, _ in conns:
            try:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=0.4))
            except asyncio.TimeoutError:
                continue
            seen.add(msg.get("type"))
            if msg.get("type") == "round":
                break
        if "round" in seen:
            break
    for ws, _, _ in conns:
        await ws.close()
    print("message types seen:", sorted(seen))
    assert "players" in seen or "state" in seen
    assert "round" in seen, "no round observed"
    print("SMOKE OK")


if __name__ == "__main__":
    asyncio.run(main())
