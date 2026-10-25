**FAST — NATIONAL UNIVERSITY OF COMPUTER AND EMERGING SCIENCES**

FAST School of Computing · Karachi Campus · Department of Artificial Intelligence & Data Science  
*AL-2002 Artificial Intelligence (Laboratory) · Fall 2026*

**PROJECT PROPOSAL**

*Semester Lab Project · Weightage 1 mark*

## Group Information

|            | **Name**          | **Roll Number** | **Section**   | **Role in the project**             |
|------------|-------------------|-----------------|---------------|-------------------------------------|
| **Leader** | Hiba Khan         | 24K-2049        | BCY-5A | Player model, event logging, report |
| Member 2   | Misha Ahmed Pasha | 24K-2009        | BCY-5A | 3D client, simulated players        |
| Member 3   | Zumair Shamsi     | 24K-2040        | BCY-5A | Game server, CSP puzzles            |
| Member 4   | Huzaifa Zafar     | 24K-2044        | BCY-5A | Pattern engine, NEXUS director      |

|                           |                                                                                 |
|---------------------------|---------------------------------------------------------------------------------|
| **Project Title**         | AXIOM: AI-Driven Multiplayer Dynamic Labyrinth                                  |
| **Project Idea**          | Idea No. \_\_\_\_\_\_ from the Project Ideas list ☐ Own idea (needs approval) ☒ |
| **Category**              | Part A — Game ☒ Part B — Applied / Data ☐                                       |
| **GitHub Repository URL** | https://github.com/hibaazmatkhan/Axiom_Project_AI.git                                                                   |
| **Date of Submission**    | October 22nd' 2026                                                                  |

# 1. Project Title and Summary

> **AXIOM: AI-Driven Multiplayer Dynamic Labyrinth**
>
> AXIOM is a browser-based 3D puzzle game for four players who explore a labyrinth together. The maze keeps rearranging itself, but never randomly: its blocks rotate, mirror and shift according to hidden rules, and the team must watch the changes, work out the rule and predict the next one in order to reach the exit. Each player is given a different piece of the clues, so the team has to talk and combine what they know. An AI director called NEXUS watches how each player behaves, builds a model of the team, and decides when to make the patterns harder or hand out a subtle clue. A plain program could only use a fixed difficulty or random changes; NEXUS adapts the game to the actual team, and a solver guarantees that the maze can always be completed.

# 2. Problem Statement and Motivation

> A labyrinth that changes during play is a search problem that grows with every change. Our maze has nine blocks that each face one of four orientations, so there are 4^9 = 262,144 possible layouts, and the maze must stay completable for the team after every change. Checking this by hand or by trial and error does not scale, so the game needs search and constraint checking. A second problem is difficulty. Teams differ widely: a fixed difficulty bores strong teams and loses weak ones, and a random one is unfair. Designers cope today with hand-tuned levels or random generation, and neither responds to what a particular team is doing. The information is also uncertain, because the director cannot see what players believe about the hidden rule and can only infer it from their moves and predictions. Solving this matters because it shows how AI can build environments that are fair, learnable and adapted to the people playing them.

# 3. Problem Formulation

## 3.1 PEAS Description

| **Component**           | **Description for your project**                                                                                                                                                                                                                                                              |
|-------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Performance measure** | Keep each team inside a target challenge band: the number of changes needed to discover the rule, the rate of wrong predictions and the time spent stuck stay close to target values. Hard constraint: the maze must stay solvable after every change. Scored by the utility function in 3.3. |
| **Environment**         | A 3D labyrinth of 3×3 rotating blocks governed by a hidden rule, with four players (human or simulated) who move, predict and share information. The server holds the true state.                                                                                                             |
| **Actuators**           | NEXUS can raise or lower pattern complexity, change the transition timer, give clues, and swap which player receives which piece of information. A\* verifies the maze after each change.                                                                                                     |
| **Sensors**             | The server event log: moves, bumps into walls, tiles explored, predictions and their results, puzzle attempts, time between actions, and how often players follow each other.                                                                                                                 |

