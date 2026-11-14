"""NEXUS AI Director tests (WP6)."""
import pytest

from app.nexus import ATTRIBUTES, Nexus, PlayerModel


def test_six_attributes_present():
    m = PlayerModel("p")
    assert set(m.attrs) == set(ATTRIBUTES)
    assert len(ATTRIBUTES) == 6


def test_ingest_updates_model():
    nx = Nexus(seed=1)
    nx.ingest({"player": "p1", "kind": "move", "data": {"x": 1, "y": 1}})
    nx.ingest({"player": "p1", "kind": "predict_ok", "data": {}})
    nx.ingest({"player": "p1", "kind": "share", "data": {}})
    m = nx.models["p1"]
    assert m.moves == 1 and m.correct == 1 and m.shares == 1
    nx.extract(50)
    assert m.attrs["cooperation"] > 0
    assert m.attrs["pattern"] == 1.0


def test_unobserved_attributes_use_a_neutral_prior():
    """A team that has not acted yet must not look incompetent."""
    nx = Nexus(seed=11)
    nx.ingest({"player": "p1", "kind": "join", "data": {"name": "A"}})
    nx.extract(50)
    assert nx.team_skill == pytest.approx(0.5, abs=0.01)


def test_team_skill_reflects_more_than_predictions():
    nx = Nexus(seed=12)
    nx.ingest({"player": "p1", "kind": "join", "data": {"name": "A"}})
    nx.extract(50)
    baseline = nx.team_skill
    nx.ingest({"player": "p1", "kind": "puzzle_ok", "data": {}})
    nx.ingest({"player": "p1", "kind": "share", "data": {}})
    nx.extract(50)
    assert nx.team_skill > baseline


def test_puzzle_and_follow_events_feed_the_model():
    nx = Nexus(seed=13)
    nx.ingest({"player": "p1", "kind": "puzzle_step", "data": {}})
    nx.ingest({"player": "p1", "kind": "puzzle_ok", "data": {}})
    nx.ingest({"player": "p1", "kind": "followed", "data": {}})
    m = nx.models["p1"]
    assert m.puzzle_attempts == 2 and m.puzzle_correct == 1 and m.follows == 1
    nx.extract(50)
    assert m.attrs["puzzle"] == pytest.approx(0.5)
    assert m.attrs["leadership"] > 0


def test_extract_is_idempotent():
    nx = Nexus(seed=14)
    nx.ingest({"player": "p1", "kind": "move", "data": {"x": 1, "y": 1}})
    nx.ingest({"player": "p1", "kind": "bump", "data": {}})
    nx.extract(100)
    first = nx.models["p1"].attrs["risk"]
    nx.extract(100)
    assert nx.models["p1"].attrs["risk"] == first


def test_strong_team_raises_difficulty_weak_team_lowers():
    strong = Nexus(seed=1)
    strong.team_skill = 0.95
    for c in range(8):
        strong.decide(c, solvable=True, cycle_time_left=5)
    weak = Nexus(seed=1)
    weak.team_skill = 0.05
    for c in range(8):
        weak.decide(c, solvable=True, cycle_time_left=5)
    assert strong.difficulty > weak.difficulty
    assert strong.difficulty > 0 and weak.difficulty < 0


def test_unsolvable_state_prioritises_clue():
    nx = Nexus(seed=2)
    nx.team_skill = 0.9
    act = nx.decide(0, solvable=False, cycle_time_left=1)
    assert act["action"] in ("give_clue", "shift_information")


def test_tune_runs_simulated_team():
    result = Nexus.tune(team_skill=0.9, cycles=6)
    assert len(result["path"]) == 6
    assert result["final_difficulty"] >= 0


def test_clustering_assigns_styles():
    nx = Nexus(seed=3)
    for i in range(4):
        nx.models[f"p{i}"] = PlayerModel(f"p{i}")
        nx.models[f"p{i}"].attrs["exploration"] = i / 4
        nx.models[f"p{i}"].attrs["pattern"] = i / 4
    nx.cluster()
    assert all(m.style for m in nx.models.values())


def test_join_event_records_player_name():
    nx = Nexus(seed=4)
    nx.ingest({"player": "p1", "kind": "join", "data": {"name": "Hiba", "role": "navigator"}})
    assert nx.models["p1"].name == "Hiba"
    assert nx.models["p1"].public()["name"] == "Hiba"


def test_exploration_tracks_distinct_tiles():
    nx = Nexus(seed=5)
    for i in range(10):
        nx.ingest({"player": "p1", "kind": "move", "data": {"x": i, "y": 0}})
    nx.extract(100)
    assert 0 < nx.models["p1"].attrs["exploration"] <= 1.0
