"""Server tests (v3): round transitions, door movement, lockdown, cheat
rejection, prediction, asymmetric information, exit, reconnect and limits."""
import asyncio
import random
import time
from contextlib import ExitStack

from fastapi.testclient import TestClient

from app.arena import DIRECTIONS, OPPOSITE, STEP
from app import puzzles
from app.game import (
    DELAY_CONFIG, KING_APPEARANCES, KING_APPEARANCE_INTERVAL, KING_APPEARANCE_SECONDS,
    KING_FIRST_SPAWN_SECONDS, KING_ROOMS_PER_APPEARANCE, KING_WATCH_LEAD_SECONDS,
    PATHFINDER_REVEAL_COOLDOWN, Player, Room, TemporaryDoor,
)
from app.main import app, rooms
from app.nexus import CLUE_TIERS
from app.roles import ROLES, filter_round, role_for_slot


def _player(room, pid="a", slot=0, role=None):
    return Player(pid, pid.upper(), slot, "#fff", role or role_for_slot(slot),
                  room.arena.start_room().rid)


class _RecordingWS:
    def __init__(self):
        self.sent = []

    async def send_json(self, payload):
        self.sent.append(payload)


def _open_door(room, arena_room=None):
    r = arena_room or room.arena.start_room()
    return next((d for d in DIRECTIONS if room.arena.door_open(r, d)), None)


def _direction(cur, nxt):
    delta = (nxt[0] - cur[0], nxt[1] - cur[1])
    return next(d for d, s in STEP.items() if s == delta)


def _seed_room(code, **kwargs):
    room = Room(code, **kwargs)
    rooms[code] = room
    return room


def _prediction_target_rule(room):
    if not room.engines:
        return None
    index = random.Random(room.seed ^ (room.round * 7919) ^ 0x50524544).randrange(
        len(room.engines)
    )
    return room.engines[index].rule.pattern_type


def test_round_advances_and_shifts_grid():
    room = Room("T", seed=7, round_seconds=1)
    room.players["a"] = _player(room)
    payload = room.step_round()
    assert payload["type"] == "round" and payload["round"] == 1
    assert payload["arena"]["size"] == 5
    assert "clauses" not in str(payload)


def test_next_shift_countdown_varies_by_shift():
    room = Room("RAND", seed=11, round_seconds=20)
    room.players["a"] = _player(room)
    first = room.step_round()["next_round_in"]
    second = room.step_round()["next_round_in"]
    assert first != second
    assert 16 <= first <= 24
    assert 16 <= second <= 24


def test_snapshot_is_filtered_by_role():
    room = Room("T", seed=7)
    p = _player(room, role="watcher")
    snap = room.snapshot(p)
    assert snap["role"] == "watcher"
    assert "rule_count" in snap and snap["dice"] == {}
    assert snap["you"]["room_id"] == p.room_id
    assert "king" not in snap and "king_watch" in snap


def test_snapshot_hides_exit_until_a_player_discovers_it():
    room = Room("HIDE", seed=7)
    p = _player(room)
    room.players[p.id] = p
    snap = room.snapshot(p)
    assert "exit_room" not in snap["arena"]
    assert all("is_exit" not in r for r in snap["arena"]["rooms"])
    assert snap["you"]["exit_found"] is False
    assert snap["you"]["exit_code"] is None


def test_snapshot_hides_sealed_doors_from_arena_and_you():
    room = Room("SEALHIDE", seed=7)
    p = _player(room)
    p.wristband_revealed = True
    room.players[p.id] = p
    start = room.arena.start_room()
    sealed = next(d for d in DIRECTIONS if start.doors[d].sealed)
    snap = room.snapshot(p)
    pub = next(r for r in snap["arena"]["rooms"] if r["code"] == start.code)
    assert all("sealed" not in door for door in pub["doors"].values())
    assert all("sealed" not in door for door in snap["you"]["doors"].values())
    assert snap["wristband"][start.code][sealed] is True


def test_wristband_marks_doorways_blocked_by_the_other_room():
    room = Room("WBLOCK", seed=7)
    p = _player(room)
    p.wristband_revealed = True
    room.players[p.id] = p
    start = room.arena.start_room()
    door = next(d for d in DIRECTIONS if room.arena.door_open(start, d))
    neighbour = room.arena.door_target(start, door)
    neighbour.doors[OPPOSITE[door]].sealed = True

    snap = room.snapshot(p)
    pub_start = next(r for r in snap["arena"]["rooms"] if r["code"] == start.code)
    assert snap["wristband"][start.code][door] is True
    assert pub_start["open"][door] is False
    assert snap["you"]["doors"][door]["open"] is False


def test_wristband_does_not_reveal_d10_seals():
    room = Room("WBROLL", seed=7)
    p = _player(room)
    p.wristband_revealed = True
    room.players[p.id] = p
    start = room.arena.start_room()
    door = next(d for d in DIRECTIONS if room.arena.door_open(start, d))
    start.doors[door].rolled_sealed = True

    snap = room.snapshot(p)
    assert snap["wristband"][start.code][door] is False


def test_pathfinder_reveal_is_neutral_for_others_and_expires_on_shift():
    async def scenario():
        room = Room("PFScan", seed=7, round_seconds=60)
        room.status = "running"
        pathfinder = _player(room, "pf", 0, "pathfinder")
        watcher = _player(room, "wa", 1, "watcher")
        room.players = {pathfinder.id: pathfinder, watcher.id: watcher}
        hidden = next(r for r in room.arena.rooms if r.sanction and not r.revealed)
        sealed = next(d for d in DIRECTIONS if room.arena.start_room().doors[d].sealed)

        neutral = room.snapshot(pathfinder)
        assert neutral["wristband"][room.arena.start_room().code][sealed] is False
        assert neutral["wristband_sanctions"] == []
        assert neutral["you"]["wristband_revealed"] is False

        await room.reveal_wristband(watcher)
        assert watcher.wristband_revealed is False

        await room.reveal_wristband(pathfinder)
        revealed = room.snapshot(pathfinder)
        assert pathfinder.wristband_revealed is True
        assert revealed["wristband"][room.arena.start_room().code][sealed] is True
        assert hidden.code in revealed["wristband_sanctions"]
        assert revealed["you"]["wristband_revealed"] is True

        other_view = room.snapshot(watcher)
        assert other_view["wristband_sanctions"] == []
        assert other_view["wristband"][room.arena.start_room().code][sealed] is False

        room.step_round()
        assert pathfinder.wristband_revealed is False
        assert pathfinder.wristband_cooldown_until > time.time()
        expired = room.snapshot(pathfinder)
        assert expired["wristband_sanctions"] == []
        assert expired["wristband"][room.arena.start_room().code][sealed] is False

        await room.reveal_wristband(pathfinder)
        assert pathfinder.wristband_revealed is False
        pathfinder.wristband_cooldown_until = time.time() - 1
        await room.reveal_wristband(pathfinder)
        assert pathfinder.wristband_revealed is True
        assert PATHFINDER_REVEAL_COOLDOWN == 120.0

    asyncio.run(scenario())


