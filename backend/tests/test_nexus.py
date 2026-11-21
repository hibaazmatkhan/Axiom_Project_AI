"""NEXUS AI Director tests (WP6)."""
import numpy as np
import pytest
from sklearn.cluster import KMeans

from app.nexus import (
    ATTRIBUTES,
    CLUE_MAX_CHANCE,
    CLUE_MAX_PER_STAGE,
    CLUE_MIN_CHANCE,
    CLUE_PLAYER_COOLDOWN,
    CLUE_TEAM_COOLDOWN,
    CLUE_TIERS,
    DICE_RELIEF_ROUNDS,
    DIRECTOR_ACTIONS,
    MAX_COMPLEXITY,
    MIN_COMPLEXITY,
    ROLE_NUDGES,
    Nexus,
    PlayerModel,
)


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
    nx.ingest({"player": "p1", "kind": "predict_ok", "data": {}})
    nx.ingest({"player": "p1", "kind": "share", "data": {}})
    nx.extract(50)
    assert nx.team_skill > baseline


def test_prediction_and_follow_events_feed_the_model():
    nx = Nexus(seed=13)
    nx.ingest({"player": "p1", "kind": "predict_ok", "data": {}})
    nx.ingest({"player": "p1", "kind": "followed", "data": {}})
    m = nx.models["p1"]
    assert m.correct == 1 and m.follows == 1
    nx.extract(50)
    assert m.attrs["puzzle"] == pytest.approx(1.0)
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
        strong.choose_action({"cycle": c, "solvable": True, "cycle_time_left": 5})
    weak = Nexus(seed=1)
    weak.team_skill = 0.05
    for c in range(8):
        weak.choose_action({"cycle": c, "solvable": True, "cycle_time_left": 5})
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
    nx.ingest({"player": "p1", "kind": "join", "data": {"name": "Hiba", "role": "pathfinder"}})
    assert nx.models["p1"].name == "Hiba"
    assert nx.models["p1"].public()["name"] == "Hiba"


def test_exploration_tracks_distinct_tiles():
    nx = Nexus(seed=5)
    for i in range(10):
        nx.ingest({"player": "p1", "kind": "move", "data": {"x": i, "y": 0}})
    nx.extract(100)
    assert 0 < nx.models["p1"].attrs["exploration"] <= 1.0


def test_clue_chance_scales_with_team_skill_and_clamps():
    nx = Nexus(seed=20)
    assert nx.clue_chance(0.5) == pytest.approx(0.6)
    assert nx.clue_chance(0.2) == pytest.approx(0.8)
    assert nx.clue_chance(0.9) == pytest.approx(0.4)
    assert nx.clue_chance(-1.0) == pytest.approx(0.8)
    assert nx.clue_chance(2.0) == pytest.approx(0.4)
    assert CLUE_MIN_CHANCE <= nx.clue_chance(-1.0) <= CLUE_MAX_CHANCE
    assert CLUE_MIN_CHANCE <= nx.clue_chance(2.0) <= CLUE_MAX_CHANCE


def test_clue_tiers_only_emit_for_valid_distances():
    nx = Nexus(seed=21)
    nx.clue_chance = lambda skill=None: 1.0

    low = nx.make_clue("p1", 1, 0, 1)
    high = nx.make_clue("p2", 2, CLUE_TEAM_COOLDOWN, 1)

    assert low is not None and low["tier"] == 1
    assert low["text"] in CLUE_TIERS[1]
    assert high is not None and high["tier"] == 2
    assert high["text"] in CLUE_TIERS[2]
    assert nx.make_clue("p3", 0, CLUE_TEAM_COOLDOWN * 2, 1) is None
    assert nx.make_clue("p4", 3, CLUE_TEAM_COOLDOWN * 3, 1) is None


def test_clue_cooldowns_and_stage_cap():
    nx = Nexus(seed=22)
    nx.clue_chance = lambda skill=None: 1.0

    assert nx.make_clue("p1", 2, 0, 1)
    assert nx.make_clue("p1", 2, 10, 1) is None
    assert nx.make_clue("p2", 1, 10, 1) is None
    assert nx.make_clue("p2", 1, CLUE_TEAM_COOLDOWN, 1)
    assert nx.make_clue("p1", 2, CLUE_PLAYER_COOLDOWN, 1)

    cap = Nexus(seed=23)
    cap.clue_chance = lambda skill=None: 1.0
    for i in range(CLUE_MAX_PER_STAGE):
        assert cap.make_clue(f"c{i}", 1, i * CLUE_TEAM_COOLDOWN, 1)
    assert cap.make_clue("late", 1, CLUE_MAX_PER_STAGE * CLUE_TEAM_COOLDOWN, 1) is None
    assert cap.make_clue("next", 1, (CLUE_MAX_PER_STAGE + 1) * CLUE_TEAM_COOLDOWN, 2)


def test_decision_reports_utility_terms():
    nx = Nexus(seed=30)
    nx.team_skill = 0.8
    action = nx.decide(1, solvable=True, cycle_time_left=8)
    assert set(action["terms"]) == {"skill_fit", "progress", "cooperation_balance", "frustration"}
    assert "alternatives" in action


def test_cross_events_update_exploration():
    nx = Nexus(seed=31)
    for code in ("A1", "B2", "C3", "D4"):
        nx.ingest({"player": "p1", "kind": "cross", "data": {"room": code, "from": "C3"}})
    nx.extract(25)
    assert nx.models["p1"].moves == 4
    assert nx.models["p1"].attrs["exploration"] > 0