## 3.2 Environment and Agent Type

| **Property**      | **Classification — tick one**                                                                              |
|-------------------|------------------------------------------------------------------------------------------------------------|
| Observability     | Fully observable ☐ Partially observable ☒                                                                  |
| Determinism       | Deterministic ☐ Stochastic ☒                                                                               |
| Change over time  | Static ☐ Dynamic ☒                                                                                         |
| State and actions | Discrete ☒ Continuous ☐                                                                                    |
| Agents            | Single-agent ☐ Multi-agent / adversarial ☒                                                                 |
| Agent type        | Simple reflex ☐ Model-based ☐ Goal-based ☐ Utility-based ☒ Learning ☐ (NEXUS keeps a learned player model) |

## 3.3 Problem Representation

| **Element**                              | **Your representation**                                                                                                                                                                                                                               |
|------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **State representation**                 | Maze: 3×3 grid of 5×5-tile blocks, each with openings (N, E, S, W) and a symbol (triangle, circle, square); change counter; hidden rule (server only); per player: position, information role, score; NEXUS player model (six attributes per player). |
| **Actions / moves**                      | Players: move up, down, left or right; submit a prediction. NEXUS: raise or lower complexity, keep, give a clue, swap information roles, lengthen or shorten the timer.                                                                               |
| **Initial state**                        | Seeded random spanning-tree maze (always solvable), all players on the start tile, a rule schedule generated from the same seed, neutral player models.                                                                                               |
| **Goal or terminal test**                | Team goal: all players reach the exit beacon. After each change, A\* confirms the exit is reachable now or within the next few changes.                                                                                                               |
| **Cost, utility, fitness or evaluation** | Search cost: path length in steps. NEXUS utility U(a) = w1·skill fit + w2·progress + w3·cooperation balance − w4·frustration (long stuck time, repeated wrong predictions); NEXUS picks the action with the highest U(a) at each change.              |

# 4. Proposed AI Approach

| **\#** | **Technique**                                              | **Role in the project**                                                                       | **Own code or library**             |
|--------|------------------------------------------------------------|-----------------------------------------------------------------------------------------------|-------------------------------------|
| 1      | A\* search (compared with BFS)                             | Pathfinding for simulated players and solvability checks on the changing maze                 | Own code                            |
| 2      | Procedural generation and constraint satisfaction          | Seeded maze generation; cooperative puzzle generator (backtracking CSP with forward checking) | Own code                            |
| 3      | Utility-based NEXUS director with k-means player model     | Scores director actions; groups players into behaviour types                                  | Own code; k-means from scikit-learn |
| 4      | Knowledge representation (rule engine)                     | Hidden rules stored as data, seven transformation types                                       | Own code                            |
| B      | Baseline: BFS; static-difficulty director; random director | Reference points for the comparisons in Section 7                                             | Own code                            |

> The maze is a discrete, partially observable, multi-agent environment, so we need a way to check that it can be completed, a way to generate fair content, and a way to adapt to the team. A\* answers the first, because the Manhattan-distance heuristic is admissible on a tile grid, and BFS gives a fair comparison. Seeded generation and constraint satisfaction give reproducible mazes and puzzles with guaranteed solutions. NEXUS is utility-based because it must trade off competing aims (challenge, progress, cooperation, frustration) instead of reaching a single goal state. Its utility function scores each action using the player model: six attributes per player (exploration, risk, cooperation, pattern skill, puzzle skill, leadership) computed from the event log and grouped with k-means. The baselines are a static director and a random director.

## 4.1 Planned Class Design

