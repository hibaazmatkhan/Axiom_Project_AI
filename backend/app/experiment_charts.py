from __future__ import annotations

import csv
import statistics
from collections import defaultdict
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def _read_rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open("r", newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def generate_charts(directory: Path | str) -> dict[str, str]:
    root = Path(directory)
    root.mkdir(parents=True, exist_ok=True)
    paths: dict[str, str] = {}

    search_rows = _read_rows(root / "search_results.csv")
    if search_rows:
        groups: dict[str, list[float]] = defaultdict(list)
        for row in search_rows:
            value = row.get("nodes_expanded")
            if value not in (None, ""):
                groups[row["algorithm"]].append(float(value))
        labels = sorted(groups)
        means = [statistics.mean(groups[label]) for label in labels]
        figure, axis = plt.subplots(figsize=(7, 4))
        axis.bar(labels, means, color="#3f7bd9")
        axis.set_title("Nodes expanded: A* vs BFS")
        axis.set_ylabel("Mean nodes expanded")
        figure.tight_layout()
        path = root / "search_nodes_expanded.png"
        figure.savefig(path, dpi=150)
        plt.close(figure)
        paths["search_nodes_expanded"] = str(path)

        by_round: dict[tuple[str, int], list[float]] = defaultdict(list)
        for row in search_rows:
            try:
                round_no = int(row.get("round", 0))
                success = float(row.get("path_found", 0))
            except (KeyError, TypeError, ValueError):
                continue
            by_round[(row["algorithm"], round_no)].append(success)
        if by_round:
            figure, axis = plt.subplots(figsize=(7, 4))
            for (algorithm, round_no), values in sorted(by_round.items()):
                axis.scatter([round_no], [statistics.mean(values)],
                             label=algorithm, alpha=0.85)
            rounds = sorted({round_no for _, round_no in by_round})
            axis.set_xticks(rounds)
            axis.set_title("Search success rate by shift round")
            axis.set_xlabel("Round")
            axis.set_ylabel("Success rate")
            axis.set_ylim(-0.05, 1.05)
            axis.legend(fontsize=7)
            figure.tight_layout()
            path = root / "search_success_rate.png"
            figure.savefig(path, dpi=150)
            plt.close(figure)
            paths["search_success_rate"] = str(path)

        lengths: dict[tuple[str, int], list[float]] = defaultdict(list)
        for row in search_rows:
            try:
                round_no = int(row.get("round", 0))
                length = float(row["path_length"])
            except (KeyError, TypeError, ValueError):
                continue
            lengths[(row["algorithm"], round_no)].append(length)
        if lengths:
            figure, axis = plt.subplots(figsize=(7, 4))
            for (algorithm, round_no), values in sorted(lengths.items()):
                axis.scatter([round_no], [statistics.mean(values)],
                             label=algorithm, alpha=0.85)
            axis.set_xticks(sorted({round_no for _, round_no in lengths}))
            axis.set_title("Path length by shift round")
            axis.set_xlabel("Round")
            axis.set_ylabel("Mean steps (solved mazes)")
            axis.legend(fontsize=7)
            figure.tight_layout()
            path = root / "search_path_length.png"
            figure.savefig(path, dpi=150)
            plt.close(figure)
            paths["search_path_length"] = str(path)

    history_rows = _read_rows(root / "difficulty_history.csv")
    if history_rows:
        groups: dict[tuple[str, str], dict[int, list[float]]] = defaultdict(lambda: defaultdict(list))
        for row in history_rows:
            try:
                cycle = int(row["cycle"])
                value = float(row["difficulty"])
            except (KeyError, TypeError, ValueError):
                continue
            groups[(row["director"], row["team_level"])][cycle].append(value)
        figure, axis = plt.subplots(figsize=(9, 5))
        for (director, level), by_cycle in sorted(groups.items()):
            cycles = sorted(by_cycle)
            axis.plot(cycles, [statistics.mean(by_cycle[cycle]) for cycle in cycles],
                      label=f"{director} / {level}")
        axis.set_title("Difficulty over time")
        axis.set_xlabel("Cycle")
        axis.set_ylabel("Difficulty")
        axis.legend(fontsize=7, ncol=2)
        figure.tight_layout()
        path = root / "difficulty_over_time.png"
        figure.savefig(path, dpi=150)
        plt.close(figure)
        paths["difficulty_over_time"] = str(path)

    result_rows = _read_rows(root / "experiment_results.csv")
    if result_rows:
        groups: dict[str, list[float]] = defaultdict(list)
        for row in result_rows:
            value = row.get("changes_needed")
            if value not in (None, ""):
                groups[row["director"]].append(float(value))
        labels = sorted(groups)
        figure, axis = plt.subplots(figsize=(7, 4))
        axis.boxplot([groups[label] for label in labels])
        axis.set_xticks(range(1, len(labels) + 1))
        axis.set_xticklabels(labels)
        axis.set_title("Changes needed to discover the rule")
        axis.set_ylabel("Cycles")
        figure.tight_layout()
        path = root / "changes_needed.png"
        figure.savefig(path, dpi=150)
        plt.close(figure)
        paths["changes_needed"] = str(path)

    cluster_rows = _read_rows(root / "player_clusters.csv")
    if cluster_rows:
        styles: dict[str, tuple[list[float], list[float]]] = defaultdict(lambda: ([], []))
        for row in cluster_rows:
            try:
                x = float(row["exploration"])
                y = float(row["pattern"])
            except (KeyError, TypeError, ValueError):
                continue
            styles[row.get("style", "Scout")][0].append(x)
            styles[row.get("style", "Scout")][1].append(y)
        figure, axis = plt.subplots(figsize=(7, 5))
        for style, (xs, ys) in sorted(styles.items()):
            axis.scatter(xs, ys, s=22, alpha=0.7, label=style)
        axis.set_title("NEXUS player clusters")
        axis.set_xlabel("Exploration")
        axis.set_ylabel("Pattern skill")
        axis.legend(fontsize=7)
        figure.tight_layout()
        path = root / "player_clusters.png"
        figure.savefig(path, dpi=150)
        plt.close(figure)
        paths["player_clusters"] = str(path)

    return paths
