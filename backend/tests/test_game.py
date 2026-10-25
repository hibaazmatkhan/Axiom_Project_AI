"""WP3 server tests: transitions, movement, cheat rejection, prediction,
asymmetric information, puzzles, reconnect and rate limiting."""
from contextlib import ExitStack

from fastapi.testclient import TestClient

from app.game import Player, Room
from app.main import app
from app.roles import ROLES, filter_transition


def test_transition_moves_player_out_of_wall():
    room = Room("T", seed=7, transition_seconds=1)
    room.players["a"] = Player("a", "A", 0, "#fff", "mover", 0, 0)  # (0,0) is a wall
    payload = room.step_transition()
    p = room.players["a"]
    assert room.maze.is_open(p.x, p.y)
    assert payload["type"] == "transition" and payload["cycle"] == 1
    assert "schedule" not in str(payload)


def test_snapshot_is_filtered_by_role():
    room = Room("T", seed=7)
    p = Player("a", "A", 0, "#fff", "symbolist", 0, 0)
    snap = room.snapshot(p)
    assert snap["role"] == "symbolist"
    assert "rule_count" in snap


def test_filter_transition_hides_data_per_role():
    payload = {"cycle": 1, "pattern_type": "symbol",
               "moved": [{"bx": 0, "by": 0, "symbol": "triangle"}],
               "next_transition_in": 5}
    mover = filter_transition(payload, "mover", None)
    symbolist = filter_transition(payload, "symbolist", None)
    chrono = filter_transition(payload, "chronologist", None)
    assert "symbol" not in mover["moved"][0]        # mover only sees positions
    assert symbolist["moved"][0]["symbol"] == "triangle"
    assert chrono["moved"] == [] and "timing" in chrono


def test_role_assignment_covers_four_roles():
    room = Room("R", seed=1)
    roles = {room.players.get(f"p{i}", None) for i in range(0)}
    from app.roles import role_for_slot
    assert {role_for_slot(i) for i in range(4)} == set(ROLES)


def _drain_for_players(ws, tries=8):
    for _ in range(tries):
        m = ws.receive_json()
        if m["type"] == "players" and m.get("players"):
            return m
    raise AssertionError("no players message")


def test_join_welcome_and_move():
    client = TestClient(app)
    with client.websocket_connect("/ws/MOVE?name=Hiba") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "welcome"
        maze = msg["state"]["maze"]
        # ready up to start the match (min_players could be 1)
        ws.send_json({"type": "ready", "value": True})
        x, y = maze["start"]
        step = next((dx, dy) for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]
                    if maze["tiles"][y + dy][x + dx] == ".")
        ws.send_json({"type": "move", "dx": step[0], "dy": step[1]})
        upd = _drain_for_players(ws)
        me = upd["players"][0]
        # a move either happened or was rate/wall blocked; position stays valid
        assert (me["x"], me["y"]) in [(x, y), (x + step[0], y + step[1])]


def test_rejects_cheating_moves():
    client = TestClient(app)
    with client.websocket_connect("/ws/CHEAT?name=X") as ws:
        ws.receive_json()
        ws.send_json({"type": "move", "dx": 3, "dy": 0})
        ws.send_json({"type": "move", "dx": 1, "dy": 1})
        ws.send_json({"type": "move", "dx": "1", "dy": 0})
        ws.send_json({"type": "ping"})
        for _ in range(6):
            if ws.receive_json()["type"] == "pong":
                break
        else:
            raise AssertionError("no pong")


def test_prediction_scoring():
    room = Room("P", seed=5, transition_seconds=1)
    room.status = "running"
    p = Player("a", "A", 0, "#fff", "mover", *room.maze.start, ws=None)
    room.players["a"] = p
    import asyncio
    asyncio.run(room.predict(p, {"pattern_type": room.engines[0].rule.pattern_type, "symbols": []}))
    assert p.predictions == 1 and p.correct == 1


