import pytest

from app.directors import (
    Director,
    NexusDirector,
    RandomDirector,
    StaticDirector,
    make_director,
)
from app.game import Room
from app.nexus import MAX_COMPLEXITY, MIN_COMPLEXITY


def test_director_subclasses_are_concrete():
    assert isinstance(NexusDirector(seed=1), Director)
    assert isinstance(StaticDirector(seed=1), Director)
    assert isinstance(RandomDirector(seed=1), Director)


def test_static_director_does_not_adapt():
    director = StaticDirector(seed=2)
    first = director.choose_action({"cycle": 1, "solvable": True, "cycle_time_left": 5})
    second = director.choose_action({"cycle": 9, "solvable": False, "cycle_time_left": 1})
    assert first["action"] == second["action"] == "hold"
    assert director.difficulty == 0.0


def test_random_director_is_deterministic_for_a_seed():
    first = RandomDirector(seed=7)
    second = RandomDirector(seed=7)
    actions_a = [first.choose_action({"cycle": i, "solvable": True})["action"] for i in range(8)]
    actions_b = [second.choose_action({"cycle": i, "solvable": True})["action"] for i in range(8)]
    assert actions_a == actions_b


def test_random_director_keeps_complexity_in_bounds():
    director = RandomDirector(seed=9)
    for i in range(30):
        director.choose_action({"cycle": i, "solvable": True, "cycle_time_left": 8})
        assert MIN_COMPLEXITY <= director.complexity_level <= MAX_COMPLEXITY


def test_random_director_only_changes_complexity_for_complexity_actions():
    director = RandomDirector(seed=10)
    before = director.complexity_level
    for action in ("add_hazard", "give_clue", "lower_dice", "shift_information"):
        director.commit_action({"action": action})
        assert director.complexity_level == before


def test_nexus_director_delegates_to_utility_decision():
    director = NexusDirector(seed=3)
    director.team_skill = 0.9
    action = director.choose_action({"cycle": 4, "solvable": True, "cycle_time_left": 6})
    assert action["action"] in ("raise_complexity", "add_hazard", "hold")
    assert "terms" in action


def test_make_director_accepts_all_baseline_names():
    assert isinstance(make_director("nexus", seed=1), NexusDirector)
    assert isinstance(make_director("StaticDirector", seed=1), StaticDirector)
    assert isinstance(make_director("random_director", seed=1), RandomDirector)
    with pytest.raises(ValueError):
        make_director("missing", seed=1)


def test_room_accepts_injected_director():
    director = StaticDirector(seed=4)
    room = Room("D", seed=4, director=director)
    assert room.nexus is director
    assert room.snapshot()["nexus"]["director"] == "static"
