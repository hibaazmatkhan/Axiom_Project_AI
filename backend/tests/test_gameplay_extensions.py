"""Gameplay integration tests for puzzle, actuators and room auditing."""
import asyncio
import random

from app.arena import DIRECTIONS, Arena
from app.fate import roll_round
from app.game import Player, Room
from app.nexus import DICE_RELIEF_ROUNDS
from app.roles import ROLES


class FakeWebSocket:
    def __init__(self):
        self.sent = []

    async def send_json(self, payload):
        self.sent.append(payload)


def _player(room, pid="a", slot=0, role=None):
    return Player(pid, pid.upper(), slot, "#fff", role or ROLES[slot],
                  room.arena.start_room().rid, ws=FakeWebSocket())


def test_room_puzzle_is_cooperative_and_role_filtered():
    room = Room("PUZ", seed=13)
    p = _player(room, "a", 0, "navigator")
    room.players[p.id] = p
    snap = room.snapshot(p)
    assert set(room.puzzle.domains) == set(ROLES)
    assert snap["puzzle"]["you"]["role"] == "navigator"
    assert set(snap["puzzle"]["you"]["domain"]) == set(room.puzzle.domains["navigator"])
    assert "solution" not in snap["puzzle"]
    assert room.snapshot()["puzzle"]["you"] is None


def test_puzzle_submission_is_validated_rewarded_once_and_logged():
    room = Room("PUZ2", seed=17, round_seconds=60)
    room.status = "running"
    players = {role: _player(room, f"p{index}", index, role)
               for index, role in enumerate(ROLES)}
    room.players = {p.id: p for p in players.values()}
    wrong = {role: next(v for v in values if v != room.puzzle.solution[role])
             for role, values in room.puzzle.domains.items()}
    before = {pid: p.points for pid, p in room.players.items()}
    for role, p in players.items():
        asyncio.run(room.submit_puzzle(p, {role: wrong[role]}))
    assert all(p.points == before[p.id] for p in players.values())
    assert sum(e["kind"] == "puzzle_attempt" for e in room.events) == len(ROLES)
    result = next(m for m in reversed(players["navigator"].ws.sent)
                  if m.get("type") == "puzzle_result")
    assert result["correct"] is False and "solution" not in result

    for role, p in players.items():
        asyncio.run(room.submit_puzzle(p, {role: room.puzzle.solution[role]}))
    assert all(p.points == before[p.id] + 1 for p in players.values())
    assert any(e["kind"] == "puzzle_solved" for e in room.events)
    asyncio.run(room.submit_puzzle(players["navigator"],
                                  {"navigator": room.puzzle.solution["navigator"]}))
    assert all(p.points == before[p.id] + 1 for p in players.values())
    report = room.nexus.team_report()["puzzle"]
    assert report["attempts"] == 2 * len(ROLES) + 1 and report["solved"] == 1


def test_lower_dice_reduces_seals_and_is_time_bounded():
    arena_a = Arena.generate(5, seed=23)
    arena_b = arena_a.clone()
    plain = roll_round(arena_a, random.Random(99))
    eased = roll_round(arena_b, random.Random(99), relief=1)
    sealed_plain = sum(1 for room in arena_a.rooms if any(room.doors[d].rolled_sealed for d in DIRECTIONS))
    sealed_eased = sum(1 for room in arena_b.rooms if any(room.doors[d].rolled_sealed for d in DIRECTIONS))
    assert sealed_eased < sealed_plain
    assert all(set(door) == {"color"} for room in eased.values() for door in room["doors"].values())

    room = Room("DICE", seed=23, round_seconds=60)
    p = _player(room)
    room.players[p.id] = p
    room._apply_director({"action": "lower_dice"})
    assert room.dice_relief_rounds == DICE_RELIEF_ROUNDS
    assert room.nexus.dice_relief_rounds == DICE_RELIEF_ROUNDS
    room.step_round()
    assert room.dice_relief_rounds == DICE_RELIEF_ROUNDS - 1
    room.step_round()
    assert room.dice_relief_rounds == 0
    assert "roll" not in str(room.snapshot(p))


def test_shift_information_sends_a_private_role_nudge():
    room = Room("NUDGE", seed=29, round_seconds=60)
    room.status = "running"
    oracle = _player(room, "o", 1, "oracle")
    navigator = _player(room, "n", 0, "navigator")
    room.players = {oracle.id: oracle, navigator.id: navigator}
    room.nexus.decide = lambda *args, **kwargs: {"action": "shift_information"}

    asyncio.run(room.broadcast_round())
    nudges = [m for m in oracle.ws.sent if m.get("type") == "dealer_nudge"]
    if not nudges:
        nudges = [m for m in navigator.ws.sent if m.get("type") == "dealer_nudge"]
    assert len(nudges) == 1
    receiver = oracle if nudges[0] in oracle.ws.sent else navigator
    other = navigator if receiver is oracle else oracle
    assert not [m for m in other.ws.sent if m.get("type") == "dealer_nudge"]
    assert receiver.role in ("oracle", "navigator")
    assert nudges[0]["text"]
    assert "solution" not in nudges[0] and "sanction" not in nudges[0]["text"]
    assert room.nexus.puzzle_metrics()["info_nudges"] == 1
    assert room.info_nudges[receiver.id] == 1


def test_complexity_actuators_regenerate_puzzle_and_reverse_a_seal():
    room = Room("CMPLX", seed=31, round_seconds=60)
    room.status = "running"
    p = _player(room)
    room.players[p.id] = p
    initial = room.puzzle.complexity
    room._apply_director({"action": "raise_complexity"})
    assert room.puzzle.complexity == min(3, initial + 1)
    assert room._director_seals
    sealed = room._director_seals[-1]
    room._apply_director({"action": "lower_complexity"})
    assert room.puzzle.complexity == initial
    assert not room._director_seals
    rid, direction = sealed
    restored = room.arena.room_by_id(rid)
    assert restored is not None and not restored.doors[direction].sealed
    assert room.arena.solvable()


def test_complexity_actuator_rebuilds_hidden_rules():
    room = Room("RULEZ", seed=37, round_seconds=60)
    initial = len(room.engines)
    room._apply_director({"action": "raise_complexity"})
    assert len(room.engines) > initial
    assert room.snapshot()["rule_count"] == len(room.engines)
    room._apply_director({"action": "lower_complexity"})
    assert len(room.engines) == initial


def test_room_state_transitions_write_room_inventory(monkeypatch):
    calls = []
    monkeypatch.setattr("app.game.audit.room_upsert",
                        lambda room_id, room: calls.append((room_id, room.status, room.round)))
    room = Room("AUDIT", seed=5, min_players=1)
    asyncio.run(room.join(None, "A"))
    p = next(iter(room.players.values()))
    p.ready = True
    asyncio.run(room.maybe_start())
    room.step_round()
    asyncio.run(room.leave(p))
    asyncio.run(room.finish(won=False))
    assert calls
    assert ("AUDIT", "lobby", 0) in calls
    assert any(status == "running" for _, status, _ in calls)
    assert any(status in ("won", "over") for _, status, _ in calls)
