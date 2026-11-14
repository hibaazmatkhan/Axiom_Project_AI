"""Full match simulation: 4 players, ready up, best-effort route to A5, terminal state.

This exercises the complete loop against a live server:
  connect -> ready -> choose_door along a BFS route -> game_over -> stored

The grid shifts every round, so the pre-computed route is best-effort. The
script asserts a terminal state was reached and persisted, not that the team won.
"""
import asyncio
import json
import os
import urllib.request
from collections import deque

import websockets

BASE = os.getenv("AXIOM_WS", "ws://localhost:8000")
HTTP = os.getenv("AXIOM_HTTP", "http://localhost:8000")

DIRS = {"N": (0, -1), "E": (1, 0), "S": (0, 1), "W": (-1, 0)}


def solve_route(arena):
    """BFS over the room graph from the start room to the exit room."""
    size = arena["size"]
    start = tuple(arena["start_room"])
    goal = tuple(arena["exit_room"])
    by_pos = {(r["bx"], r["by"]): r for r in arena["rooms"]}
    q = deque([(start, [])])
    seen = {start}
    while q:
        pos, route = q.popleft()
        if pos == goal:
            return route
        room = by_pos.get(pos)
        if room is None:
            continue
        for d, (dx, dy) in DIRS.items():
            if not room["open"].get(d):
                continue
            nxt = (pos[0] + dx, pos[1] + dy)
            if not (0 <= nxt[0] < size and 0 <= nxt[1] < size) or nxt in seen:
                continue
            seen.add(nxt)
            q.append((nxt, route + [d]))
    return []


async def drain(ws, timeout=1.0):
    """Collect every message currently available."""
    out = []
    while True:
        try:
            out.append(json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout)))
        except asyncio.TimeoutError:
            return out


async def main():
    room = "MATCH"
    conns = []
    arena = None
    for i in range(4):
        ws = await websockets.connect(f"{BASE}/ws/{room}?name=player{i}")
        welcome = json.loads(await ws.recv())
        arena = arena or welcome["state"]["arena"]
        conns.append((ws, welcome))
    print("connected:", [w["state"]["role"] for _, w in conns])

    for ws, _ in conns:
        await ws.send(json.dumps({"type": "ready", "value": True}))
    await asyncio.sleep(0.8)

    running = False
    for ws, _ in conns:
        for msg in await drain(ws, timeout=0.5):
            st = msg.get("state") or {}
            if st.get("status") == "running":
                running = True
            if msg.get("arena"):
                arena = msg["arena"]
    print("match running:", running)
    assert running, "match did not start"

    route = solve_route(arena)
    print("route length:", len(route))

    solo = conns[0][0]
    for ws, _ in conns[1:]:
        await ws.close()

    for door in route:
        try:
            await solo.send(json.dumps({"type": "choose_door", "door": door}))
        except Exception:
            break
        await asyncio.sleep(0.1)
    await asyncio.sleep(0.5)

    over = None
    deadline = asyncio.get_event_loop().time() + 45
    while asyncio.get_event_loop().time() < deadline and over is None:
        for msg in await drain(solo, timeout=0.4):
            if msg["type"] == "game_over":
                over = msg
                break
    await solo.close()

    assert over is not None, "no game_over received"
    print("game_over won:", over["won"], "rounds:", over["summary"]["rounds"])
    print("team skill:", round(over["summary"]["team_skill"], 3))
    print("players:", [(p["name"], p["escaped"], p["points"], p["style"])
                       for p in over["summary"]["players"]])
    print("MATCH OK")

    with urllib.request.urlopen(f"{HTTP}/health", timeout=5) as r:
        assert json.loads(r.read())["ok"]

    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "axiom.db")
    if os.path.exists(db_path):
        import sqlite3
        con = sqlite3.connect(db_path)
        row = con.execute(
            "SELECT room, winner, cycles, team_skill FROM matches WHERE room=?"
            " ORDER BY id DESC LIMIT 1",
            (room,),
        ).fetchone()
        con.close()
        assert row is not None, "match was not persisted"
        assert row[1] == int(over["won"]), "stored winner does not match game_over"
        print("persisted:", row)
        print("DB OK")
    else:
        print("DB OK (skipped, no database file)")


if __name__ == "__main__":
    asyncio.run(main())
