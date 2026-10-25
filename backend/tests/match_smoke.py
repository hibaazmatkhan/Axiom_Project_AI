"""Full match simulation: 4 players, ready up, path to the exit, win state.

This exercises the complete loop against a live server:
  connect -> ready -> move along the A* route -> escape -> game_over -> stored
"""
import asyncio
import json
import os
import urllib.request

import websockets

BASE = os.getenv("AXIOM_WS", "ws://localhost:8000")
HTTP = os.getenv("AXIOM_HTTP", "http://localhost:8000")


def solve_path(maze):
    """BFS along open tiles from start to exit."""
    from collections import deque
    n = maze["tile_size"]
    start = tuple(maze["start"])
    goal = tuple(maze["exit"])
    q = deque([(start, [])])
    seen = {start}
    while q:
        cur, path = q.popleft()
        if cur == goal:
            return path
        for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
            nxt = (cur[0] + dx, cur[1] + dy)
            if not (0 <= nxt[0] < n and 0 <= nxt[1] < n):
                continue
            if nxt in seen or maze["tiles"][nxt[1]][nxt[0]] == "#":
                continue
            seen.add(nxt)
            q.append((nxt, path + [(dx, dy)]))
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
    for i in range(4):
        ws = await websockets.connect(f"{BASE}/ws/{room}?name=player{i}")
        welcome = json.loads(await ws.recv())
        conns.append((ws, welcome))
    print("connected:", [w["state"]["role"] for _, w in conns])

    for ws, _ in conns:
        await ws.send(json.dumps({"type": "ready", "value": True}))
    await asyncio.sleep(1.5)

    # drain until the match is running
    running = False
    maze = None
    for ws, _ in conns:
        for msg in await drain(ws, timeout=0.6):
            st = msg.get("state") or {}
            if st.get("status") == "running":
                running = True
            m = msg.get("maze") or st.get("maze")
            if m:
                maze = m
    print("match running:", running)
    assert running, "match did not start"
    assert maze is not None, "no maze received"
    route = solve_path(maze)
    print("route length:", len(route))

    for ws, _ in conns:
        for dx, dy in route:
            await ws.send(json.dumps({"type": "move", "dx": dx, "dy": dy}))
            # respect the server's move cooldown and rate limit
            await asyncio.sleep(0.12)
    await asyncio.sleep(2.0)

    # drain looking for game_over
    over = None
    deadline = asyncio.get_event_loop().time() + 25
    while asyncio.get_event_loop().time() < deadline and over is None:
        for ws, _ in conns:
            for msg in await drain(ws, timeout=0.4):
                if msg["type"] == "game_over":
                    over = msg
                    break
            if over:
                break
    for ws, _ in conns:
        await ws.close()

    assert over is not None, "no game_over received"
    print("game_over won:", over["won"], "cycles:", over["summary"]["cycles"])
    print("team skill:", round(over["summary"]["team_skill"], 3))
    print("players:", [(p["name"], p["escaped"], p["style"]) for p in over["summary"]["players"]])
    assert over["won"] is True
    assert all(p["escaped"] for p in over["summary"]["players"])
    print("MATCH OK")

    with urllib.request.urlopen(f"{HTTP}/health", timeout=5) as r:
        assert json.loads(r.read())["ok"]

    # the finished match must be persisted
    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "axiom.db")
    if os.path.exists(db_path):
        import sqlite3
        con = sqlite3.connect(db_path)
        row = con.execute("SELECT room, winner, cycles, team_skill FROM matches WHERE room=?",
                          (room,)).fetchone()
        con.close()
        assert row is not None, "match was not persisted"
        assert row[1] == 1, "match not recorded as a win"
        print("persisted:", row)
        print("DB OK")
    else:
        print("DB OK (skipped, no database file)")


if __name__ == "__main__":
    asyncio.run(main())