def test_clicking_sealed_door_reports_sealed_without_leaking_state():
    room = Room("SEALCLICK", seed=7, round_seconds=60)
    room.status = "running"
    p = _player(room)
    room.players[p.id] = p

    class FakeWebSocket:
        def __init__(self):
            self.sent = []

        async def send_json(self, payload):
            self.sent.append(payload)

    p.ws = FakeWebSocket()
    start = room.arena.start_room()
    sealed = next(
        d for d in DIRECTIONS
        if start.doors[d].sealed
        and room.arena.room_at(start.bx + STEP[d][0], start.by + STEP[d][1]) is not None
    )
    before = p.points
    asyncio.run(room.open_door(p, sealed))
    result = next(m for m in reversed(p.ws.sent) if m.get("type") == "door_result")
    assert result["accepted"] is False
    assert result["message"] == "That door is sealed."
    assert p.points == before - 1
    assert p.sealed_strikes == 1


def test_clicking_edge_wall_does_not_penalize_player():
    room = Room("EDGE", seed=7, round_seconds=60)
    room.status = "running"
    p = _player(room)
    room.players[p.id] = p
    edge_room = next(
        r for r in room.arena.rooms
        if any(
            room.arena.room_at(r.bx + STEP[d][0], r.by + STEP[d][1]) is None
            for d in DIRECTIONS
        )
    )
    p.room_id = edge_room.rid
    edge = next(
        d for d in DIRECTIONS
        if room.arena.room_at(edge_room.bx + STEP[d][0], edge_room.by + STEP[d][1]) is None
    )
    edge_room.doors[edge].sealed = True
    before = p.points
    asyncio.run(room.open_door(p, edge))
    assert p.points == before
    assert p.sealed_strikes == 0


def test_two_sealed_clicks_in_same_room_and_round_trigger_lockdown():
    room = Room("SEAL2", seed=7, round_seconds=60)
    room.status = "running"
    p = _player(room)
    room.players[p.id] = p

    class FakeWebSocket:
        def __init__(self):
            self.sent = []

        async def send_json(self, payload):
            self.sent.append(payload)

    p.ws = FakeWebSocket()
    target = next(
        r for r in room.arena.rooms
        if len([
            d for d in DIRECTIONS
            if r.doors[d].sealed
            and room.arena.room_at(r.bx + STEP[d][0], r.by + STEP[d][1]) is not None
        ]) >= 2
    )
    p.room_id = target.rid
    sealed = [
        d for d in DIRECTIONS
        if target.doors[d].sealed
        and room.arena.room_at(target.bx + STEP[d][0], target.by + STEP[d][1]) is not None
    ]
    assert len(sealed) >= 2
    before = p.points

    asyncio.run(room.open_door(p, sealed[0]))
    assert p.locked is False
    assert p.sealed_strikes == 1
    assert p.points == before - 1
    result = next(m for m in reversed(p.ws.sent) if m.get("type") == "door_result")
    assert result["message"] == "That door is sealed."

    p.last_move = 0
    asyncio.run(room.open_door(p, sealed[1]))
    assert p.locked is True
    assert p.sealed_strikes == 2
    assert p.points == before - 2
    result = next(m for m in reversed(p.ws.sent) if m.get("type") == "door_result")
    assert result["accepted"] is False
    assert result["locked"] is True
    assert "Two sealed doors" in result["message"]

    room.step_round()
    p.locked = False
    p.last_move = 0
    target = next(
        r for r in room.arena.rooms
        if any(
            r.doors[d].sealed
            and room.arena.room_at(r.bx + STEP[d][0], r.by + STEP[d][1]) is not None
            for d in DIRECTIONS
        )
    )
    p.room_id = target.rid
    sealed = [
        d for d in DIRECTIONS
        if target.doors[d].sealed
        and room.arena.room_at(target.bx + STEP[d][0], target.by + STEP[d][1]) is not None
    ]
    asyncio.run(room.open_door(p, sealed[0]))
    assert p.locked is False
    assert p.sealed_strikes == 1
    result = next(m for m in reversed(p.ws.sent) if m.get("type") == "door_result")
    assert result["message"] == "That door is sealed."


def test_exit_discovery_is_player_local():
    room = Room("FOUND", seed=7)
    p1 = _player(room, "a", 0)
    p2 = _player(room, "b", 1)
    room.players = {p1.id: p1, p2.id: p2}
    exit_room = room.arena.exit_room()
    asyncio.run(room._complete_crossing(p1, room.arena.start_room(), exit_room, "N"))

    assert p1.exit_found is True
    assert p2.exit_found is False
    assert room.snapshot(p1)["you"]["exit_code"] == exit_room.code
    assert room.snapshot(p2)["you"]["exit_code"] is None


def test_exit_is_visible_through_an_open_door():
    room = Room("SIGHT", seed=7)
    p1 = _player(room, "a", 0)
    p2 = _player(room, "b", 1)
    room.players = {p1.id: p1, p2.id: p2}
    exit_room = room.arena.exit_room()
    near = room.arena.room_at(2, 0)
    p1.room_id = near.rid
    p2.room_id = near.rid
    room.open_doors[frozenset((near.rid, exit_room.rid))] = TemporaryDoor(
        a_rid=near.rid, b_rid=exit_room.rid, a_dir="E", b_dir="W",
        opened_by=p1.id, expires_at=time.time() + 10, cost=1,
    )
    asyncio.run(room._refresh_exit_visibility(p1))
    asyncio.run(room._refresh_exit_visibility(p2))

    assert p1.exit_found is True and p2.exit_found is True
    assert room.snapshot(p1)["you"]["exit_code"] == exit_room.code
    assert room.snapshot(p2)["you"]["exit_code"] == exit_room.code


def test_door_events_do_not_leak_exit_room_to_distant_players():
    room = Room("SIGHTMSG", seed=7, round_seconds=60)
    room.status = "running"
    exit_room = room.arena.exit_room()
    opener = _player(room, "a", 0)
    remote = _player(room, "b", 1)
    opener.room_id = exit_room.rid
    remote.room_id = room.arena.start_room().rid
    room.players = {opener.id: opener, remote.id: remote}

    class FakeWebSocket:
        def __init__(self):
            self.sent = []

        async def send_json(self, payload):
            self.sent.append(payload)

    opener.ws = FakeWebSocket()
    remote.ws = FakeWebSocket()
    direction = next(d for d in DIRECTIONS if room.arena.door_open(exit_room, d))

    asyncio.run(room.open_door(opener, direction))

    opened_remote = next(m for m in remote.ws.sent if m.get("type") == "door_opened")
    assert opened_remote.get("room_code") is None
    assert opened_remote.get("target_code") is None
    opened_opener = next(m for m in opener.ws.sent if m.get("type") == "door_opened")
    assert opened_opener["room_code"] == exit_room.code
    assert "target_code" in opened_opener

    for temp in room.open_doors.values():
        temp.expires_at = time.time() - 1
    asyncio.run(room.expire_open_doors())

    closed_remote = next(m for m in reversed(remote.ws.sent) if m.get("type") == "door_closed")
    assert closed_remote.get("room_code") is None
    assert closed_remote.get("target_code") is None


