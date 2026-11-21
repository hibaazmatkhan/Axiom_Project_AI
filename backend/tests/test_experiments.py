import csv
from pathlib import Path

from app.arena import Arena
from app.nexus import DICE_RELIEF_ROUNDS, Nexus
from app.simulation import Experiment, SimulatedPlayer, _apply_simulated_action


def _read_rows(path: Path) -> list[dict]:
    with path.open("r", newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def test_simulated_player_events_feed_player_model():
    player = SimulatedPlayer("novice-0", "novice", 11)
    events = player.events(1, 0.0, ["A1", "B2", "C3"], 25, now=0.0)
    nexus = Nexus(seed=1)
    for event in events:
        nexus.ingest(event)
    nexus.extract(25)
    model = nexus.models["novice-0"]
    assert model.moves > 0
    assert model.predictions == 1
    assert model.stuck_seconds > 0


def test_experiment_defaults_to_900_matches():
    experiment = Experiment()
    assert len(experiment.seeds) == 100
    assert len(experiment.DIRECTORS) * len(experiment.TEAM_LEVELS) * len(experiment.seeds) == 900
    assert experiment.cycles == 15


def test_experiment_writes_csv_and_charts(tmp_path):
    experiment = Experiment(
        seeds=[0, 1],
        cycles=4,
        output_dir=tmp_path,
        include_charts=True,
        search_seeds=[0],
        dynamic_rounds=3,
    )
    paths = experiment.run()
    assert len(_read_rows(Path(paths["results"]))) == 18
    assert len(_read_rows(Path(paths["summary"]))) == 9
    assert len(_read_rows(Path(paths["history"]))) == 72
    assert len(_read_rows(Path(paths["search"]))) == 6
    summary = _read_rows(Path(paths["search_summary"]))
    assert len(summary) == 6
    assert {"algorithm", "round", "success_rate", "mean_nodes_expanded",
            "mean_path_length"} <= set(summary[0])
    for key in ("search_nodes_expanded", "search_success_rate", "search_path_length",
                "difficulty_over_time", "changes_needed", "player_clusters"):
        assert Path(paths[key]).exists()


def test_director_actions_mutate_the_simulated_environment():
    arena = Arena.generate(5, seed=7)
    state = {"relief": 0, "assist": 0, "seals": [], "hazards": []}
    assert _apply_simulated_action({"action": "add_hazard"}, arena, state, 7, 1) == "add_hazard"
    assert state["hazards"]
    assert _apply_simulated_action({"action": "lower_dice"}, arena, state, 7, 2) == "lower_dice"
    assert state["relief"] == DICE_RELIEF_ROUNDS
    assert _apply_simulated_action({"action": "raise_complexity"}, arena, state, 7, 3) == "raise_complexity"
    assert state["seals"]
    assert arena.solvable()
    assert _apply_simulated_action({"action": "lower_complexity"}, arena, state, 7, 4) == "lower_complexity"
    assert not state["seals"]


def test_search_benchmark_uses_changing_mazes():
    rows = Experiment(seeds=[], search_seeds=[3, 7], dynamic_rounds=3).search_benchmark()
    assert len(rows) == 12
    assert {row["round"] for row in rows} == {1, 2, 3}
    assert {row["algorithm"] for row in rows} == {"bfs", "astar"}
    assert all("nodes_expanded" in row and "path_length" in row for row in rows)
    astar = [row for row in rows if row["algorithm"] == "astar"]
    assert any(row["nodes_expanded"] != astar[0]["nodes_expanded"] for row in astar[1:])
