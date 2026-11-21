from __future__ import annotations

import csv
import heapq
import random
import statistics
import time
from collections import defaultdict, deque
from pathlib import Path

from .arena import PATTERN_TYPES, SIZE, Arena, DIRECTIONS, OPPOSITE, STEP
from .directors import make_director
from .nexus import DICE_RELIEF_ROUNDS
from .patterns import PatternEngine, Rule

DYNAMIC_ROUNDS = 4


LEVELS = {
    "novice": {
        "accuracy": 0.42,
        "exploration": 0.28,
        "cooperation": 0.2,
        "leadership": 0.15,
        "stuck": 7.0,
    },
    "average": {
        "accuracy": 0.62,
        "exploration": 0.55,
        "cooperation": 0.55,
        "leadership": 0.45,
        "stuck": 3.5,
    },
    "expert": {
        "accuracy": 0.84,
        "exploration": 0.85,
        "cooperation": 0.85,
        "leadership": 0.75,
        "stuck": 1.2,
    },
}


class SimulatedPlayer:
    def __init__(self, pid: str, level: str, seed: int):
        if level not in LEVELS:
            raise ValueError(f"unknown team level: {level}")
        self.pid = pid
        self.level = level
        self.params = LEVELS[level]
        self.rng = random.Random(seed)
        self.streak = 0
        self.best_streak = 0
        self.first_four_cycle: int | None = None
        self.last_stuck = 0.0
        self.last_success = False
        self.last_wrong = 0

    def predict_success(self, difficulty: float, cycle: int,
                        relief: float = 0.0, assist: float = 0.0) -> bool:
        params = self.params
        learning = min(0.08, cycle * 0.004)
        probability = params["accuracy"] + learning
        probability -= max(0.0, difficulty) * 0.18
        probability += max(0.0, -difficulty) * 0.08
        probability += min(1.0, relief) * 0.06 + min(2.0, assist) * 0.04
        probability = max(0.05, min(0.97, probability))
        return self.rng.random() < probability

    def events(self, cycle: int, difficulty: float, room_codes: list[str],
               total_tiles: int, now: float = 0.0, relief: float = 0.0,
               assist: float = 0.0) -> list[dict]:
        params = self.params
        self.last_stuck = max(
            0.1,
            self.rng.uniform(params["stuck"] * 0.6, params["stuck"] * 1.4)
            * (1.0 + max(0.0, difficulty) * 0.5),
        )
        self.last_success = self.predict_success(difficulty, cycle, relief, assist)
        self.last_wrong = 0 if self.last_success else 1
        if self.last_success:
            self.streak += 1
            self.best_streak = max(self.best_streak, self.streak)
            if self.streak >= 4 and self.first_four_cycle is None:
                self.first_four_cycle = cycle
        else:
            self.streak = 0

        t = now
        events = [{"t": t, "player": self.pid, "kind": "join",
                   "data": {"name": self.pid, "role": "pathfinder"}}]
        t += self.last_stuck
        move_count = max(1, round(params["exploration"] * 4))
        for _ in range(move_count):
            origin = self.rng.choice(room_codes)
            target = self.rng.choice(room_codes)
            events.append({"t": t, "player": self.pid, "kind": "cross",
                           "data": {"room": target, "from": origin, "door": "N",
                                    "x": self.rng.randrange(5), "y": self.rng.randrange(5)}})
            events.append({"t": t, "player": self.pid, "kind": "move",
                           "data": {"room": target,
                                    "x": self.rng.randrange(5), "y": self.rng.randrange(5)}})
            t += 0.4
        if self.rng.random() < min(0.8, difficulty * 0.3 + 0.15):
            t += 0.2
            events.append({"t": t, "player": self.pid, "kind": "bump",
                           "data": {"door": self.rng.choice(["N", "E", "S", "W"])}})
        if self.rng.random() < params["cooperation"]:
            t += 0.2
            events.append({"t": t, "player": self.pid, "kind": "share",
                           "data": {"length": self.rng.randrange(8, 80)}})
        time_left = max(0.1, self.last_stuck * 0.25)
        events.append({"t": t, "player": self.pid, "kind": "predict",
                       "data": {"guess": {"pattern_type": "rotation"},
                                "time_left": round(time_left, 2)}})
        t += 0.2
        events.append({"t": t, "player": self.pid,
                       "kind": "predict_ok" if self.last_success else "predict_bad",
                       "data": {"score": 1.0 if self.last_success else 0.0}})
        if self.rng.random() < params["cooperation"]:
            t += 0.2
            events.append({"t": t, "player": self.pid, "kind": "unlock",
                           "data": {"target": "teammate"}})
        if self.rng.random() < params["leadership"]:
            t += 0.2
            events.append({"t": t, "player": self.pid, "kind": "followed",
                           "data": {"by": "teammate"}})
        events.append({"t": t + 0.1, "player": self.pid, "kind": "round",
                       "data": {"cycle": cycle}})
        return events