def test_filter_round_hides_data_per_role():
    payload = {
        "round": 1, "pattern_type": "symbol", "next_round_in": 5,
        "moved": [{"from": [0, 0], "to": [0, 1], "code_from": "A1",
                   "code_to": "A2", "sigil": "spade"}],
        "visions": {"A1": {"rid": "r0", "sigil": "spade", "doors": {
            "N": {"future": "open", "truth": "open", "color": "red"}}}},
        "dice": {"A1": {"room": "A1", "rid": "r0", "doors": {
            "N": {"color": "red"}}}},
    }
    nav = filter_round(payload, "pathfinder", None)
    watcher = filter_round(payload, "watcher", None)
    keeper = filter_round(payload, "timekeeper", None)
    decoder = filter_round(payload, "decoder", {"old": True})
    assert "sigil" not in nav["moved"][0]
    assert watcher["moved"] == [] and watcher["sigils"] == ["spade"]
    assert keeper["moved"] == [] and keeper["timing"]["next_in"] == 5
    assert "dice" not in keeper
    assert decoder["moved"] == [] and "timing" not in decoder
    assert decoder["previous"]["old"] is True and "dice" not in decoder


def test_role_assignment_covers_four_roles():
    assert {role_for_slot(i) for i in range(4)} == set(ROLES)


def test_join_assigns_unique_dynamic_roles():
    async def scenario():
        room = Room("T", seed=23)
        joined = [await room.join(None, f"P{i}") for i in range(4)]
        return room, joined

    room, joined = asyncio.run(scenario())
    assert {p.role for p in joined} == set(ROLES)
    assert set(room.role_pool) == set(ROLES)


def test_join_welcome_and_move():
    client = TestClient(app)
    _seed_room("MOVE", seed=3)
    with client.websocket_connect("/ws/MOVE?name=Hiba") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "welcome"
        assert msg["state"]["you"]["room_code"] == "C3"
        ws.send_json({"type": "ready", "value": True})
        running = None
        for _ in range(4):
            m = ws.receive_json()
            if m["type"] == "state" and m["state"]["status"] == "running":
                running = m["state"]
                break
        assert running is not None
        arena_room = rooms["MOVE"].arena.room_by_id(running["you"]["room_id"])
        door = next((d for d in DIRECTIONS
                     if arena_room and rooms["MOVE"].arena.door_open(arena_room, d)
                     and not arena_room.doors[d].rolled_sealed), None)
        assert door is not None
        ws.send_json({"type": "open_door", "door": door})
        opened = None
        for _ in range(6):
            m = ws.receive_json()
            if m["type"] == "door_opened" and m.get("accepted"):
                opened = m
                break
        assert opened is not None
        assert opened["door"] == door
        assert opened["cost"] == 1
        assert opened["open_until"] > time.time()
        rooms["MOVE"].players[msg["you"]].last_move = 0
        ws.send_json({"type": "cross_door", "door": door})
        for _ in range(6):
            m = ws.receive_json()
            if m["type"] == "room_entered" and m.get("player") == msg["you"]:
                assert m["door"] == door
                assert m.get("from") == "C3"
                assert m.get("to") is not None
                break
        else:
            raise AssertionError("no room_entered received")


def test_rejects_cheating_moves():
    client = TestClient(app)
    _seed_room("CHEA", seed=3)
    with client.websocket_connect("/ws/CHEA?name=X") as ws:
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
    room = Room("P", seed=5, round_seconds=1)
    room.status = "running"
    p = _player(room)
    room.players["a"] = p
    asyncio.run(room.predict(p, {"pattern_type": _prediction_target_rule(room)}))
    assert p.predictions == 1 and p.correct == 1


def test_prediction_does_not_reveal_best_public_rule():
    room = Room("PHID", seed=5, round_seconds=1)
    room.status = "running"
    p = _player(room)
    room.players["a"] = p
    asyncio.run(room.predict(p, {"pattern_type": "__wrong__"}))
    assert p.predictions == 1 and p.correct == 0


def test_prediction_cooldown_blocks_rapid_calls():
    room = Room("PCOOL", seed=5, round_seconds=1)
    room.status = "running"
    p = _player(room)
    room.players["a"] = p
    p.prediction_cooldown_until = time.time() + 10
    asyncio.run(room.predict(p, {"pattern_type": room.engines[0].rule.pattern_type}))
    assert p.predictions == 0


def test_team_notes_broadcast_and_replay():
    room = Room("NOTES", seed=9)
    p = _player(room)
    room.players["a"] = p
    asyncio.run(room.team_notes(p, "check A1"))
    assert room.notes[0]["text"] == "check A1"
    assert room.snapshot(p)["notes"][0]["text"] == "check A1"


def test_room_full_after_four():
    client = TestClient(app)
    _seed_room("FULL", seed=3)
    with ExitStack() as stack:
        for i in range(4):
            stack.enter_context(
                client.websocket_connect(f"/ws/FULL?name=p{i}")).receive_json()
        with client.websocket_connect("/ws/FULL?name=late") as ws:
            assert ws.receive_json()["code"] == "room_full"


def test_late_join_rejected_after_match_starts():
    client = TestClient(app)
    _seed_room("STRT", seed=3)
    with client.websocket_connect("/ws/STRT?name=first") as first:
        assert first.receive_json()["type"] == "welcome"
        rooms["STRT"].status = "running"
        with client.websocket_connect("/ws/STRT?name=late") as late:
            error = late.receive_json()
            assert error["code"] == "game_started"
            assert "already started" in error["message"].lower()


def test_existing_player_can_reconnect_after_match_starts():
    client = TestClient(app)
    _seed_room("RJON", seed=3)
    with client.websocket_connect("/ws/RJON?name=first") as first:
        pid = first.receive_json()["you"]
        rooms["RJON"].status = "running"
        with client.websocket_connect(f"/ws/RJON?name=first&pid={pid}&auth=1") as rejoined:
            rejoined.send_json({"type": "auth", "name": "first", "pid": pid})
            welcome = rejoined.receive_json()
            assert welcome["type"] == "welcome"
            assert welcome["you"] == pid


def test_hidden_rule_never_serialised():
    room = Room("SEC2", seed=3)
    p = _player(room)
    room.players["a"] = p
    blob = str(room.snapshot(p))
    assert "clauses" not in blob and "sequence" not in blob


