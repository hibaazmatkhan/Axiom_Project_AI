# NEXUS evaluation

NEXUS is AXIOM's adaptive director ("The Dealer"). It reads a raw event log,
maintains a six-attribute model per player (`exploration`, `risk`,
`cooperation`, `pattern`, `puzzle`, `leadership`), clusters those vectors with
deterministic scikit-learn KMeans, and chooses one bounded action each cycle by
utility: `raise_complexity`, `lower_complexity`, `add_hazard`, `give_clue`,
`lower_dice`, `shift_information`, or `hold`.

This report records the reproducible benchmark used for Phase 6/7. The runner is
`backend/experiments/run_experiment.py`; all generated CSV and PNG artifacts are
retained under `backend/experiments/results/`.

## Configuration

| Parameter | Value |
|---|---|
| Directors | `nexus`, `static`, `random` |
| Team levels | `novice`, `average`, `expert` |
| Seeds | `0..99` |
| Matches | 3 × 3 × 100 = 900 |
| Cycles per match | 15 |
| Nominal cycle time | 8 seconds |
| Search benchmark | 100 seeds × 4 shifting rounds × BFS/A* |
| Randomness | seeded, replayable `numpy`/`random` streams |

Each simulated match uses a fresh changing-maze timeline generated from the same
seed. Simulated players emit movement, prediction, sharing and lock events; the
director consumes those events, extracts player attributes, clusters styles and
chooses an action. The selected action is applied to the simulated environment:
complexity changes seal or reopen a solvable door, hazards seed sanction rooms,
`lower_dice` grants bounded d10 relief, and clue/information actions grant a
bounded prediction assist. Director state and difficulty are therefore coupled
to the environment under evaluation, not merely recorded.

## Metrics

- `changes_needed`: first cycle at which a player reaches four correct predictions in a row.
- `completion_time`: `changes_needed × cycle time` (or the full 15-cycle horizon if never reached).
- `difficulty_fit_error`: distance between the director's difficulty and the skill target band.
- `stuck_time`: average simulated delay before acting, per player per cycle.
- `solvability_violations`: cycles in which the post-action arena is not solvable.
- Search metrics: nodes expanded, path length, runtime and success rate per shift round.

## Results

Mean values from [`summary.csv`](../backend/experiments/results/summary.csv):

| Director | Team | Changes needed | Completion time (s) | Difficulty fit error | Stuck time |
|---|---|---:|---:|---:|---:|
| NEXUS | novice | 10.19 | 81.52 | 0.0030 | 7.1425 |
| NEXUS | average | 5.83 | 46.64 | 0.0004 | 3.9095 |
| NEXUS | expert | 4.35 | 34.80 | 0.0010 | 1.4235 |
| Static | novice | 10.04 | 80.32 | 0.0614 | 6.9637 |
| Static | average | 5.55 | 44.40 | 0.2591 | 3.5137 |
| Static | expert | 4.19 | 33.52 | 0.3771 | 1.2054 |
| Random | novice | 9.19 | 73.52 | 0.5761 | 7.1742 |
| Random | average | 5.39 | 43.12 | 0.7440 | 3.6239 |
| Random | expert | 4.14 | 33.12 | 0.8190 | 1.2426 |

NEXUS keeps difficulty fit error near zero across all three team levels, while
the static and random baselines drift substantially. Raw and random directors
occasionally finish earlier because they do not spend actions on skill-fitting;
NEXUS trades a small amount of raw speed for sustained target-band difficulty.
No post-action solvability violations were recorded.

Search results from
[`search_dynamic_summary.csv`](../backend/experiments/results/search_dynamic_summary.csv):

| Algorithm | Round | Success rate | Mean nodes | Mean path length |
|---|---:|---:|---:|---:|
| A* | 1 | 1.0 | 9.86 | 5.46 |
| A* | 2 | 1.0 | 8.95 | 4.86 |
| A* | 3 | 1.0 | 8.97 | 5.02 |
| A* | 4 | 1.0 | 8.09 | 4.46 |
| BFS | 1 | 1.0 | 15.99 | 5.46 |
| BFS | 2 | 1.0 | 15.80 | 4.86 |
| BFS | 3 | 1.0 | 16.07 | 5.02 |
| BFS | 4 | 1.0 | 15.72 | 4.46 |

A* expands roughly half as many nodes as BFS while finding the same optimal path
length. The benchmark repairs connectivity after every generated shift, so the
success rate is intentionally 1.0; it measures search cost on solvable changing
mazes rather than generator failure.

## Retained artifacts

- [`experiment_results.csv`](../backend/experiments/results/experiment_results.csv) — one row per match.
- [`summary.csv`](../backend/experiments/results/summary.csv) — mean/std by director and team level.
- [`difficulty_history.csv`](../backend/experiments/results/difficulty_history.csv) — per-cycle difficulty and team skill.
- [`player_clusters.csv`](../backend/experiments/results/player_clusters.csv) — clustered six-attribute player vectors.
- [`search_results.csv`](../backend/experiments/results/search_results.csv) — BFS/A* rows for every seed and round.
- [`search_dynamic_summary.csv`](../backend/experiments/results/search_dynamic_summary.csv) — search metrics by algorithm and round.
- [`search_nodes_expanded.png`](../backend/experiments/results/search_nodes_expanded.png)
- [`search_success_rate.png`](../backend/experiments/results/search_success_rate.png)
- [`search_path_length.png`](../backend/experiments/results/search_path_length.png)
- [`difficulty_over_time.png`](../backend/experiments/results/difficulty_over_time.png)
- [`changes_needed.png`](../backend/experiments/results/changes_needed.png)
- [`player_clusters.png`](../backend/experiments/results/player_clusters.png)

## Reproduce

```bash
cd backend
python -m experiments.run_experiment
```

## Known limitations

- The benchmark uses simulated policies, not human players; accuracy, exploration and cooperation are modelled parameters.
- The maze generator repairs disconnections after each shift, so solvability violations are expected to remain zero.
- CSP solving is evaluated through generated puzzle tests and live room integration; the benchmark does not simulate turn-by-turn multiplayer negotiation.
- KMeans labels are assigned by nearest fixed style prototype, with deterministic initial centres and `random_state=0`.