def _count_bfs(arena: Arena, start, goal) -> dict:
    started = time.perf_counter()
    queue = deque([start])
    came = {start: None}
    expanded = 0
    found = False
    while queue:
        current = queue.popleft()
        expanded += 1
        if current == goal:
            found = True
            break
        room = arena.room_at(*current)
        if room is None:
            continue
        for direction in DIRECTIONS:
            if not arena.door_open(room, direction):
                continue
            dx, dy = STEP[direction]
            nxt = (current[0] + dx, current[1] + dy)
            if arena.room_at(*nxt) is None or nxt in came:
                continue
            came[nxt] = current
            queue.append(nxt)
    path_cost = 0
    if found:
        node = goal
        while came[node] is not None:
            node = came[node]
            path_cost += 1
    return {
        "nodes_expanded": expanded,
        "path_cost": path_cost if found else None,
        "runtime_ms": round((time.perf_counter() - started) * 1000.0, 4),
        "path_found": int(found),
    }


def _count_astar(arena: Arena, start, goal) -> dict:
    started = time.perf_counter()

    def heuristic(position: tuple[int, int]) -> int:
        return abs(position[0] - goal[0]) + abs(position[1] - goal[1])

    heap = [(heuristic(start), 0, start)]
    came = {start: None}
    best = {start: 0}
    expanded = 0
    found = False
    while heap:
        _, cost, current = heapq.heappop(heap)
        expanded += 1
        if current == goal:
            found = True
            break
        if cost > best[current]:
            continue
        room = arena.room_at(*current)
        if room is None:
            continue
        for direction in DIRECTIONS:
            if not arena.door_open(room, direction):
                continue
            dx, dy = STEP[direction]
            nxt = (current[0] + dx, current[1] + dy)
            if arena.room_at(*nxt) is None:
                continue
            next_cost = cost + 1
            if next_cost < best.get(nxt, 1 << 30):
                best[nxt] = next_cost
                came[nxt] = current
                heapq.heappush(heap, (next_cost + heuristic(nxt), next_cost, nxt))
    path_cost = best.get(goal) if found else None
    return {
        "nodes_expanded": expanded,
        "path_cost": path_cost,
        "runtime_ms": round((time.perf_counter() - started) * 1000.0, 4),
        "path_found": int(found),
    }


def _arena_timeline(seed: int, rounds: int) -> list[Arena]:
    """Generate successive arena states from the same hidden pattern rules."""
    rng = random.Random(seed ^ 0x5EED5EED)
    arena = Arena.generate(size=SIZE, seed=seed)
    engines = [
        PatternEngine(Rule.generate(rng, rng.choice(PATTERN_TYPES), size=SIZE), SIZE)
        for _ in range(2)
    ]
    frames: list[Arena] = []
    for _ in range(max(1, rounds)):
        for engine in engines:
            engine.apply(arena, announce=False)
        arena.ensure_connected()
        frames.append(arena.clone())
    return frames


def _apply_simulated_action(action, arena: Arena, state: dict, seed: int, cycle: int) -> str:
    kind = action.get("action") if isinstance(action, dict) else "hold"
    rng = random.Random(seed ^ (cycle * 7919))
    if kind == "lower_dice":
        state["relief"] = DICE_RELIEF_ROUNDS
    elif kind in ("give_clue", "shift_information"):
        state["assist"] = 2
    elif kind == "add_hazard":
        candidates = [room for room in arena.rooms
                      if not arena.is_exit(room) and not room.sanction]
        if candidates:
            room = rng.choice(candidates)
            room.sanction = rng.choice([1, 2])
            state["hazards"].append(room.rid)
    elif kind == "raise_complexity":
        candidates = [(room, d) for room in arena.rooms for d in DIRECTIONS
                      if arena.door_open(room, d)]
        rng.shuffle(candidates)
        for room, direction in candidates:
            room.doors[direction].sealed = True
            if arena.solvable():
                state["seals"].append((room.rid, direction))
                break
            room.doors[direction].sealed = False
    elif kind == "lower_complexity":
        if state["seals"]:
            rid, direction = state["seals"].pop()
            room = next((item for item in arena.rooms if item.rid == rid), None)
            if room is not None:
                room.doors[direction].sealed = False
        elif state["hazards"]:
            rid = state["hazards"].pop()
            room = next((item for item in arena.rooms if item.rid == rid), None)
            if room is not None:
                room.sanction = 0
    return str(kind)