def test_finish_builds_a_valid_summary():
    """Regression: the win path must not raise (it once crashed the match)."""
    room = Room("FIN", seed=9, round_seconds=60)
    room.status = "running"
    p = _player(room)
    p.avatar_url = "/avatars/characters/arisu.png"
    p.character_id = "arisu"
    room.players["a"] = p

    class FakeWebSocket:
        def __init__(self):
            self.sent = []

        async def send_json(self, payload):
            self.sent.append(payload)

    p.ws = FakeWebSocket()
    room.log("a", "join", {"name": "A", "role": p.role})
    asyncio.run(room.finish(won=True))
    assert room.status == "won"
    assert room.nexus.team_report()["players"]
    game_over = next(m for m in p.ws.sent if m.get("type") == "game_over")
    row = game_over["summary"]["players"][0]
    assert row["avatar_url"] == "/avatars/characters/arisu.png"
    assert row["character_id"] == "arisu"


def test_live_state_messages_hide_nexus_player_models():
    room = Room("PRIVACY", seed=9, round_seconds=60)
    p = _player(room)
    room.players[p.id] = p
    p.connected = True

    class FakeWebSocket:
        def __init__(self):
            self.sent = []

        async def send_json(self, payload):
            self.sent.append(payload)

    p.ws = FakeWebSocket()
    asyncio.run(room.broadcast_state())
    state = next(m for m in p.ws.sent if m.get("type") == "state")
    assert "nexus" in room.snapshot()
    assert "nexus" not in state["state"]


def test_opening_a_door_costs_one_point_and_crossing_is_free():
    room = Room("COST", seed=7, round_seconds=60)
    room.status = "running"
    p = _player(room)
    room.players["a"] = p
    door = _open_door(room)
    assert door
    before = p.points
    asyncio.run(room.open_door(p, door=door))
    assert p.points == before - 1
    assert p.room_id == room.arena.start_room().rid
    assert room.open_doors
    p.last_move = 0
    asyncio.run(room.cross_door(p, door=door))
    assert p.points == before - 1
    assert p.room_id != room.arena.start_room().rid


def test_sealed_door_strikes_cost_one_point_and_lock_at_two():
    room = Room("LOCKD", seed=7, round_seconds=60)
    room.status = "running"
    p = _player(room)
    room.players["a"] = p
    start = room.arena.start_room()
    door = next(
        d for d in DIRECTIONS
        if room.arena.door_open(start, d)
        and room.arena.room_at(start.bx + STEP[d][0], start.by + STEP[d][1]) is not None
    )
    start.doors[door].rolled_sealed = True
    before = p.points

    asyncio.run(room.open_door(p, door=door))
    assert p.locked is False
    assert p.room_id == start.rid
    assert p.points == before - 1
    assert p.sealed_strikes == 1
    assert not room.open_doors

    p.last_move = 0
    asyncio.run(room.open_door(p, door=door))
    assert p.locked is True
    assert p.room_id == start.rid
    assert p.points == before - 2
    assert p.sealed_strikes == 2


def test_temporary_door_is_shared_and_expires():
    room = Room("TEMP", seed=7, round_seconds=60)
    room.status = "running"
    opener = _player(room, "a", 0)
    teammate = _player(room, "b", 1)
    room.players = {"a": opener, "b": teammate}
    door = _open_door(room)
    assert door
    asyncio.run(room.open_door(opener, door=door))
    asyncio.run(room.cross_door(teammate, door=door))
    assert teammate.room_id != room.arena.start_room().rid
    for temp in room.open_doors.values():
        temp.expires_at = time.time() - 1
    asyncio.run(room.expire_open_doors())
    assert not room.open_doors
    opener.last_move = 0
    asyncio.run(room.cross_door(opener, door=door))
    assert opener.room_id == room.arena.start_room().rid


def test_solo_player_can_reach_exit_with_door_cost():
    """The 25-point economy must allow a full route to the exit."""
    room = Room("WIN2", seed=7, round_seconds=60)
    room.status = "running"
    for r in room.arena.rooms:
        r.sanction = 0
    p = _player(room)
    room.players["a"] = p
    room.log("a", "join", {"name": "A", "role": p.role})
    path = room.arena.path(room.arena.start_room(), room.arena.exit_room())
    assert path
    cur = path[0]
    for nxt in path[1:]:
        p.last_move = 0
        p.last_room_id = None
        p.entered_round = -1
        d = _direction(cur, nxt)
        asyncio.run(room.open_door(p, door=d))
        p.last_move = 0
        asyncio.run(room.cross_door(p, door=d))
        cur = nxt
        if p.escaped or p.eliminated:
            break
    assert p.escaped, f"player did not escape (points {p.points})"
    assert room.status == "won"


def test_all_players_at_exit_triggers_win():
    room = Room("WIN", seed=9, round_seconds=60)
    room.status = "running"
    p = _player(room)
    p.room_id = room.arena.exit_room().rid
    room.players["a"] = p
    room.log("a", "join", {"name": "A", "role": p.role})
    asyncio.run(room._check_endings())
    assert room.status == "won" and p.escaped


def test_disconnected_living_player_does_not_block_team_win():
    room = Room("WINDISC", seed=9, round_seconds=60)
    room.status = "running"
    players = [_player(room, "a", 0), _player(room, "b", 1)]
    players[1].connected = False
    exit_rid = room.arena.exit_room().rid
    for p in players:
        p.room_id = exit_rid
    room.players = {p.id: p for p in players}
    asyncio.run(room._check_endings())
    assert room.status == "won"
    assert all(p.escaped for p in players)


def test_team_at_exit_wins_before_match_timer_expires():
    room = Room("TIMEWIN", seed=9, match_seconds=60)
    room.status = "running"
    room.match_deadline = time.time() + 60
    p = _player(room)
    p.room_id = room.arena.exit_room().rid
    room.players["a"] = p
    asyncio.run(room._check_endings())
    assert room.status == "won" and p.escaped


def test_match_timer_expiry_eliminates_living_players():
    room = Room("TIME", seed=9, match_seconds=60)
    room.status = "running"
    room.match_deadline = time.time() - 0.01
    players = [_player(room, "a", 0), _player(room, "b", 1)]
    room.players = {p.id: p for p in players}
    asyncio.run(room._expire_match())
    assert room.status == "over"
    assert all(p.eliminated and not p.escaped for p in players)


def test_nexus_updates_skill_between_rounds():
    """Regression: NEXUS must re-read the team each round, not just at the end."""
    room = Room("NX", seed=3, round_seconds=30)
    p = _player(room)
    room.players["a"] = p
    room.log("a", "join", {"name": "A", "role": p.role})
    room.step_round()
    before = room.nexus.team_skill
    room.log("a", "predict", {"guess": {}})
    room.log("a", "predict_ok", {"score": 1.0})
    room.log("a", "share", {"text": "left side"})
    room.step_round()
    assert room.nexus.team_skill > before
    assert room.nexus.last_action is not None
    assert room.nexus.team_report()["players"]


