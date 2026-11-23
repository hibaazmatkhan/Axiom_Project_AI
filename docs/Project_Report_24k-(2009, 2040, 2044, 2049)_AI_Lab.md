# AXIOM: THE LAST ROOM

**FAST — National University of Computer and Emerging Sciences**  
FAST School of Computing, Karachi Campus · Department of Artificial Intelligence & Data Science  
**AL-2002 — Artificial Intelligence (Laboratory)** · Fall 2026  
Semester Lab Project · Weightage: 2 marks  
**Submission date:** October 23, 2026


## Project Information

| Field | Details |
|---|---|
| Course | AL-2002 — Artificial Intelligence (Laboratory) |
| Programme / Semester | BS Cyber Security · 5th Semester |
| Session | Fall 2026 |
| Project idea | Own idea |
| Category | Part A — Game |
| Repository | [Axiom_Project_AI](https://github.com/hibaazmatkhan/Axiom_Project_AI.git) |

### Team

| Role | Student | Roll Number | Section |
|---|---|---|
| Leader | Hiba Khan | 24K-2049 | BCY-5A |
| Member 2 | Misha Ahmed Pasha | 24K-2009 | BCY-5A |
| Member 3 | Zumair Shamsi | 24K-2040 | BCY-5A |
| Member 4 | Huzaifa Zafar | 24K-2044 | BCY-5A |

## Declaration and Contribution Statement

We declare that the work presented in this report is our own, that all external sources—including code, datasets, libraries, tutorials and AI assistance—have been acknowledged, and that each of us can explain the portion of the work attributed to us.


| Member | Roll Number | Principal contribution | Share |
|---|---|---:|
| Hiba Khan | 24K-2049 | Player model, event logging, report and documentation | 25% |
| Misha Ahmed Pasha | 24K-2009 | 3D client, simulated players, experiments and charts | 25% |
| Zumair Shamsi | 24K-2040 | Game server, asymmetric information, CSP puzzles and persistence | 25% |
| Huzaifa Zafar | 24K-2044 | Pattern engine, A*/BFS checks and NEXUS director | 25% |

*Contribution shares are based on the repository commit history and detailed contributions in Chapter 8. Marks are awarded individually.*

## 1. Introduction

### 1.1 Overview

AXIOM: THE LAST ROOM is a browser-based, server-authoritative 3D escape-room game for four cooperating players. Its arena is a 5×5 matrix of white cube rooms labelled A1–E5. Each room has four coloured doors, four d10 pedestals and hidden sanctions. Every round, the grid rearranges according to one of seven hidden transformation types.

An AI director called **The Dealer (NEXUS)** observes player events, builds a six-attribute model of each player and adapts difficulty through bounded utility-based actions. The AI goals are to keep the changing maze solvable and learnable while maintaining a suitable challenge for novice, average and expert teams.

Players explore in first person, predict the hidden rule, use four asymmetric roles, free locked teammates and guide every living player to a hidden edge exit. A* and BFS support solvability checks and evaluation; deterministic k-means groups player styles. The project is an unofficial *Alice in Borderland* fan game with locally generated visuals and audio, intended as a reproducible testbed for AI-lab topics such as search, knowledge representation, constraint solving and adaptive difficulty.

### 1.2 Objectives and Scope

| # | Objective | Status |
|---:|---|---|
| 1 | Implement a server-authoritative four-player 3D game with role-filtered views, validated intents, reconnect support and a hidden edge exit. | Achieved |
| 2 | Implement seven data-driven transformations and keep the exit reachable after each generated shift using A*/reachability checks. | Achieved |
| 3 | Implement NEXUS with a six-attribute player model, k-means clustering and utility-based actions; compare it with static and random directors over 900 seeded matches. | Achieved |
| 4 | Implement cooperative CSP and delay puzzles, prediction scoring and a reproducible evaluation suite with at least three charts. | Achieved |

**Out of scope:** reinforcement learning for NEXUS, built-in voice chat, VR, mobile-native clients, ranked matchmaking, community levels and professional rigged 3D character assets. The client uses procedural cube rooms, preset avatars and locally generated audio.

**Known limitations:** hosted monitoring dashboards, recorded four-player playtests, demo video/slides and deployed p95 evidence remain external. K-means labels are fixed prototypes, and NEXUS is evaluated with simulated rather than human players.

## 2. Problem Formulation

### 2.1 Problem Statement

A changing labyrinth creates a moving, partially observable search problem. The 5×5 room grid includes coloured doors, d10 seals, sanctions, role-private clues and seven possible transformations. Shifts change room positions while players ride their rooms, so the hidden exit must remain reachable.

Teams also vary in exploration, risk, cooperation, pattern and puzzle skill, and leadership. Fixed difficulty may bore stronger teams or frustrate weaker ones; random changes can be unfair. NEXUS cannot observe player beliefs directly, so it infers them from movement, failed doors, predictions, delays and cooperation events. For example, a novice team in C3 may have a Pathfinder revealing blocked walls, a Watcher holding the KING schedule, a Timekeeper with the delay key and a Decoder with the question. NEXUS adjusts complexity, hazards, dice relief and clues without breaking solvability.

### 2.2 PEAS and Environment

| Component | Description |
|---|---|
| Performance measure | Keep teams within the target challenge band using changes needed, wrong predictions, completion time, difficulty-fit error and stuck time. The exit must remain solvable after every shift. |
| Environment | Server-authoritative 5×5 grid of moving white cube rooms, coloured doors, d10 seals, sanctions, seven hidden transformations, hidden edge exit and four human or simulated players. |
| Actuators | NEXUS can raise/lower complexity, add hazards, give private clues, lower dice seals, shift information or hold. Search/repair acts on doors and room placement. |
| Sensors | Server event log: moves, sealed-door clicks, rooms explored, predictions/results, puzzle attempts, delays, cooperation events and time between actions. |

| Property | Classification | Reason |
|---|---|---|
| Observability | Partially observable | Hidden rules, d10 seals, exit location and role-divided clues are server-only or filtered by role. |
| Determinism | Stochastic | Seeds allow replay, but d10s, KING rooms, shifts and simulated actions vary within a seed. |
| Change over time | Dynamic | The arena shifts each round; NEXUS changes hazards, complexity and clues in response to events. |
| State and actions | Discrete | Rooms, directions, dice faces, roles and director actions are finite; pose updates are presentation-only. |
| Agents | Multi-agent / adversarial | Four players cooperate with asymmetric information while KING OF SPADES acts as a non-player hazard. |
| Agent type | Utility-based; model-based and learning-style modelling | NEXUS maintains player models and selects the highest-utility bounded action. |

### 2.3 Problem Representation

| Element | Representation in the code |
|---|---|
| State | Arena grid of Room objects with persistent room IDs, grid codes, door colours/open states, d10 seal state, sanction metadata, hidden pattern rule, stage, exit room, player points/locks/roles and six-attribute player vectors. |
| Player actions | `open_door`, `cross_door`, `wait`, `unlock`, `predict`, `puzzle_submit`, `delay_queue`, `delay_answer` and notes. |
| Director actions | `raise/lower_complexity`, `add_hazard`, `give_clue`, `lower_dice`, `shift_information` or `hold`. |
| Initial state | Seeded spanning-tree generation creates a solvable 5×5 arena. Players spawn in C3 with 25 points; an edge room is selected as the hidden exit; player models and director state begin neutral. |
| Goal / terminal test | Every living player reaches the hidden exit room. The game also ends when the 1,800-second timer expires or all players are eliminated. There is no round cap. |
| Evaluation | Search uses nodes expanded and path length. NEXUS uses weighted skill fit, progress, cooperation balance and frustration; evaluation tracks difficulty-fit error, stuck time, changes needed and solvability violations. |

## 3. System Design and Architecture

### 3.1 Overall Architecture

The browser client sends intents over WebSocket and receives role-filtered state. FastAPI manages rooms, timers, validation, points, locks and eliminations. Each round applies a hidden pattern, rolls d10 seals, checks reachability, requests one bounded action from the injected Director, applies it and broadcasts role-specific views.

The Dealer consumes the event log, updates six-attribute player vectors, clusters players and scores candidate actions by utility. StaticDirector and RandomDirector are baselines. Seeded simulated players run 900-match experiments through the same Director interface; the runner writes CSV summaries and matplotlib PNG charts. Supabase stores profiles, ranked matches, avatars and Dealer models, with SQLite as the local fallback. Guests and unverified accounts can play, but ranked data persists only for verified accounts.

**Figure 3.1 — System architecture:** Next.js frontend → FastAPI backend → game engine and NEXUS AI → Supabase persistence and Redis coordination. Firebase separately handles identity and authentication.

**Figure 3.2 — Class diagram:** Arena, Game.Room and the Director interface connect to NEXUS and Static/Random baseline directors.

### 3.2 Class Design

| Class | Responsibility | Inheritance / composition | Key methods |
|---|---|---|---|
| `Arena` | 5×5 rooms, doors, generation, shifts and reachability | Object / composed Rooms | `generate()`, `apply_shift()`, `door_open()`, `path()`, `solvable()`, `ensure_connected()`, `to_public()` |
| `Director` | Common director contract for fair baselines | ABC | `choose_action()`, `ingest()`, `decide()`, `commit_action()`, `team_report()` |
| `Nexus` | Six-attribute model, KMeans clustering and utility decisions | Mixed into `NexusDirector` | `ingest()`, `extract()`, `cluster()`, `utility_terms()`, `decide()`, `commit_action()` |
| `Game.Room` | Authoritative match loop, points, locks, puzzles, KING and reconnect | Owns Arena and Player objects | `step_round()`, `snapshot()`, `unlock()`, `predict()`, `_apply_director()`, `_check_endings()` |


#### Object-Oriented Principles

| Principle | Demonstration |
|---|---|
| Encapsulation | `Game.Room.snapshot()` and `Arena.Room.public()` hide the exit, dice values, hidden rule and other roles’ private data; clients receive filtered views. |
| Inheritance | `StaticDirector`, `RandomDirector` and `NexusDirector` inherit the `Director` ABC; `NexusDirector(Nexus, Director)` combines the model and interface. |
| Method overriding | `StaticDirector.decide()`, `RandomDirector.decide()` and `Nexus.decide()` implement the director decision contract. |
| Polymorphism | `Game.Room._apply_director()` accepts any Director instance, so NEXUS, Static and Random use the same round loop and experiment interface. |

## 4. AI Techniques and Implementation

### 4.1 Module Overview

| File | Responsibility | Author(s) |
|---|---|---|
| `backend/app/main.py` | FastAPI HTTP API, WebSocket endpoint and route prefix handling | Zumair |
| `backend/app/game.py` | Rooms, round loop, points, locks, revives, KING, reconnect and role-filtered snapshots | Zumair |
| `backend/app/arena.py` | 5×5 room matrix, doors, seeded generation, shifts, A*/BFS and reachability | Huzaifa |
| `backend/app/patterns.py` | Seven data-driven transformations and hidden rule engine | Huzaifa |
| `backend/app/knowledge.py` | Knowledge base, facts, observations and role-mark CSP support | Zumair |
| `backend/app/puzzles.py` | Seeded delay puzzles, answer checks and public/key views | Zumair |
| `backend/app/roles.py` | Pathfinder/Watcher/Timekeeper/Decoder private-information filtering | Hiba |
| `backend/app/nexus.py` | Six-attribute player model, k-means clustering and utility decision core | Hiba / Huzaifa |
| `backend/app/directors.py` | Director interface with NEXUS, Static and Random implementations | Huzaifa |
| `backend/app/simulation.py` | Novice/average/expert policies, 900-match runner and search benchmark | Misha |
| `backend/app/experiment_charts.py` | CSV-driven generation of retained PNG charts | Misha |
| `backend/app/fate.py` | d10 seals, possible futures and sanction rooms | Misha |
| `backend/app/stages.py` | Seven-stage progression and per-stage rules | Huzaifa |
| `backend/app/auth.py` | Firebase ID token, App Check and admin guards | Hiba |
| `backend/app/supabase_store.py` | Profiles, avatars, match history, statistics and account operations | Hiba |
| `backend/app/shared_rooms.py` | Redis reservations, ownership, status and WebSocket routing | Hiba / Huzaifa |
| `backend/app/avatar_store.py` | Avatar validation, storage upload and cleanup | Zumair / Hiba |
| `frontend/components/GameCanvas.tsx` | Three.js first-person arena, doors, avatars, transitions and effects | Misha |
| `frontend/components/GameClient.tsx` | HUD, role intel, puzzles, predictions, notes, alerts and team status | Misha |
| `frontend/components/WristbandMap.tsx` | 5×5 wristband map with private wall and sanction state | Hiba |
| `frontend/lib/useGameSocket.ts` | WebSocket state machine and game event wiring | Huzaifa |
| `frontend/lib/types.ts` | Shared message and entity types | Misha |
| `frontend/lib/api.ts` | HTTP client for account, profile, history and admin APIs | Zumair |
| `frontend/tests/contract.test.mjs` | Frontend contract tests for UI, socket config and deployment contracts | Misha |

### 4.2 Technique Details

#### Technique 1 — A* Pathfinding and Reachability

A* pathfinding with time-expanded reachability is used, with BFS as the comparison baseline.

- **Implementation:** `backend/app/arena.py` (`path()`, `solvable()`, `ensure_connected()`) and the search benchmark in `simulation.py`.
- **Heuristic:** Manhattan distance on the 5×5 grid.
- **Evaluation:** nodes expanded, path length, runtime and success rate.
- **Setup:** 100 seeds (0–99), four shifting rounds per seed; both algorithms use identical solvable instances.
- **Complexity:** A* uses a priority queue and parent/frontier maps; BFS is O(V+E). With V=25, A* expands roughly half as many nodes in the retained results.

#### Technique 2 — Utility-Based Director with Clustering

NEXUS is evaluated against StaticDirector and RandomDirector.

- **Implementation:** custom logic in `backend/app/nexus.py` and `directors.py`; scikit-learn KMeans clusters six-attribute player vectors.
- **Utility:** weighted skill fit, progress, cooperation balance and frustration. Metrics include difficulty-fit error, changes needed, completion time, stuck time and solvability violations.
- **Setup:** three directors × three team levels × 100 seeds = 900 matches; 15 cycles per match; nominal 8-second cycle; seven bounded actions; KMeans `random_state=0`.
- **Complexity:** scoring is linear in players and candidate actions. KMeans is small and offline; experiment results are generated as a seeded batch of CSV/PNG artifacts.

### 4.3 Key Implementation Details

`Nexus.utility_terms()` evaluates candidate actions using current and next difficulty error, cooperation balance and frustration. `Nexus.decide()` adds solvability and complexity-bound penalties before selecting the highest-scoring action. This makes the decision process auditable and keeps NEXUS, StaticDirector and RandomDirector behind a shared interface.

```python
def utility_terms(self, action: str) -> dict:
    delta = ACTION_DIFFICULTY_DELTA.get(action, 0.0)
    current_error = self.difficulty_error_at(self.difficulty)
    next_difficulty = max(-1.0, min(1.0, self.difficulty + delta))
    next_error = self.difficulty_error_at(next_difficulty)
    skill_fit = (current_error - next_error) / TARGET_BAND_HALF_WIDTH
    if action == "hold" and current_error == 0.0:
        skill_fit += 0.5
    balance = self.cooperation_balance()
    frustration = self.frustration()
    if action in ("give_clue", "shift_information", "hold"):
        cooperation = 0.2 + (1.0 - balance) * 0.6
    else:
        cooperation = 0.2 + balance * 0.6
```

## 5. Data and Experimental Setup

### 5.1 Data Source

| Item | Details |
|---|---|
| Environment | AXIOM-generated arena and simulated player events |
| Dataset | No public dataset. Repository: [Axiom_Project_AI](https://github.com/hibaazmatkhan/Axiom_Project_AI.git). Retained results: `backend/experiments/results/` and `docs/NEXUS_Evaluation.md`. |
| Source type | Web API (as marked in the report); experiment environment and data are generated locally. |
| Size | 25 rooms per match; 900 simulated matches. Retained files: 754 MB (791,023,616 bytes). |
| Fields | Arena seed, room/door/sanction state, event kind, player ID, timestamp, six player attributes, director action fields, search nodes, path length, runtime, success, changes needed, completion time and fit error. |
| Licence | Group-generated code and data. Libraries are open source; visuals/audio are locally generated or user-supplied assets. |
| Preprocessing | Seeds are replayable; raw experiment rows retained and summary CSVs aggregate means and standard deviations. No personal or public records require cleaning. |
| Offline availability | Generators, seeds, CSVs and PNGs are committed under `backend/experiments/results/`. Runtime uses local fonts/assets and does not call a data API or CDN. |

All experimental data was generated using seeded code in `backend/app/arena.py`, `backend/app/simulation.py` and `backend/app/experiments/run_experiment.py`. The team generated player-model and director evaluation artifacts in October 2026. Each condition uses seeds 0–99 and identical timelines for each director. No external permission was required. CSV and PNG results are retained in `backend/experiments/results/` for offline reproduction.

### 5.2 Experimental Setup

| Item | Details |
|---|---|
| Comparisons | A* vs. BFS for path queries; NexusDirector vs. StaticDirector vs. RandomDirector for novice, average and expert simulated teams. |
| Metrics | Search: nodes expanded, path length, runtime and success rate. Directors: changes needed, completion time, difficulty-fit error, stuck time and solvability violations. |
| Baselines | BFS for search; StaticDirector and RandomDirector for NEXUS. |
| Test set | 100 seeds (0–99) and four shifting rounds for search; 100 matches per director/team level (900 matches total). |
| Runs | 100 runs per condition using seeds 0–99; 15 cycles per match; seeded NumPy/Python streams and KMeans `random_state=0`. Results are reported as means in the summary CSV. |
| Software | Python 3.12+ and Node 20+. CI uses Python 3.12 on GitHub Actions. Charts use matplotlib; clustering uses scikit-learn. |

## 6. Results and Analysis

### 6.1 Program Output

Figure 6.1 in the source report shows the game in use, including the end-of-match screen confirming that all living players reached the exit. The report also includes screenshots of the landing page, team assembly and gameplay; these were omitted here to avoid the original OCR/image clutter.

### 6.2 Comparison of Approaches

The original summary reports ranges across the tested conditions. They are retained here in compact form; the detailed experiment CSVs remain the authoritative source for exact values.

| Configuration | Search / fit metric | Changes needed (novice / average / expert) | Mean path / completion time (novice / average / expert) | Notes |
|---|---|---|---|
| BFS + StaticDirector | BFS: 15.72–15.99 nodes; static fit: 0.0614–0.3771 | 10.04 / 5.55 / 4.19 | Path: 4.46–5.46; time: 80.32 / 44.40 / 33.52 s | BFS is optimal but expands more nodes; static difficulty drifts by team level. |
| A* + StaticDirector | A*: 8.09–9.86 nodes; static fit: 0.0614–0.3771 | 10.04 / 5.55 / 4.19 | Path: 4.46–5.46; time: 80.32 / 44.40 / 33.52 s | A* roughly halves search work without changing path quality. |
| A* + RandomDirector | A*: 8.09–9.86 nodes; random fit: 0.5761–0.8190 | 9.19 / 5.39 / 4.14 | Path: 4.46–5.46; time: 73.52 / 43.12 / 33.12 s | Random finishes faster but has substantially worse difficulty fit. |
| A* + NEXUS | A*: 8.09–9.86 nodes; NEXUS fit: 0.0004–0.0030 | 10.19 / 5.83 / 4.35 | Path: 4.46–5.46; time: 81.52 / 46.64 / 34.80 s | Best difficulty fit across teams; small speed trade-off and zero solvability violations. |

### 6.3 Visualisations

- **Figure 6.2 — Nodes expanded: A* vs. BFS.** On the same 100 seeds and four shifting rounds, A* consistently expands about half as many nodes as BFS, without changing optimal path length.
- **Figure 6.3 — Difficulty over time.** Across 15 cycles, NEXUS stays close to the target band while Static and Random drift.
- **Figure 6.4 — Changes needed to discover the rule.** Random often reaches four consecutive correct predictions earlier, but has much larger difficulty-fit error; faster discovery does not necessarily mean fairer learning.
- **Figure 6.5 — NEXUS player clusters.** Deterministic k-means groups six-attribute player vectors into behaviour styles, supporting team-specific clue, hazard and complexity decisions.

### 6.4 Discussion

No approach wins every metric. A* is the best search method for the fairness constraint: it expands about 8.09–9.86 nodes per round compared with BFS at 15.72–15.99, with the same mean path length (4.46–5.46) and a 1.0 success rate on repaired mazes. It preserves solution quality while reducing search work.

NEXUS is the strongest fit-focused director, with difficulty-fit error of 0.0004–0.0030 across novice, average and expert teams, compared with 0.0614–0.8190 for the baselines. Random runs faster for novices (73.52 s vs. 81.52 s) because it does not spend actions fitting difficulty. These results are consistent across 100 seeds per condition, but the policies are simulated; human playtests are needed before claiming general superiority. Zero solvability violations and 100% search success support the hard constraint in this benchmark.

## 7. Testing, Limitations and Ethics

### 7.1 Test Cases

| # | Test case | Expected | Actual / evidence |
|---:|---|---|---|
| 1 | Normal input: four roles join, open/cross doors, predict, solve puzzles and reach the exit | Authoritative state updates; role views stay private; team can win | Backend 228 tests and frontend 28 contract tests pass; smoke scripts cover HTTP, transitions and full-match persistence. |
| 2 | Data or cache file missing | No public dataset or required cache; SQLite fallback works and generated CSVs are committed | Tests use temporary/local stores; no runtime dataset fetch; retained experiment artifacts are present. |
| 3 | Invalid user input | Reject invalid username/token, rate-limited door intent, unknown puzzle tier or bad avatar with a clear code/message | Auth, `ValueError` and `AvatarInvalid` handlers return `auth_*`, error or HTTP 400 messages; gameplay intents are server-validated. |
| 4 | Instance with no solution | Generator repairs connectivity and A* confirms the exit is reachable after each shift | Search benchmark reports 1.0 success on all four rounds and zero post-action solvability violations. |
| 5 | Search or match reaches its time limit | Shift timing stays within 18–45 s; 30-minute timer ends the match and broadcasts `time_up`/`game_over` | Delay caps and stage bounds are tested; full-match smoke reaches `game_over` and persists a summary. |
| 6 | Sprint 3 lockdown regression | Lockdown affects only the actor; locked/exit rooms do not shift; two helpers can scan; locked player may self-cross a live door | Backend/frontend regression tests pass; exit renders as a black doorway and lock tint is actor-only. |

### 7.2 Exception Handling

| Exception | Where handled | User-facing behavior |
|---|---|---|
| `FileNotFoundError` | Generated artifacts are committed; configuration falls back to local defaults. | No gameplay interruption. If a CSV is missing during chart generation, the script stops with a clear Python traceback. |
| `ValueError` | `main.py` route handlers and validators in `puzzles.py`, `directors.py`, `simulation.py` and shared room registry. | HTTP 400 or WebSocket error with a specific message, such as unknown puzzle tier/director or missing `client_key`. |
| `AuthTokenError` / `AppCheckTokenError` | `auth.py` verification helpers, WebSocket first-frame auth and `main.py` dependency guards. | Fatal `auth_invalid`, `auth_expired`, `auth_revoked` or App Check error; user is asked to sign in again. |
| `GameAlreadyStarted` / `AvatarInvalid` | Game room ready/start path in `game.py`; avatar upload validation in `avatar_store.py`. | Room start is safely ignored; invalid avatar uploads return a readable size, format or moderation message. |

### 7.3 Limitations and Ethical Considerations

NEXUS is evaluated using synthetic event streams, so its utility weights and fixed k-means prototypes may misread human teams or unusual strategies. Incorrect adaptation may make the arena too easy or frustrating. Missing service configuration can disable ranked persistence.

No public personal dataset is used. Gameplay telemetry is generated locally; Firebase/Supabase store consented account data for verified users, while guests do not write ranked records. Bias may occur if prototypes under-represent a group or clues are allocated unevenly; private role information and clue cooldowns are bounded and audited. Poor director decisions can waste points or eliminate a player. Users should understand that NEXUS is heuristic and the benchmark is simulated evidence, not proof of perfect adaptation.

## 8. Individual Contributions and Conclusion

### 8.1 Contributions

| Member | Modules / files owned | Specific work | Commits | Share |
|---|---|---|---:|
| Hiba Khan (24K-2049) | Event log; NEXUS player model; docs/report; deployment | Six-attribute model, k-means grouping, report/documentation, Vercel/env work and final Sprint 3 lockdown/exit fixes | 18 | 25% |
| Misha Ahmed Pasha (24K-2009) | Three.js client, HUD, simulated players, experiments/charts | First-person room, doors/avatars/audio, role views, novice/average/expert policies and CSV/PNG pipeline | 6 | 25% |
| Zumair Shamsi (24K-2040) | FastAPI server, auth/persistence, CSP/delay puzzles | Authoritative rooms, per-role filtering, Firebase/App Check, Supabase profiles/history and cooperative puzzles | 4 | 25% |
| Huzaifa Zafar (24K-2044) | Pattern engine, A*/BFS, NEXUS/Static/Random directors | Seven transformations, solvability checks, utility director, Redis shared rooms and CI/deployment hardening | 12 | 25% |

### 8.2 Challenges Faced

1. **Keeping a moving maze fair:** the 5×5 grid changes every round, and the hidden exit must stay reachable. Seeded generation, seven data-driven transformations, a repair pass and A*/time-expanded reachability checks run before broadcasting each round. Sprint 3 also protected the exit room and locked player's room from shifts.
2. **Adapting difficulty without unfair randomness:** noisy telemetry and differing team needs are addressed by extracting six player attributes, clustering with deterministic KMeans and scoring seven bounded director actions with explicit utility terms. The team compared NEXUS against static and random directors over 900 seeded matches.
3. **Serverless room ownership:** Redis-backed reservations and socket routing were added and tested.

### 8.3 Conclusion and Future Work

AXIOM met its proposal objectives. The repository contains a playable four-player server-authoritative 3D game, a seven-type hidden pattern engine with A* solvability checks, four asymmetric roles with private clues, cooperative CSP and delay puzzles, and a NEXUS director using six-attribute modelling, KMeans clustering and utility-based adaptation. The 900-match benchmark shows near-zero difficulty-fit error for NEXUS, while A* halves BFS search effort on identical mazes. Backend and frontend regression suites pass.

Future work includes real four-player playtests to validate simulated findings, replacing the Figure 6.1 placeholder with recorded gameplay, evaluating learned or human-calibrated utility weights with privacy-preserving telemetry, finishing rigged character models and adding hosted monitoring dashboards.

## Appendix A — Setup and Execution

Follow the repository `README.md` from a clean clone.


### Environment and configuration

- Python 3.12+ and Node 20+; CI uses Python 3.12 and Node 20.
- Copy the example environment files and configure Firebase web settings in `frontend/.env.local` and Firebase Admin/Supabase credentials in `backend/.env`. Never commit service-role keys or private keys.
- Set `AXIOM_MATCH_STORE=sqlite` locally; use Supabase in production. Configure `REDIS_URL` for shared rooms across multiple backend instances.
- Run Supabase migrations: `backend/migrations/001_profiles.sql`, `002_matches.sql`, and `003_phase4_avatar.sql`. If `SUPABASE_DB_URL` is set, run `python scripts/apply_migrations.py` from `backend/` instead.

### Run locally

```bash
# Copy environment templates
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

# Start the backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# In a second terminal, start the frontend
cd ../frontend
npm install
npm run dev
```

Open http://localhost:3000, sign in or continue as a guest, and open a room in up to four browser tabs.

### Tests and experiments

```bash
# Backend tests
cd backend
python -m pytest -q

# Frontend tests (run from frontend directory)
cd ../frontend
npm test
npm run build

# Reproduce Chapter 6 (from backend directory)
cd ../backend
python -m experiments.run_experiment
```

The full experiment runs 900 matches and writes CSV/PNG artifacts to `backend/experiments/results/`. Chart generation requires matplotlib.

### Docker

```bash
cp .env.example .env
docker compose up --build
```

Frontend: http://localhost:3000  
Backend: http://localhost:8000

### Live-server smoke tests

These scripts require a running backend and should be run from `backend/`:

```bash
python tests/integration_smoke.py
python tests/transition_smoke.py
python tests/match_smoke.py
```

---

*End of Project Report*