> Maze: blocks[3][3], tiles(), is_open(), apply_transition(rule, cycle), to_public(); contains Block (openings, symbol, rotate_cw()).
>
> Rule (abstract): apply(maze, cycle); subclasses RotationRule, ReflectionRule, TranslationRule, SymbolRule, SequentialRule, ConditionalRule, CompoundRule.
>
> Pathfinder (abstract): find(maze, start, goal) returns path and nodes_expanded; subclasses BFSPathfinder, AStarPathfinder.
>
> PuzzleGenerator: variables (one clue per role), constraints, solve() by backtracking with forward checking.
>
> Room and Player (server): move(), predict(), snapshot(for_player), EventLog.
>
> PlayerModel: six attributes, update(events), cluster() with k-means returns a behaviour type.
>
> Director (abstract): choose_action(team_state); subclasses StaticDirector, RandomDirector, NexusDirector (utility scoring).
>
> SimulatedPlayer (novice, average, expert policies) and Experiment (runs seeded matches, writes CSV results).

# 5. Scope

**In scope — the features you commit to delivering.** List the features that must work for the project to be considered complete.

| **\#** | **Feature**                                                                                  | **Why it is essential**                                    |
|--------|----------------------------------------------------------------------------------------------|------------------------------------------------------------|
| 1      | Four-player, server-authoritative game: rooms, validated moves, 3D browser client            | Core multiplayer; every other feature depends on it        |
| 2      | Pattern engine: hidden rules as data, seven transformation types, A\* solvability check      | Creates the learnable, changing maze and keeps it fair     |
| 3      | Asymmetric information and one cooperative CSP puzzle that needs all four roles              | Forces communication and makes four players necessary      |
| 4      | NEXUS: event logging, six-attribute player model, k-means grouping, utility-based adaptation | The main AI contribution                                   |
| 5      | Simulated players and experiments: NEXUS vs static and random directors, A\* vs BFS          | Evidence that the AI works; needed for the report          |
| 6      | Prediction mechanic with scoring, and an in-game HUD with team notes                         | The gameplay loop that produces the data NEXUS learns from |

**Out of scope — deliberately excluded.** We will not build the following, so that the AI core and its evaluation can be finished in the remaining weeks.

> User accounts, login, profiles and a match-history database; public hosting and deployment; sound and professional 3D models (we use simple procedural shapes); reinforcement learning for NEXUS; competitive or ranked modes, leaderboards, VR, mobile clients and community-made levels; built-in voice chat.

# 6. Data or Environment Source

|                            |                                                                                                                                                                                                                                |
|----------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Source name and URL**    | None. The data is generated by our own seeded maze generator and simulated players (see the GitHub repository).                                                                                                                |
| **Type**                   | Public dataset ☐ Web API ☐ Self-collected ☐ Generated / simulated ☒                                                                                                                                                            |
| **Access requirements**    | No key needed ☒ Free key required ☐ (Paid sources are not permitted)                                                                                                                                                           |
| **Approximate size**       | No stored dataset. A match logs about 1,000–5,000 events (a few hundred KB). The experiments produce about 900 simulated matches (3 directors × 3 team levels × 100 seeds).                                                    |
| **Licence / terms of use** | Our own code and generated data. Libraries are open source. Any free 3D models or sounds we add will be CC0.                                                                                                                   |
| **Offline fallback**       | After a one-time install, the server and client run on localhost with no internet. Libraries and assets are bundled locally (no CDN or API calls), and every experiment stores its seeds so results can be reproduced offline. |

> ***Required:*** your program must still run when the network is unavailable, by reading a locally cached copy of any data it downloads. Describe your caching plan in the last row above.

# 7. Evaluation Plan