def test_director_complexity_commits_once_per_round(monkeypatch):
    room = Room("NXA", seed=13, round_seconds=30)
    room.players["a"] = _player(room)
    initial = room.complexity_override
    monkeypatch.setattr(room.nexus, "decide", lambda *args, **kwargs: {"action": "raise_complexity"})
    room.step_round()
    assert room.complexity_override == initial + 1
    assert room.nexus.complexity_level == initial + 1
    assert room.puzzle.complexity == initial + 1

    monkeypatch.setattr(room.nexus, "decide", lambda *args, **kwargs: {"action": "lower_complexity"})
    room.step_round()
    assert room.complexity_override == initial
    assert room.nexus.complexity_level == initial
    assert room.puzzle.complexity == initial


def test_nexus_defaults_to_a_neutral_team_skill():
    room = Room("NX2", seed=3, round_seconds=30)
    p = _player(room)
    room.players["a"] = p
    room.log("a", "join", {"name": "A", "role": p.role})
    room.step_round()
    assert 0.3 < room.nexus.team_skill < 0.7


def test_rate_limiting_rejects_flood():
    room = Room("RL", seed=1)
    p = _player(room)
    import time
    now = time.monotonic()
    allowed = sum(1 for _ in range(30) if p.allow(now))
    assert allowed == 14


def test_reconnect_restores_player():
    room = Room("RC", seed=1)

    async def scenario():
        p = await room.join(None, "A")
        pid = p.id
        await room.leave(p)
        assert not p.connected
        again = await room.join(None, "A", pid)
        return pid, again

    pid, again = asyncio.run(scenario())
    assert again.id == pid and again.connected


def test_leave_broadcasts_authoritative_roster():
    room = Room("LEAVE", seed=1)
    stayer_ws = _RecordingWS()
    leaving_ws = _RecordingWS()

    async def scenario():
        stayer = await room.join(stayer_ws, "Stayer")
        leaving = await room.join(leaving_ws, "Leaving")
        stayer_ws.sent.clear()
        await room.leave(leaving)
        return stayer, leaving

    stayer, leaving = asyncio.run(scenario())
    messages = [m for m in stayer_ws.sent if m.get("type") == "player_left"]
    assert messages and messages[-1]["player"] == leaving.id
    assert messages[-1]["players"]
    assert all(p["id"] != leaving.id for p in messages[-1]["players"])
    assert all(p["id"] != leaving.id for m in stayer_ws.sent
               if m.get("type") == "state" for p in m["state"]["players"])


def test_purge_disconnected_broadcasts_removal():
    room = Room("PURGE", seed=1)
    stayer_ws = _RecordingWS()
    gone_ws = _RecordingWS()

    async def scenario():
        stayer = await room.join(stayer_ws, "Stayer")
        gone = await room.join(gone_ws, "Gone")
        gone.connected = False
        gone.disconnected_at = time.time() - 121
        stayer_ws.sent.clear()
        await room.purge_disconnected()
        return stayer, gone

    stayer, gone = asyncio.run(scenario())
    assert gone.id not in room.players
    assert any(m.get("type") == "player_left" and m.get("player") == gone.id
               for m in stayer_ws.sent)


def test_welcome_replays_final_game_over():
    room = Room("FINAL", seed=1)

    async def scenario():
        player = await room.join(_RecordingWS(), "A")
        await room.leave(player)
        room.final_payload = {
            "type": "game_over", "won": True, "reason": "done", "summary": {}, "nexus": {},
        }
        replay_ws = _RecordingWS()
        again = await room.join(replay_ws, "A", player.id, instance_id="inst-1")
        return again, replay_ws.sent

    again, sent = asyncio.run(scenario())
    welcome = next(m for m in sent if m.get("type") == "welcome")
    assert again is not None
    assert welcome["instance_id"] == "inst-1"
    assert welcome["game_over"]["won"] is True


def test_locked_player_needs_two_helpers():
    room = Room("LOCK", seed=4, round_seconds=60)
    room.status = "running"
    target = _player(room, "t", 0, "pathfinder")
    target.locked = True
    helper = _player(room, "h", 1, "watcher")
    room.players = {"t": target, "h": helper}
    asyncio.run(room.unlock(helper, "t"))
    assert target.locked, "one helper must not free a locked player"
    second = _player(room, "h2", 2, "timekeeper")
    room.players["h2"] = second
    asyncio.run(room.unlock(second, "t"))
    assert not target.locked and target.revives == 1


def test_locked_players_cannot_help_unlock_each_other():
    room = Room("LOCKHELP", seed=4, round_seconds=60)
    room.status = "running"
    target = _player(room, "t", 0, "pathfinder")
    target.locked = True
    locked_helper = _player(room, "lh", 1, "watcher")
    locked_helper.locked = True
    free_helper = _player(room, "fh", 2, "timekeeper")
    room.players = {"t": target, "lh": locked_helper, "fh": free_helper}
    asyncio.run(room.unlock(locked_helper, "t"))
    assert target.locked
    asyncio.run(room.unlock(free_helper, "t"))
    assert target.locked


def test_sanction_counts_recompute_and_stay_counts_only():
    room = Room("SCOUNT", seed=3, round_seconds=60)
    room.status = "running"
    p = _player(room)
    room.players[p.id] = p
    before_total = room.sanction_total
    before_found = room.sanction_found

    snap = room.snapshot(p)
    assert snap["sanction_total"] == before_total
    assert snap["sanction_found"] == before_found
    hidden = next(r for r in room.arena.rooms if r.sanction and not r.revealed)
    pub_hidden = next(r for r in snap["arena"]["rooms"] if r["id"] == hidden.rid)
    assert pub_hidden["sanction"] is None and pub_hidden["revealed"] is False

    room._apply_director({"action": "add_hazard"})
    assert room.sanction_total == before_total + 1
    assert room.snapshot(p)["sanction_total"] == before_total + 1

    target = next(r for r in room.arena.rooms if r.sanction and not r.revealed)
    asyncio.run(room._complete_crossing(p, room.arena.start_room(), target, "N"))
    after = room.snapshot(p)
    assert after["sanction_found"] == before_found + 1