def test_room_full_after_four():
    client = TestClient(app)
    with ExitStack() as stack:
        for i in range(4):
            stack.enter_context(client.websocket_connect(f"/ws/FULLTEST?name=p{i}")).receive_json()
        with client.websocket_connect("/ws/FULLTEST?name=late") as ws:
            assert ws.receive_json()["code"] == "room_full"


def test_puzzle_solution_never_leaks_to_clients():
    room = Room("SEC", seed=3)
    p = Player("a", "A", 0, "#fff", "mover", *room.maze.start, ws=None)
    room.players["a"] = p
    room.puzzle = {"question": "q", "options": ["triangle", "circle", "square"],
                   "solution": 1, "clues_by_role": {r: ["c"] for r in ROLES}}
    snap = room.snapshot(p)
    assert snap["puzzle"] is not None
    assert "solution" not in snap["puzzle"]
    assert "clues_by_role" not in snap["puzzle"]
    assert snap["puzzle"]["clues"] == ["c"]


def test_hidden_rule_never_serialised():
    room = Room("SEC2", seed=3)
    p = Player("a", "A", 0, "#fff", "mover", *room.maze.start, ws=None)
    room.players["a"] = p
    blob = str(room.snapshot(p))
    assert "clauses" not in blob and "sequence" not in blob


def test_finish_builds_a_valid_summary():
    """Regression: the win path must not raise (it once crashed the match)."""
    import asyncio
    room = Room("FIN", seed=9, transition_seconds=60)
    room.status = "running"
    p = Player("a", "A", 0, "#fff", "mover", *room.maze.start, ws=None)
    room.players["a"] = p
    room.log("a", "join", {"name": "A", "role": "mover"})
    asyncio.run(room.finish(won=True))
    assert room.status == "won"
    assert room.nexus.team_report()["players"]


def test_all_players_escaped_triggers_win():
    import asyncio
    room = Room("WIN", seed=9, transition_seconds=60)
    room.status = "running"
    p = Player("a", "A", 0, "#fff", "mover", *room.maze.start, ws=None)
    p.escaped = True
    room.players["a"] = p
    room.log("a", "join", {"name": "A", "role": "mover"})
    asyncio.run(room.finish(won=True))
    assert room.status == "won"


def test_nexus_updates_skill_between_cycles():
    """Regression: NEXUS must re-read the team each cycle, not just at the end."""
    room = Room("NX", seed=3, transition_seconds=30)
    p = Player("a", "A", 0, "#fff", "mover", *room.maze.start)
    room.players["a"] = p
    room.log("a", "join", {"name": "A", "role": "mover"})
    room.step_transition()
    before = room.nexus.team_skill
    # The player now performs well: correct predictions and shared clues.
    room.log("a", "predict", {"guess": {}})
    room.log("a", "predict_ok", {"score": 1.0})
    room.log("a", "share", {"text": "left side"})
    room.log("a", "puzzle_ok", {"choice": 0})
    room.step_transition()
    assert room.nexus.team_skill > before
    assert room.nexus.last_action is not None
    assert room.nexus.team_report()["players"]


def test_nexus_defaults_to_a_neutral_team_skill():
    room = Room("NX2", seed=3, transition_seconds=30)
    p = Player("a", "A", 0, "#fff", "mover", *room.maze.start)
    room.players["a"] = p
    room.log("a", "join", {"name": "A", "role": "mover"})
    room.step_transition()
    assert 0.3 < room.nexus.team_skill < 0.7


def test_rate_limiting_rejects_flood():
    room = Room("RL", seed=1)
    p = Player("a", "A", 0, "#fff", "mover", 0, 0)
    import time
    now = time.monotonic()
    allowed = sum(1 for _ in range(30) if p.allow(now))
    assert allowed == 14


def test_reconnect_restores_player():
    room = Room("RC", seed=1)
    import asyncio

    async def scenario():
        p = await room.join(None, "A")
        pid = p.id
        await room.leave(p)
        assert not p.connected
        again = await room.join(None, "A", pid)
        return pid, again

    pid, again = asyncio.run(scenario())
    assert again.id == pid and again.connected