def test_wrong_predictions_track_frustration_and_streaks():
    nx = Nexus(seed=32)
    for _ in range(4):
        nx.ingest({"player": "p1", "kind": "predict_ok", "data": {}})
    nx.ingest({"player": "p1", "kind": "predict_bad", "data": {}})
    nx.extract(25)
    model = nx.models["p1"]
    assert model.best_prediction_streak == 4
    assert model.prediction_streak == 0
    assert model.wrong == 1
    assert nx.frustration() > 0


def test_difficulty_fit_error_uses_target_band():
    nx = Nexus(seed=33)
    nx.team_skill = 0.1
    nx.difficulty = 1.0
    assert nx.target_difficulty() < 0
    assert nx.difficulty_fit_error() > 0.5
    nx.difficulty = nx.target_difficulty()
    assert nx.difficulty_fit_error() == 0


def test_clustering_uses_sklearn_kmeans_deterministically():
    first = Nexus(seed=19)
    second = Nexus(seed=19)
    for nx in (first, second):
        for i in range(4):
            nx.models[f"p{i}"] = PlayerModel(f"p{i}")
            nx.models[f"p{i}"].attrs["exploration"] = i / 4
            nx.models[f"p{i}"].attrs["pattern"] = (i % 2) / 3
    first.cluster()
    second.cluster()
    assert [m.style for m in first.models.values()] == [m.style for m in second.models.values()]
    assert np.array_equal(first._centroids, second._centroids)
    X = np.vstack([m.vector() for m in first.models.values()])
    expected = KMeans(n_clusters=4, init=X[np.linspace(0, 3, 4).astype(int)].copy(),
                      n_init=1, max_iter=25, random_state=0).fit(X)
    assert np.allclose(np.sort(first._centroids, axis=0), np.sort(expected.cluster_centers_, axis=0))


def test_lower_dice_sets_bounded_relief_without_hidden_state():
    nx = Nexus(seed=40)
    nx.utility_terms = lambda action: {
        "skill_fit": 5.0 if action == "lower_dice" else 0.0,
        "progress": 0.0, "cooperation_balance": 0.0, "frustration": 0.0,
    }
    action = nx.decide(1, solvable=True, cycle_time_left=8)
    assert action["action"] == "lower_dice"
    assert action["dice_relief"]["rounds"] == DICE_RELIEF_ROUNDS
    assert nx.dice_relief_rounds == 0
    nx.commit_action(action)
    assert nx.dice_relief_rounds == 0
    assert "roll" not in str(action) and "sanction" not in str(action)

    nx.ingest({"t": 1, "player": None, "kind": "dice_relief",
               "data": {"rounds": DICE_RELIEF_ROUNDS + 10}})
    assert nx.dice_relief_rounds == DICE_RELIEF_ROUNDS
    assert nx.team_report()["dice_relief_rounds"] == DICE_RELIEF_ROUNDS


def test_shift_information_produces_a_role_appropriate_nudge():
    nudge = Nexus.role_nudge(2, ["oracle", "timekeeper"])
    assert nudge["role"] in ("oracle", "timekeeper")
    assert nudge["text"] == ROLE_NUDGES[nudge["role"]]
    assert "sigil" not in nudge["text"] or nudge["role"] == "oracle"
    nx = Nexus(seed=41)
    nx.ingest({"t": 1, "player": None, "kind": "info_nudge", "data": {"role": "oracle"}})
    assert nx.puzzle_metrics()["info_nudges"] == 1


def test_complexity_actuators_are_bounded_and_reversible():
    assert "lower_complexity" in DIRECTOR_ACTIONS
    nx = Nexus(seed=42)
    nx.complexity_level = MIN_COMPLEXITY
    nx.apply_action_effects("raise_complexity")
    assert nx.complexity_level == MIN_COMPLEXITY + 1
    for _ in range(MAX_COMPLEXITY + 3):
        nx.apply_action_effects("raise_complexity")
    assert nx.complexity_level == MAX_COMPLEXITY
    nx.apply_action_effects("lower_complexity")
    assert nx.complexity_level == MAX_COMPLEXITY - 1
    for _ in range(MAX_COMPLEXITY):
        nx.apply_action_effects("lower_complexity")
    assert nx.complexity_level == MIN_COMPLEXITY
    for _ in range(20):
        nx.choose_action({"cycle": 1, "solvable": True, "cycle_time_left": 8})
        assert MIN_COMPLEXITY <= nx.complexity_level <= MAX_COMPLEXITY


def test_decide_commits_state_only_once():
    nx = Nexus(seed=44)
    nx.utility_terms = lambda action: {
        "skill_fit": 5.0 if action == "raise_complexity" else 0.0,
        "progress": 0.0, "cooperation_balance": 0.0, "frustration": 0.0,
    }
    before = (nx.difficulty, nx.complexity_level)
    action = nx.decide(1, solvable=True, cycle_time_left=8)
    assert (nx.difficulty, nx.complexity_level) == before
    nx.commit_action(action)
    assert nx.difficulty > before[0]
    assert nx.complexity_level == before[1] + 1


def test_puzzle_metrics_are_exposed_in_team_report():
    nx = Nexus(seed=43)
    nx.ingest({"t": 0, "player": None, "kind": "puzzle_generated",
               "data": {"difficulty": "hard", "complexity": 3}})
    nx.ingest({"t": 1, "player": None, "kind": "puzzle_attempt", "data": {"correct": False}})
    nx.ingest({"t": 2, "player": None, "kind": "puzzle_attempt", "data": {"correct": True}})
    report = nx.team_report()
    assert report["puzzle"]["generated"] == 1
    assert report["puzzle"]["difficulty"] == "hard"
    assert report["puzzle"]["attempts"] == 2
    assert report["puzzle"]["solved"] == 1
    assert report["puzzle"]["success_rate"] == 0.5