def test_dealer_clue_is_private_to_near_player():
    room = Room("CLUE", seed=7, round_seconds=60)
    room.status = "running"
    room.engines = []
    hidden = [r for r in room.arena.rooms if r.sanction and not r.revealed]
    near = room.arena.neighbours(hidden[0])[0][1]

    def min_hidden_distance(candidate):
        distances = [d for target in hidden
                     if (d := room.arena.door_distance(candidate, target)) is not None]
        return min(distances) if distances else 99

    far = max((r for r in room.arena.rooms if r.rid != near.rid), key=min_hidden_distance)
    near_player = _player(room, "near", 0)
    far_player = _player(room, "far", 1)
    near_player.room_id = near.rid
    far_player.room_id = far.rid
    room.players = {near_player.id: near_player, far_player.id: far_player}

    class FakeWebSocket:
        def __init__(self):
            self.sent = []

        async def send_json(self, payload):
            self.sent.append(payload)

    near_player.ws = FakeWebSocket()
    far_player.ws = FakeWebSocket()
    room.nexus.decide = lambda *args, **kwargs: {"action": "give_clue"}
    room.nexus.clue_chance = lambda skill=None: 1.0

    asyncio.run(room.broadcast_round())

    near_clues = [m for m in near_player.ws.sent if m.get("type") == "dealer_clue"]
    far_clues = [m for m in far_player.ws.sent if m.get("type") == "dealer_clue"]
    assert len(near_clues) == 1
    assert far_clues == []
    assert set(near_clues[0]) == {"type", "tier", "text"}
    assert near_clues[0]["tier"] in (1, 2)
    assert near_clues[0]["text"] in CLUE_TIERS[near_clues[0]["tier"]]

    snap = room.snapshot(far_player)
    pub_hidden = next(r for r in snap["arena"]["rooms"] if r["id"] == hidden[0].rid)
    assert pub_hidden["sanction"] is None and pub_hidden["revealed"] is False


class _DelayWebSocket:
    def __init__(self):
        self.sent = []

    async def send_json(self, payload):
        self.sent.append(payload)


def _delay_room(seed=37):
    room = Room("DLY", seed=seed, round_seconds=60)
    room.status = "running"
    players = [
        _player(room, "keeper", 0, "timekeeper"),
        _player(room, "decoder", 1, "decoder"),
        _player(room, "path", 2, "pathfinder"),
    ]
    for player in players:
        player.ws = _DelayWebSocket()
        room.players[player.id] = player
    room.next_round_at = time.time() + 30
    return room, players[0], players[1], players[2]


def _message(player, kind):
    return next(m for m in reversed(player.ws.sent) if m.get("type") == kind)


def test_delay_puzzles_are_deterministic_and_solvable():
    for tier in (1, 2, 3):
        first = puzzles.generate(2026, 3, tier)
        assert first == puzzles.generate(2026, 3, tier)
        assert puzzles.verify(first)
        assert len(first["question"].split()) <= 12
        assert puzzles.check_answer(first, first["answer"])
        wrong = (next(s for s in puzzles.SUITS if s != first["answer"])
                 if tier == 3 else {"row": 9, "col": 9})
        assert not puzzles.check_answer(first, wrong)
    for tier in (1, 2, 3):
        for seed in range(50):
            assert puzzles.verify(puzzles.generate(seed, seed, tier))


def test_delay_puzzle_is_private_and_success_changes_only_keeper_delta():
    room, keeper, decoder, pathfinder = _delay_room()
    before = room.next_round_at
    asyncio.run(room.queue_delay(keeper, 1))
    puzzle = _message(decoder, "puzzle")
    key = _message(keeper, "puzzle_key")
    answer = room.delay_puzzle["answer"]

    assert puzzle["question"] and "key_text" not in puzzle
    assert key["key_text"] and "question" not in key and "grids" not in key
    assert not [m for m in keeper.ws.sent if m.get("type") == "puzzle"]
    assert not [m for m in decoder.ws.sent if m.get("type") == "puzzle_key"]
    assert not [m for m in pathfinder.ws.sent if m.get("type") in ("puzzle", "puzzle_key")]
    assert room.delay_attempts[room.stage] == 1

    asyncio.run(room.answer_delay(decoder, puzzle["puzzle_id"], answer))
    assert room.next_round_at > before
    assert room.delay_puzzle is None
    assert room.delay_cooldown_until > time.time()
    assert room.shift_delay_applied == DELAY_CONFIG["delay_s"][1]
    assert room.shift_successes == 1
    for player, has_delta in ((keeper, True), (decoder, False), (pathfinder, False)):
        result = _message(player, "delay_result")
        assert result["ok"] is True
        assert ("delta_s" in result) is has_delta
        assert "next_round_in" not in result


def test_delay_failure_keeps_the_pending_shift_floor():
    room, keeper, decoder, pathfinder = _delay_room()
    room.next_round_at = time.time() + 4
    asyncio.run(room.queue_delay(keeper, 2))
    puzzle_id = room.delay_puzzle["puzzle_id"]

    asyncio.run(room.answer_delay(decoder, puzzle_id, {"row": 9, "col": 9}))
    assert room.next_round_at - time.time() >= DELAY_CONFIG["min_time_before_shift_s"] - 0.1
    assert room.shift_delay_applied == 0
    assert room.shift_successes == 0
    assert _message(decoder, "delay_result")["ok"] is False
    assert "delta_s" not in _message(decoder, "delay_result")
    assert "delta_s" in _message(keeper, "delay_result")
    assert "delta_s" not in _message(pathfinder, "delay_result")


def test_delay_queue_rejects_wrong_role_bad_tier_dead_pair_and_double_answer():
    room, keeper, decoder, pathfinder = _delay_room()
    asyncio.run(room.queue_delay(decoder, 1))
    assert _message(decoder, "error")["code"] == "role_unavailable"

    decoder.connected = False
    asyncio.run(room.queue_delay(keeper, 1))
    assert _message(keeper, "error")["code"] == "delay_pair_unavailable"
    decoder.connected = True

    asyncio.run(room.queue_delay(pathfinder, 1))
    assert _message(pathfinder, "error")["code"] == "role_unavailable"
    asyncio.run(room.queue_delay(keeper, 9))
    assert _message(keeper, "error")["code"] == "bad_tier"

    asyncio.run(room.queue_delay(keeper, 3))
    puzzle_id = room.delay_puzzle["puzzle_id"]
    answer = room.delay_puzzle["answer"]
    asyncio.run(room.answer_delay(keeper, puzzle_id, answer))
    assert _message(keeper, "error")["code"] == "role_unavailable"
    asyncio.run(room.answer_delay(decoder, "stale", answer))
    assert _message(decoder, "error")["code"] == "stale_puzzle"

    asyncio.run(room.answer_delay(decoder, puzzle_id, answer))
    assert room.delay_puzzle is None
    asyncio.run(room.answer_delay(decoder, puzzle_id, answer))
    assert _message(decoder, "error")["code"] == "stale_puzzle"