class Experiment:
    DIRECTORS = ("nexus", "static", "random")
    TEAM_LEVELS = ("novice", "average", "expert")
    METRICS = (
        "changes_needed",
        "completion_time",
        "difficulty_fit_error",
        "stuck_time",
        "solvability_violations",
    )

    def __init__(self, seeds: list[int] | None = None, cycles: int = 15,
                 round_seconds: float = 8.0, output_dir: Path | str | None = None,
                 include_charts: bool = True, search_seeds: list[int] | None = None,
                 dynamic_rounds: int = DYNAMIC_ROUNDS):
        self.seeds = list(range(100)) if seeds is None else list(seeds)
        self.cycles = cycles
        self.round_seconds = round_seconds
        self.output_dir = (Path(output_dir) if output_dir is not None else
                           Path(__file__).resolve().parents[1] / "experiments" / "results")
        self.include_charts = include_charts
        self.search_seeds = list(range(100)) if search_seeds is None else list(search_seeds)
        self.dynamic_rounds = max(1, int(dynamic_rounds))

    def run(self) -> dict[str, str]:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        results: list[dict] = []
        history: list[dict] = []
        clusters: list[dict] = []
        for director_name in self.DIRECTORS:
            for level in self.TEAM_LEVELS:
                for seed in self.seeds:
                    row, rows, cluster_rows = self._simulate_match(director_name, level, seed)
                    results.append(row)
                    history.extend(rows)
                    clusters.extend(cluster_rows)
        search_rows = self.search_benchmark()
        paths = {
            "results": self._write_csv("experiment_results.csv", results),
            "summary": self._write_summary(results),
            "history": self._write_csv("difficulty_history.csv", history),
            "clusters": self._write_csv("player_clusters.csv", clusters),
            "search": self._write_csv("search_results.csv", search_rows),
            "search_summary": self._write_csv("search_dynamic_summary.csv",
                                              self.search_summary(search_rows)),
        }
        if self.include_charts:
            from .experiment_charts import generate_charts
            chart_paths = generate_charts(self.output_dir)
            paths.update(chart_paths)
        return paths

    def _simulate_match(self, director_name: str, level: str, seed: int):
        director_seed = seed ^ (self.DIRECTORS.index(director_name) * 1000003)
        team_seed = seed ^ (self.TEAM_LEVELS.index(level) * 7919)
        director = make_director(director_name, seed=director_seed)
        frames = _arena_timeline(seed, self.cycles)
        players = [
            SimulatedPlayer(f"{level}-{index}", level, team_seed ^ (index * 104729))
            for index in range(4)
        ]
        state = {"relief": 0, "assist": 0, "seals": [], "hazards": []}
        rows: list[dict] = []
        cluster_rows: list[dict] = []
        discovery_cycle: int | None = None
        stuck_total = 0.0
        wrong_total = 0
        solvability_violations = 0

        for cycle in range(1, self.cycles + 1):
            arena = frames[cycle - 1]
            room_codes = [room.code for room in arena.rooms]
            difficulty_before = float(director.difficulty)
            events: list[dict] = []
            now = float(cycle * 60)
            for player in players:
                events.extend(player.events(
                    cycle, difficulty_before, room_codes, len(arena.rooms), now,
                    state["relief"], state["assist"],
                ))
                stuck_total += player.last_stuck
                wrong_total += player.last_wrong
                if player.first_four_cycle is not None:
                    candidate = player.first_four_cycle
                    discovery_cycle = candidate if discovery_cycle is None else min(discovery_cycle, candidate)
            for event in events:
                director.ingest(event)
            director.extract(len(arena.rooms))
            director.cluster()
            solvable = arena.solvable()
            action = director.choose_action({
                "cycle": cycle,
                "solvable": solvable,
                "cycle_time_left": self.round_seconds,
            })
            state["relief"] = max(0, state["relief"] - 1)
            state["assist"] = max(0, state["assist"] - 1)
            applied = _apply_simulated_action(action, arena, state, seed, cycle)
            director.ingest({
                "t": now, "player": None, "kind": "dice_relief",
                "data": {"rounds": state["relief"]},
            })
            if not arena.solvable():
                solvability_violations += 1
            rows.append({
                "director": director_name,
                "team_level": level,
                "seed": seed,
                "cycle": cycle,
                "difficulty": round(float(director.difficulty), 4),
                "team_skill": round(float(director.team_skill), 4),
                "team_streak": max(player.streak for player in players),
                "action": applied,
            })

        for pid, model in getattr(director, "models", {}).items():
            cluster_rows.append({
                "director": director_name,
                "team_level": level,
                "seed": seed,
                "player": pid,
                "style": model.style,
                "exploration": round(model.attrs["exploration"], 4),
                "risk": round(model.attrs["risk"], 4),
                "cooperation": round(model.attrs["cooperation"], 4),
                "pattern": round(model.attrs["pattern"], 4),
                "puzzle": round(model.attrs["puzzle"], 4),
                "leadership": round(model.attrs["leadership"], 4),
            })

        fit_error = (float(director.difficulty_fit_error()) if hasattr(director, "difficulty_fit_error")
                     else abs(float(director.difficulty)))
        completion_cycle = discovery_cycle if discovery_cycle is not None else self.cycles
        row = {
            "director": director_name,
            "team_level": level,
            "seed": seed,
            "cycles": self.cycles,
            "changes_needed": completion_cycle,
            "completion_time": round(completion_cycle * self.round_seconds, 2),
            "difficulty_fit_error": round(fit_error, 4),
            "stuck_time": round(stuck_total / max(1, len(players) * self.cycles), 4),
            "wrong_predictions": wrong_total,
            "final_difficulty": round(float(director.difficulty), 4),
            "final_team_skill": round(float(director.team_skill), 4),
            "solvability_violations": solvability_violations,
        }
        return row, rows, cluster_rows

    def search_benchmark(self) -> list[dict]:
        """BFS vs A* on a changing maze: one generated shift per round."""
        rows: list[dict] = []
        for seed in self.search_seeds:
            frames = _arena_timeline(seed, self.dynamic_rounds)
            for round_no, arena in enumerate(frames, start=1):
                start = (arena.start_room().bx, arena.start_room().by)
                goal = (arena.exit_room().bx, arena.exit_room().by)
                for algorithm, runner in (("bfs", _count_bfs), ("astar", _count_astar)):
                    row = runner(arena, start, goal)
                    rows.append({
                        "seed": seed,
                        "round": round_no,
                        "algorithm": algorithm,
                        "path_length": row["path_cost"],
                        **row,
                    })
        return rows

    @staticmethod
    def search_summary(rows: list[dict]) -> list[dict]:
        """Per-round success rate, nodes expanded and path length by algorithm."""
        groups: dict[tuple[str, int], list[dict]] = defaultdict(list)
        for row in rows:
            groups[(row["algorithm"], int(row["round"]))].append(row)
        output: list[dict] = []
        for (algorithm, round_no), values in sorted(groups.items()):
            found = [int(row["path_found"]) for row in values]
            lengths = [float(row["path_length"]) for row in values
                       if row.get("path_length") not in (None, "")]
            output.append({
                "algorithm": algorithm,
                "round": round_no,
                "matches": len(values),
                "success_rate": round(sum(found) / max(1, len(found)), 4),
                "mean_nodes_expanded": round(statistics.mean(
                    float(row["nodes_expanded"]) for row in values), 4),
                "mean_path_length": round(statistics.mean(lengths), 4) if lengths else "",
                "mean_runtime_ms": round(statistics.mean(
                    float(row["runtime_ms"]) for row in values), 4),
            })
        return output

    def _write_csv(self, name: str, rows: list[dict]) -> str:
        path = self.output_dir / name
        headers = list(rows[0]) if rows else ["seed", "director", "team_level"]
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=headers)
            writer.writeheader()
            writer.writerows(rows)
        return str(path)

    def _write_summary(self, rows: list[dict]) -> str:
        path = self.output_dir / "summary.csv"
        groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
        for row in rows:
            groups[(row["director"], row["team_level"])].append(row)
        output: list[dict] = []
        for (director, level), values in sorted(groups.items()):
            row = {"director": director, "team_level": level, "matches": len(values)}
            for metric in self.METRICS:
                nums = [float(item[metric]) for item in values]
                row[f"{metric}_mean"] = round(statistics.mean(nums), 4)
                row[f"{metric}_std"] = round(statistics.pstdev(nums), 4)
            output.append(row)
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(output[0]) if output else
                                    ["director", "team_level", "matches"])
            writer.writeheader()
            writer.writerows(output)
        return str(path)