|  |  |
|---|---|
| **What will be compared** | (a) A* vs BFS for path queries on the changing maze. (b) NexusDirector vs StaticDirector vs RandomDirector, each with novice, average and expert simulated teams. |
| **Metric(s)** | Search: nodes expanded, path cost, run time (ms). Director: changes needed until the team predicts the rule correctly 4 times in a row, match completion time, difficulty-fit error (distance from the target challenge band), stuck time, and solvability violations (must be 0). |
| **Baseline** | BFS for search. Static-difficulty director (no adaptation) and random director for NEXUS. |
| **Test instances / test set** | 100 seeded mazes (seeds 0–99) for search; 100 simulated matches per director and team level (900 in total). Three playtest sessions with four real players as a qualitative check. |
| **Number of runs and seed** | 100 runs per condition, identical seeds 0–99 for every approach, fixed seed for simulated-player behaviour. Results reported as mean ± standard deviation. |
| **Planned charts (at least three)** | 1. Bar chart: nodes expanded, A* vs BFS.<br>2. Line chart: difficulty level over time for each director and team level.<br>3. Box plot: changes needed to discover the rule, by director.<br>4. Scatter plot: k-means player clusters. |

# 8. Division of Work

| **Member**             | **Modules / components owned**                                                                                                     | **Approximate share** |
|------------------------|------------------------------------------------------------------------------------------------------------------------------------|-----------------------|
| **Hiba Khan (Leader)** | Event logging; NEXUS player model (six attributes) and k-means behaviour grouping; repository, documentation and final report      | 25%                   |
| **Misha Ahmed Pasha**  | Three.js 3D client and HUD (per-role views, animations); simulated players (novice, average, expert); experiment runner and charts | 25%                   |
| **Zumair Shamsi**      | FastAPI WebSocket server (rooms, authoritative state, validation); asymmetric information; cooperative CSP puzzle generator        | 25%                   |
| **Huzaifa Zafar**      | Pattern and rule engine (seven types); A\* and BFS solvability checks; NexusDirector with static and random baselines              | 25%                   |

> **Group of four.** We ask the instructor to approve a group of four: the project has four separable AI modules that each need their own design and evaluation (search and generation, constraint-based puzzles, player modelling, utility-based adaptation), and a four-player game needs four people to playtest.

# 9. Milestones and Timeline

| **\#** | **Milestone — what will be demonstrably working**                                                                                                    | **Target date** | **Owner**              |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------|------------------------|
| 1      | Prototype baseline (done): four players share a maze whose blocks rotate by a hidden rule; A\* check, prediction scoring and 19 automated tests pass | Complete        | All                    |
| 2      | Seven pattern types and the rule engine pass unit tests; A\* and BFS run on 100 seeded mazes; per-role information views work in the 3D client       | Week 11         | Huzaifa, Zumair, Misha |
| 3      | CSP puzzle generator solves 1,000 seeds; the event log feeds the six-attribute player model; simulated players of three skill levels finish matches  | Week 12         | Zumair, Hiba, Misha    |
| 4      | NexusDirector, StaticDirector and RandomDirector run 900 simulated matches and write results to CSV; k-means groups the simulated players            | Week 13         | Huzaifa, Hiba          |
| 5      | Four charts generated from the CSV results; three playtests recorded; report draft complete                                                          | Week 14         | Misha, Hiba            |
| 6      | Experiments complete, final integration, documentation and repository cleanup                                                                        | Week 15         | All                    |

# 10. Expected Outcome and Risks

> Running the project opens a browser game: up to four players (or one player with test bots) enter the labyrinth, watch blocks rotate, predict the next change and solve a puzzle that needs all four roles. We expect A\* to expand fewer nodes than BFS on the same mazes, and NEXUS to keep novice and expert teams closer to the target challenge band than the static or random directors, with zero unsolvable states. Risk 1: NEXUS shows no clear gain over the baselines. We would then report that honestly and test simpler adaptation rules and different weights. Risk 2: 3D or multiplayer work slows the AI work. We would keep the simple top-down view and test with simulated players.

| **For office use — Lab Instructor** |                                                        |
|-------------------------------------|--------------------------------------------------------|
| Proposal status                     | Approved ☐ Approved with changes ☐ Revision required ☐ |
| Comments                            |                                                        |
| Signature and date                  |                                                        |

*End of Project Proposal*