def test_shift_cancels_delay_without_penalty_attempt_or_cooldown():
    room, keeper, decoder, pathfinder = _delay_room()
    asyncio.run(room.queue_delay(keeper, 3))
    assert room.delay_attempts[room.stage] == 1
    room.next_round_at = time.time() - 1

    room.step_round()
    assert room.delay_puzzle is None
    assert room.delay_deadline is None
    assert room.delay_cooldown_until == 0.0
    assert room._delay_attempts_left() == DELAY_CONFIG["attempts_per_stage"]
    assert any(e["kind"] == "delay_cancelled" for e in room.events)
    assert not [m for m in keeper.ws.sent if m.get("type") == "delay_result"]
    assert not [m for m in decoder.ws.sent if m.get("type") == "delay_result"]


def test_decoder_cannot_move_through_doors_while_delay_puzzle_is_open():
    room, keeper, decoder, pathfinder = _delay_room()
    asyncio.run(room.queue_delay(keeper, 1))
    door = _open_door(room)

    asyncio.run(room.open_door(decoder, door=door))
    assert _message(decoder, "error")["code"] == "decoder_busy"
    asyncio.run(room.cross_door(decoder, door=door))
    assert _message(decoder, "error")["code"] == "decoder_busy"


def test_delay_successes_stack_at_half_rate_and_cap_total():
    room, keeper, decoder, pathfinder = _delay_room()
    room.next_round_at = time.time() + 20

    def solve(tier):
        room.delay_cooldown_until = 0.0
        room.delay_attempts[room.stage] = 0
        asyncio.run(room.queue_delay(keeper, tier))
        puzzle_id = room.delay_puzzle["puzzle_id"]
        answer = room.delay_puzzle["answer"]
        asyncio.run(room.answer_delay(decoder, puzzle_id, answer))
        return _message(keeper, "delay_result")["delta_s"]

    assert round(solve(1)) == DELAY_CONFIG["delay_s"][1]
    assert round(solve(2)) == DELAY_CONFIG["delay_s"][2] * DELAY_CONFIG["second_success_multiplier"]
    assert room.shift_delay_applied == 12
    room.shift_delay_applied = DELAY_CONFIG["max_shift_delay_s"] - 1
    assert round(solve(1)) == 1
    assert room.shift_delay_applied == DELAY_CONFIG["max_shift_delay_s"]
    assert round(solve(1)) == 0


def test_match_defaults_to_five_king_appearances_and_no_round_cap():
    room = Room("KINGCFG", seed=3)
    assert room.match_seconds == 1800.0
    assert room.max_rounds == 0
    p = _player(room)
    p.ready = True
    room.players[p.id] = p

    asyncio.run(room.maybe_start())

    assert len(room.king_spawn_at) == KING_APPEARANCES
    assert len(room.king_plans) == KING_APPEARANCES
    assert [
        round(at - room.started_at, 3) for at in room.king_spawn_at
    ] == [
        KING_FIRST_SPAWN_SECONDS + i * KING_APPEARANCE_INTERVAL
        for i in range(KING_APPEARANCES)
    ]


def test_king_plan_never_uses_exit_room():
    room = Room("KINGEXIT", seed=3)
    exit_rid = room.arena.exit_room().rid
    room._prepare_king_plan(room.started_at)
    planned = [rid for plan in room.king_plans for rid in plan["room_ids"]]
    assert planned
    assert exit_rid not in planned


def test_king_runs_five_scheduled_three_minute_appearances():
    room = Room("KINGSEQ", seed=4)
    room.status = "running"
    room.started_at = time.time()
    room.match_deadline = room.started_at + 1800
    room._prepare_king_plan(room.started_at)

    async def scenario():
        for appearance in range(1, KING_APPEARANCES + 1):
            await room._update_king(room.king_spawn_at[appearance - 1])
            assert room.king is not None
            assert room.king["appearance"] == appearance
            assert round(room.king["ends_at"] - room.king_spawn_at[appearance - 1], 3) == 180
            assert len(room.king["room_ids"]) == KING_ROOMS_PER_APPEARANCE
            await room._update_king(room.king["ends_at"])
            assert room.king is None
        await room._update_king(room.match_deadline + 1)
        assert room.king_appearance == KING_APPEARANCES

    asyncio.run(scenario())


def test_king_window_uses_scheduled_spawn_time():
    room = Room("KINGDRIFT", seed=5)
    room.status = "running"
    room.started_at = time.time()
    room._prepare_king_plan(room.started_at)
    scheduled = room.king_spawn_at[0]

    asyncio.run(room._update_king(scheduled + 0.4))

    assert room.king is not None
    assert room.king["started_at"] == scheduled
    assert room.king["ends_at"] == scheduled + KING_APPEARANCE_SECONDS
    assert room.king["next_teleport_at"] == scheduled + KING_APPEARANCE_SECONDS / KING_ROOMS_PER_APPEARANCE


def test_king_teleports_through_five_rooms_and_kills_occupants():
    room = Room("KINGKILL", seed=17)
    p1 = _player(room, "a", 0)
    p2 = _player(room, "b", 1)
    p3 = _player(room, "c", 2)
    for player in (p1, p2, p3):
        player.ready = True
        room.players[player.id] = player

    async def scenario():
        await room.maybe_start()
        safe = next(r.rid for r in room.arena.rooms if r.rid != p1.room_id)
        for player in (p1, p2, p3):
            player.room_id = safe

        await room._update_king(room.king_spawn_at[0])
        assert room.king is not None
        assert len(set(room.king["room_ids"])) == KING_ROOMS_PER_APPEARANCE
        assert not any(p.eliminated for p in (p1, p2, p3))

        p1.room_id = room.king["room_id"]
        await room._king_strike()
        assert p1.eliminated
        assert not p2.eliminated
        assert not p3.eliminated

        await room._update_king(room.king["next_teleport_at"])
        assert room.king is not None
        assert room.king["teleport_index"] == 1
        p2.room_id = room.king["room_id"]
        await room._king_strike()
        assert p2.eliminated
        assert not p3.eliminated

    asyncio.run(scenario())


def test_watcher_gets_full_king_schedule_and_no_live_king_events():
    room = Room("KINGWATCH", seed=19)

    class FakeWebSocket:
        def __init__(self):
            self.sent = []

        async def send_json(self, payload):
            self.sent.append(payload)

    watcher = _player(room, "w", 1, "watcher")
    guard = _player(room, "g", 0, "pathfinder")
    watcher.ws = FakeWebSocket()
    guard.ws = FakeWebSocket()
    for player in (watcher, guard):
        player.ready = True
        room.players[player.id] = player

    async def scenario():
        await room.maybe_start()
        first_spawn = room.king_spawn_at[0]
        await room._update_king(first_spawn - KING_WATCH_LEAD_SECONDS)

        alerts = [m for m in watcher.ws.sent if m.get("type") == "king_watch"]
        lead_alerts = [m for m in alerts if abs(m["in_seconds"] - KING_WATCH_LEAD_SECONDS) < 0.001]
        assert len(lead_alerts) == 1
        alert = lead_alerts[0]
        first_room = room.arena.room_by_id(room.king_plans[0]["room_ids"][0])
        assert alert["appearance"] == 1
        assert alert["total"] == KING_APPEARANCES
        assert alert["room_code"] == first_room.code
        assert alert["room"] == [first_room.bx, first_room.by]
        assert len(alert["appearances"]) == KING_APPEARANCES
        assert all(len(item["rooms"]) == 5 for item in alert["appearances"])
        assert not [m for m in guard.ws.sent if m.get("type") == "king_watch"]

        await room._update_king(first_spawn - KING_WATCH_LEAD_SECONDS)
        assert len([m for m in watcher.ws.sent if m.get("type") == "king_watch"]) == 2

        await room._update_king(first_spawn)
        assert not [m for m in watcher.ws.sent if m.get("type") == "king_spawn"]
        assert [m for m in guard.ws.sent if m.get("type") == "king_spawn"]

        await room._update_king(room.king["next_teleport_at"])
        assert not [m for m in watcher.ws.sent if m.get("type") == "king_teleport"]
        assert [m for m in guard.ws.sent if m.get("type") == "king_teleport"]

        for index in range(1, KING_APPEARANCES):
            spawn_at = room.king_spawn_at[index]
            await room._update_king(spawn_at - KING_WATCH_LEAD_SECONDS)
            appearance_alerts = [
                m for m in watcher.ws.sent
                if m.get("type") == "king_watch"
                and m.get("appearance") == index + 1
                and abs(m["in_seconds"] - KING_WATCH_LEAD_SECONDS) < 0.001
            ]
            assert len(appearance_alerts) == 1
            alert = appearance_alerts[0]
            expected = room.arena.room_by_id(room.king_plans[index]["room_ids"][0])
            assert alert["room_code"] == expected.code
            assert alert["room"] == [expected.bx, expected.by]
            assert len(alert["appearances"]) == KING_APPEARANCES
            assert all(len(item["rooms"]) == 5 for item in alert["appearances"])
            assert "room_ids" not in alert

            await room._update_king(spawn_at)
            assert not [m for m in watcher.ws.sent if m.get("type") == "king_spawn"]
            assert len([m for m in guard.ws.sent if m.get("type") == "king_spawn"]) == index + 1

        snap = room.snapshot(watcher)
        assert "king" not in snap
        assert snap["king_watch"] is not None
        assert len(snap["king_watch"]["appearances"]) == KING_APPEARANCES

    asyncio.run(scenario())


def test_pose_events_bypass_gameplay_rate_limit():
    room = Room("POSE", seed=5)
    room.status = "running"
    mover = _player(room, "mover", 0)
    other = _player(room, "other", 1)
    mover.ws = _RecordingWS()
    other.ws = _RecordingWS()
    mover.last_move = time.monotonic()
    room.players[mover.id] = mover
    room.players[other.id] = other

    async def scenario():
        await room.handle(mover, {
            "type": "pose", "x": 1.25, "z": -0.5, "yaw": 0.75, "moving": True,
        })

    asyncio.run(scenario())
    moves = [m for m in other.ws.sent if m.get("type") == "player_move"]
    assert len(moves) == 1
    assert moves[0]["player"] == mover.id
    assert moves[0]["x"] == 1.25
    assert moves[0]["z"] == -0.5
    assert moves[0]["moving"] is True
    assert not [m for m in mover.ws.sent if m.get("code") == "rate_limited"]


def test_non_locked_player_can_escort_locked_teammate():
    room = Room("ESCORT", seed=7)
    room.status = "running"
    leader = _player(room, "lead", 0)
    locked = _player(room, "lock", 1)
    locked.locked = True
    room.players[leader.id] = leader
    room.players[locked.id] = locked
    current = room.arena.start_room()
    door = _open_door(room, current)
    target = room.arena.door_target(current, door)
    room.open_doors[frozenset((current.rid, target.rid))] = TemporaryDoor(
        a_rid=current.rid, b_rid=target.rid, a_dir=door,
        b_dir=OPPOSITE[door], opened_by=leader.id,
        expires_at=time.time() + 10, cost=1,
    )

    asyncio.run(room._complete_crossing(leader, current, target, door))
    assert leader.room_id == target.rid
    assert locked.room_id == target.rid
    assert locked.locked is False
    assert locked.revives == 1


def test_shifts_never_move_exit_or_locked_room():
    for seed in range(6):
        room = Room(f"PROT{seed}", seed=seed, round_seconds=20)
        locked = _player(room, "lock", 0)
        locked.locked = True
        room.players[locked.id] = locked
        locked_rid = locked.room_id
        exit_rid = room.arena.exit_room().rid
        locked_room = room.arena.room_by_id(locked_rid)
        exit_room = room.arena.room_by_id(exit_rid)
        locked_before = (locked_room.bx, locked_room.by)
        exit_before = (exit_room.bx, exit_room.by)
        room.step_round()
        locked_after = room.arena.room_by_id(locked_rid)
        exit_after = room.arena.room_by_id(exit_rid)
        assert (locked_after.bx, locked_after.by) == locked_before
        assert (exit_after.bx, exit_after.by) == exit_before


def test_game_over_reason_is_personalized():
    room = Room("REASON", seed=7)
    first = _player(room, "first", 0)
    second = _player(room, "second", 1)
    first.ws = _RecordingWS()
    second.ws = _RecordingWS()
    first.death_reason = "The KING found you."
    room.end_reason = "The team failed to reach the exit."
    room.players[first.id] = first
    room.players[second.id] = second

    asyncio.run(room.finish(False))
    first_over = [m for m in first.ws.sent if m.get("type") == "game_over"]
    second_over = [m for m in second.ws.sent if m.get("type") == "game_over"]
    assert first_over[0]["reason"] == "The KING found you."
    assert second_over[0]["reason"] == "The team failed to reach the exit."


def test_leave_broadcasts_player_left_and_exit_wall_is_exposed():
    room = Room("LEAVE", seed=7)
    leaving = _player(room, "leaving", 0)
    staying = _player(room, "staying", 1)
    leaving.ws = _RecordingWS()
    staying.ws = _RecordingWS()
    room.players[leaving.id] = leaving
    room.players[staying.id] = staying
    asyncio.run(room.leave(leaving))
    left_events = [m for m in staying.ws.sent if m.get("type") == "player_left"]
    assert len(left_events) == 1
    assert left_events[0]["player"] == leaving.id

    finder = _player(room, "finder", 2)
    finder.exit_found = True
    snap = room.snapshot(finder)
    exit_room = room.arena.exit_room()
    assert snap["you"]["exit_code"] == exit_room.code
    assert snap["you"]["exit_wall"]
    assert all(
        (d == "W" and exit_room.bx == 0)
        or (d == "E" and exit_room.bx == room.arena.size - 1)
        or (d == "N" and exit_room.by == 0)
        or (d == "S" and exit_room.by == room.arena.size - 1)
        for d in snap["you"]["exit_wall"]
    )
