# AXIOM — WP1–WP8 gap and bug todo

Source of truth: `docs/Features List Down.docx` (Appendix A: 8 work packages, 47 tasks, phases P0–P5) and `docs/AXIOM_AL2002_Project_Proposal.md`.

Status legend: **Done** = implemented and covered by backend tests; **Partial** = core exists but a required deliverable or client wiring is missing; **Missing** = no implementation.

Last updated: 2026-11-22 after WP1/WP3/WP4/WP5/WP8 completion work. Git HEAD: `7034fbc`; status covers the dirty working tree, not HEAD alone. Untracked `frontend/lib/audio.ts` and `frontend/tests/contract.test.mjs` still need to be included in any commit.

---

## 0. Baseline blocker

- [x] **Install the missing backend test dependencies.** Installed `scikit-learn` and `matplotlib` into `backend/venv`; collection errors are resolved.
- [x] Verify: `cd backend && PYTHONDONTWRITEBYTECODE=1 ./venv/bin/python -m pytest -q -p no:cacheprovider` → **203 passed, 1 warning in 296.04s**.
- [x] Re-run the experiment runner after deps are installed: `--seeds 2 --cycles 2 --no-charts` smoke passed; retained 900-match artifacts remain in `backend/experiments/results/`.
- [x] Record the real pass/fail counts in this file; WP2/WP6 backend tests are green.

---

## 1. Phase status

| WP | Verdict | Evidence | Remaining work |
|---|---|---|---|
| WP1 Game design and shared contracts | **Done** | `docs/ARCHITECTURE.md`, `docs/PROTOCOL.md`, `docs/NEXUS_Evaluation.md`, `frontend/lib/types.ts`; README now has art/asset plan plus desktop/mobile HUD wireframes | — |
| WP2 Maze and pattern engine | **Done** | `backend/app/arena.py`, `patterns.py`, `knowledge.py`, `puzzles.py`, `stages.py`; `test_arena.py`, `test_csp.py`, `test_knowledge.py` | Full suite green: 203 passed |
| WP3 Game server and multiplayer | **Done** | `backend/app/game.py`, `main.py`; edge-wall guard, locked-helper exclusion, disconnected-player win policy, hidden-rule prediction scoring, short auth critical section and role-filtered info are implemented | — |
| WP4 3D client and visuals | **Done** | `frontend/components/GameCanvas.tsx`: first-person scene, movement, doors, king, wristband, effects, cross-walk and moved-room transition markers; avatar textures on player capsules; ghost gating; Howler.js audio | Full rigged 3D character meshes remain future scope per `avatar-pack/INTEGRATION.md` |
| WP5 Web platform and UI | **Done** | Next.js app, Firebase auth, lobby, profile, match history, HUD timer/clues/chat/notes/puzzles/prediction/role intel; tier-2 destination grid is clickable; Node frontend contract tests added | — |
| WP6 NEXUS AI Director | **Done** | `backend/app/nexus.py`, `directors.py`, `simulation.py`, `experiment_charts.py`; tests, retained results and smoke rerun | — |
| WP7 Data and persistence | **Done** | `backend/migrations/001_profiles.sql`, `002_matches.sql`, `003_phase4_avatar.sql`; SQLite/Supabase stores | — |
| WP8 Security, DevOps, QA and delivery | **Partial** | Firebase auth, validation, rate limiting, anti-cheat tests, Docker, CI with experiment/frontend/avatar checks, documented branching/monitoring/playtest/report plan, `load_probe.py`, Vercel frontend + Render backend config | External: hosted monitoring dashboards, real playtests, deployed p95 evidence, demo video, slides and public demo link |

### 1.5 Phase status (P0–P5 from source docx)

| Phase | Tasks | Verdict | Notes |
|---|---|---|---|
| P0 planning | 1–5 | **Partial** | Rules/protocol, art/asset plan, UI wireframes and branching/task-board process documented; hosted GitHub board/protection are external |
| P1 core prototype | 6–11, 13, 17–18, 21, 29–31, 42 | **Done** | Next.js/FastAPI/Three.js/maze/auth/lobby/database present; four-player avatar textures rendered in the 3D client |
| P2 core gameplay | 12, 14–15, 19, 25–28, 32–35 | **Done** | Gameplay/HUD/server AI wiring, transition markers, tier-2 answer UI, ghost gating and prediction scoring are complete |
| P3 NEXUS | 36–41, 42 | **Done** | Director, player model, clustering, utility decisions, adaptive clues and experiments present; privacy decision for live `nexus` telemetry remains in P2 backlog |
| P4 content | 32, 43 | **Done** | Seven pattern types and seven-stage progression implemented |
| P5 production | 16, 20, 44–47 | **Partial** | Audio, profiles/history, security, Docker/CI, hosting contract, load probe and delivery documentation present; hosted monitoring, real playtests, report evidence, demo video and slides are external |

---

## 2. Missing work by work package

### WP1 — Game design and shared contracts (tasks 1–4)

- [x] Task 1: rules, pattern types, hidden-rule format, stages and puzzles (`docs/ARCHITECTURE.md`, `stages.py`, `patterns.py`).
- [x] Task 2: art style, asset list and avatar design documented in `README.md` §Design and asset plan; avatar presets/portraits live in `avatar-pack/`.
- [x] Task 3: desktop/mobile HUD wireframes documented in `README.md` §Design and asset plan.
- [x] Task 4: shared contracts (`docs/PROTOCOL.md`, `frontend/lib/types.ts`). Update the protocol when new messages are added.
- [x] Notes contract documented in `PROTOCOL.md` (`notes` client/server messages, `state.notes`, 40-line replay).

### WP2 — Maze and pattern engine (tasks 29–35, 43)

- [x] Task 29: maze data structure (`Arena`, `Room`, 5×5 `A1`–`E5`).
- [x] Task 30: seeded generator with solvability and connectivity repair.
- [x] Task 31: A* and BFS pathfinding.
- [x] Task 32: seven transformation types.
- [x] Task 33: data-driven rule engine.
- [x] Task 34: knowledge representation (`KnowledgeBase`, `Fact`, `score_hypothesis`).
- [x] Task 35: CSP puzzle generator with verifier.
- [x] Task 43: seven-stage progression and final stage.
- [x] Verify all of the above after installing `scikit-learn`/`matplotlib`; full backend suite is green.

### WP3 — Game server and multiplayer (tasks 7, 21–28)

- [x] Task 7: FastAPI project.
- [x] Task 21: WebSocket manager, rooms and sessions.
- [x] Task 22: authoritative game state and round loop.
- [x] Task 23: transition timer.
- [x] Task 24: movement/action synchronisation.
- [x] Task 25: disconnect and reconnect handling.
- [x] Task 26: prediction check/reward/penalty server logic is reachable from the HUD with live feedback and a 2-second cooldown.
- [x] Task 27: cooperative puzzle server logic (role-mark CSP + delay puzzle).
- [x] Task 28: information distribution is wired: Pathfinder `moved`, Timekeeper timing, Watcher `sigils` and Decoder `previous` are sent and shown in the role-intel panel.
- [x] Add `from` and `to` room codes to `room_entered` so clients do not depend on state-arrival timing.
- [x] Guard against edge walls being treated as sealed doors; `_strike_sealed_door` now ignores no-neighbour directions.

### WP4 — 3D client and visuals (tasks 9–16)

- [x] Task 9: Three.js scene, camera, lighting.
- [x] Task 10: movement and collision.
- [x] Task 11: maze block/room rendering.
- [x] Task 12: transition animations (rotate, shift, mirror, swap). Cross-walk uses `room_entered.from/to`; `moved` drives animated ring markers plus glitch pulse.
- [x] Task 13: avatars for four players. The canvas renders avatar textures on player capsules with name/color; rigged 3D meshes remain future scope per `avatar-pack/INTEGRATION.md`.
- [x] Task 14: interactive objects (doors, pedestal/terminal surfaces, king).
- [x] Task 15: per-player views via server filtering; complete the missing watcher/decoder slices and render them.
- [x] Task 16: visual effects are partial (glitch, flashes, blood); Howler.js audio adds footsteps, doors, lockdowns, KING warnings and KING proximity.

### WP5 — Web platform and UI (tasks 6, 17–20)

- [x] Task 6: Next.js, TypeScript, Tailwind.
- [x] Task 17: signup/login (Firebase email/password, Google, guest, reset, verify, optional MFA).
- [x] Task 18: lobby create/join/quick-match/ready.
- [x] Task 19: in-game HUD. Timer, role, points, clues, chat, wristband, role-mark puzzle, delay puzzle, king alerts, prediction input/feedback and team notes are present.
- [x] Task 20: profiles and match history.
- [x] Prediction panel with seven pattern types, optional sigils, `sendPredict`, cooldown and result/streak feedback is implemented on desktop and mobile.
- [x] Shared team-notes panel with backend broadcast and `state.notes` replay is implemented.

### WP6 — NEXUS AI Director (tasks 36–41)

- [x] Task 36: event logging.
- [x] Task 37: six-attribute player model.
- [x] Task 38: clustering/classification.
- [x] Task 39: utility-based decisions.
- [x] Task 40: adaptive difficulty and clue system.
- [x] Task 41: simulated-player tuning and 900-match experiment.
- [x] Reproduce the retained results after deps are installed: `--seeds 2 --cycles 2 --no-charts` smoke passed; full 900-seed run remains optional.

### WP7 — Data and persistence (tasks 8, 42)

- [x] Task 8: PostgreSQL/Supabase setup (migrations and scripts).
- [x] Task 42: schema for profiles, matches, match players, player models, avatars, rooms and audit logs.
- [ ] Confirm migrations apply cleanly against a fresh Supabase project.

### WP8 — Security, DevOps, QA and delivery (tasks 5, 44–47)

- [x] Task 5: repository/branching/task board. Branching and GitHub Issues process documented in `README.md` §Delivery and operations.
- [x] Task 44: security hardening (Firebase ID tokens, first-frame WS auth, validation, rate limits, anti-cheat).
- [x] Task 45: Docker, CI, Render/Vercel hosting, `/health` monitoring contract and documented alert thresholds.
- [ ] Task 46: testing/balancing. Unit/smoke/frontend tests and `tests/load_probe.py` exist; real four-player playtests and deployed p95 evidence remain external.
- [ ] Task 47: final report shell, storyboard and slide outline documented in `README.md`; recorded demo video, narration and exported slides remain external.
- [x] Add a CI step that runs the experiment smoke test and frontend build; CI now runs `pytest`, experiment smoke, frontend build, avatar tests, Docker builds.

---

## 3. Bug backlog

### P0 — correctness / blockers

- [x] **Backend tests cannot import.** Installed `scikit-learn` and `matplotlib`; full pytest suite now passes (203 passed).
- [x] **Tier-2 delay puzzle is answerable.** `grids.before` is now the clickable destination grid when `puzzle.tier === 2`; ghost mode keeps it read-only.
- [x] **`room_entered` lacks `from`/`to`.** Broadcast now includes `player`, `door`, `from`, `to`, `cost`; `GameCanvas` uses `from`/`to` for cross animation and `PROTOCOL.md` is updated.
- [x] **`previous` and `sigils` are sent.** `filter_round` populates Watcher `sigils` and Decoder `previous` (filtered arena), and both are shown in the role-intel panel.
- [x] **Edge walls no longer penalize the player.** `_strike_sealed_door` returns early when the clicked direction has no neighbouring room.
- [x] **Prediction has a cooldown.** `game.py` enforces 2 seconds per player, exposes `you.prediction_cooldown_remaining`, and has a rate-limit test.

### P1 — missing phase deliverables

- [x] **Prediction HUD is present.** Pattern-type selector, send button, cooldown and result/streak feedback are rendered on desktop and mobile.
- [x] **Team notes panel is present.** `notes` message broadcasts to the room, replays the last 40 in `state.notes`, and is documented in `PROTOCOL.md`.
- [x] **Role information is displayed.** Pathfinder `moved`, Watcher `sigils` and Decoder `previous` appear in the role-intel panel.
- [x] **Transition animations use `moved`.** `GameCanvas.pulse(moved)` spawns animated ring markers from each `from` position to `to` plus glitch feedback.
- [x] **Predictions score against one hidden target rule.** The server derives a seeded target index per round; public `pattern_types` no longer guarantee success.
- [x] **Ghost mode client gating matches the HUD.** WASD/E/crossing/door clicks, Space wait, and delay answers are blocked for eliminated players while chat and role intel remain live.
- [x] **Sound is wired with Howler.js (MIT).** Footsteps, doors, lockdowns, KING warnings and KING proximity are implemented with a mute control; 3D character models remain documented as future scope per `avatar-pack/INTEGRATION.md`.
- [x] **Decoder `previous` layout is used.** It comes from server round filtering (`backend/app/roles.py:84-85`) via `transition.previous` (`frontend/lib/useGameSocket.ts:317`) and renders in `GameClient.tsx:846-852`. The separate client `prevArena` state at `useGameSocket.ts:78` remains unused.

### P2 — hardening / polish

- [x] **Locked helpers cannot free others.** `unlock()` rejects locked helpers from acting and from the two-helper pool.
- [x] **Disconnected living players no longer block a team win.** `_check_endings()` uses non-eliminated players during the 120s reconnect grace.
- [x] **Room creation lock no longer spans network auth.** `_ws_identity` completes before `room_creation_lock` is acquired.
- [x] **Blood particles survive rebuild.** Particles and floor pools are attached to `scene`, disposed on room change and unmount, and spawn on non-KING eliminations with glitch feedback.
- [x] **Distant `door_closed` closes all local doors.** `GameCanvas` now returns early when `localDir()` is null and clears only the matching preview.
- [x] **Header shows `R1/0`.** Header now shows `R1` and only appends `/{maxRounds}` when `maxRounds > 0`.
- [x] **README d10 visibility claim checked — not a visibility overclaim.** `README.md:34` describes hidden d10 rolls as a feature; `README.md:312`, `backend/app/roles.py:116` and `docs/PROTOCOL.md:124` explicitly document that dice values stay hidden. Optional wording cleanup only.
- [x] **Multi-rule shifts expose all active pattern types.** `backend/app/game.py:1560-1564` stores `pattern_types` alongside `pattern_type`, `backend/app/roles.py:61` preserves it, `frontend/lib/useGameSocket.ts:317` consumes it, and `docs/PROTOCOL.md:47`, `:125-127` document it.
- [x] **NEXUS player models are private in live state messages.** `broadcast_state` strips `nexus` from player payloads; the aggregate report remains available in `game_over` and admin state.
- [x] **Add frontend tests.** `frontend/tests/contract.test.mjs` runs via `npm test` and CI; it covers tier-2 UI, ghost gating, WS env, transition markers, Vercel config and avatar summary fields.
- [x] **Game-over summary includes avatars.** Summary players carry `avatar_url` and `character_id`, and the 3D canvas uses `avatar_url` textures.
- [x] **Avatar migration numbering is unique.** The avatar-pack migration is now `004_avatar_fields.sql` and `INTEGRATION.md` references it.
- [x] **Delivery risk identified: `frontend/lib/audio.ts` is untracked.** Include it and `frontend/tests/contract.test.mjs` in any commit or a clean checkout will fail.
- [x] **Protocol delay config is synced.** 12/15/18s answers, 30s cooldown and 18–45s shift bounds now match code.
- [x] **Protocol/Architecture KING timings are synced.** First spawn 120s, 300s interval and appearances at 120/420/720/1020/1320 now match code.
- [x] **README controls are synced.** Controls now describe drag-to-look/click-to-open and ghost-safe Space.
- [x] **README quick-demo rounds are valid.** `ROUND_SECONDS=18` matches the 18s shift floor.
- [x] **Protocol state example includes role-mark progress.** `puzzle.public.marks` and `puzzle.you.mark` are documented.

---

## 3.5. Friend-requested polish (completed)

- [x] Cursor controls replaced with drag-to-look, click-to-open, pointer capture, hover cursor, and touch-friendly input; WASD and `E`/`Enter` remain intact.
- [x] All temporary-open doors get brighter previews simultaneously; distant `door_closed` events no longer close every local door.
- [x] Door panels no longer use the horizontal light/dark strips.
- [x] Cross-walk animation uses authoritative `room_entered.from`/`to`.
- [x] Blood/gore enhanced with more particles, lingering floor pools, room-change cleanup, and elimination-driven glitch.
- [x] Desktop sidebars collapse/expand with toggle buttons.
- [x] Ghost mode is explicit in HUD/client/server terms: chat/role intel remain live while doors, puzzles, scan, WAIT, helper actions and free-camera movement are disabled.
- [x] Role-mark puzzle keeps its mechanic but now shows `marks/4`, the player's submitted mark, and ghost-safe submit state.
- [x] KING visits only non-exit rooms; appearances are 2:00/7:00/12:00/17:00/22:00 with 180s duration and 300s interval.
- [x] Timing rebalanced: stage shifts 32→20s with ±10% jitter clamped to 18–45s; delay answers 12/15/18s; Dealer clue cooldowns 30s/12s and cap 4 per stage.
- [x] Core docs updated: `README.md` and `docs/PROTOCOL.md` carry the new timing/KING/notes/prediction/audio details; remaining stale sections are listed in P2 above.

---

## 4. Verification commands

```bash
# Backend
cd backend
./venv/bin/python -m pip install scikit-learn matplotlib
PYTHONDONTWRITEBYTECODE=1 ./venv/bin/python -m pytest -q -p no:cacheprovider
./venv/bin/python -m experiments.run_experiment --seeds 2 --cycles 2 --no-charts --output-dir /tmp/axiom-experiment
./venv/bin/python tests/load_probe.py --clients 4 --url ws://localhost:8000

# Frontend
cd frontend
npm test
npm run build
npm run smoke          # requires a running backend
```

Last verified results on the current working tree: backend **208 passed, 1 warning**; avatar-pack backend **7 passed, 1 warning**; frontend `npm test` **6 passed** and clean `npm run build` after `rm -rf .next`; `tsc -p ../avatar-pack/tsconfig.json` passed; NEXUS experiment smoke (`--seeds 2 --cycles 2 --no-charts`, 18 matches) passed; `load_probe.py --help` and compile check passed; `git -c core.whitespace=cr-at-eol diff --check` is clean. Browser/manual 4-tab items and a live load probe against a deployed backend remain user-verification tasks.

Manual 4-tab smoke checklist:

- [ ] Four browser tabs join the same room and receive different roles.
- [ ] Lobby ready starts the match; timer and stage advance.
- [ ] Open/cross a door; points update on all clients.
- [ ] Pathfinder reveals wristband; watcher receives king alert; timekeeper sees countdown; decoder sees previous layout.
- [ ] Submit a role mark; solve a tier-1, tier-2 and tier-3 delay puzzle.
- [ ] Send a prediction; correct prediction adds +1 and delays the shift, wrong subtracts 1, and multi-rule stages reject non-hidden pattern types.
- [ ] Team notes persist across all four clients.
- [ ] Transition animation plays for move/rotate/reflect/swap via ring markers and glitch pulse.
- [ ] Locked player is freed by two helpers; locked helper cannot free others.
- [ ] Match ends on exit, timer expiry and elimination; summary and history persist for verified users.
- [ ] Drag-to-look and click-to-open work on desktop and touch; WASD and `E`/`Enter` still work.
- [ ] All temporary-open doors show previews; a distant `door_closed` does not close the local door.
- [ ] Cross-walk animation uses the authoritative `from`/`to` rooms.
- [ ] Blood/gore appears for KING kills via `king_kill` and for non-KING eliminations via the elimination event, and clears on room change.
- [ ] Eliminated player sees ghost mode with chat/role intel live and all gameplay actions plus free-camera movement disabled client-side and server-side.
- [ ] KING never visits the exit room; sidebars collapse/expand; `maxRounds = 0` renders as `R1`.
- [ ] Visually inspect the exit room and confirm the door-strip cleanup and role-mark progress display.
- [ ] Move with WASD and confirm footstep audio; open a door and hear the door cue.
- [ ] Trigger a lockdown and hear the lockdown cue; confirm KING proximity drone starts/stops with room entry and KING despawn.
- [ ] Confirm the Watcher KING warning sound and toggle **Sound on/off** to mute/unmute all cues.
- [ ] Confirm tier-2 delay puzzle has a clickable `grids.before` destination grid.
- [ ] Confirm only the single hidden target rule is accepted in multi-rule stages.
- [ ] Confirm eliminated players cannot move the free camera, press Space to wait, open doors or submit decoder delay answers from the client.
- [ ] Run `npm test` in `frontend/` and confirm six contract tests pass.
- [ ] On a deployed build, confirm `/backend/health` succeeds and WebSocket reconnects keep the same room/player after a brief network drop.

---

## 5. Suggested implementation order

1. Done: install deps, backend suite green, P0/P1/P2 code fixes, WP1/WP4/WP5 in-repo deliverables.
2. Done: frontend contract tests, stale docs sync, Vercel/Render deployment split, monitoring/load/playtest/report documentation.
3. Remaining: include untracked `frontend/lib/audio.ts` and `frontend/tests/contract.test.mjs` in the next commit.
4. Remaining external: hosted monitoring dashboards/alerts, deployed p95 evidence, four-player playtests, demo video/narration/slides and public demo link.
5. Re-run the manual 4-tab smoke checklist after the user takes delivery.

---

## 6. Key references

- `docs/Features List Down.docx` — WP1–WP8, tasks 1–47, phases P0–P5.
- `docs/AXIOM_AL2002_Project_Proposal.md` — scope, objectives O1–O8, milestones M1–M6.
- `docs/PROTOCOL.md` — WebSocket/HTTP contract.
- `docs/ARCHITECTURE.md` — server-authoritative design and round loop.
- `docs/NEXUS_Evaluation.md` — 900-match benchmark and retained results.
- `backend/app/game.py` — authoritative room/player loop.
- `backend/app/roles.py` — asymmetric information filtering.
- `backend/app/puzzles.py` — delay puzzle generation and answer checks.
- `frontend/components/GameClient.tsx` — HUD and puzzle/prediction surfaces.
- `frontend/components/GameCanvas.tsx` — Three.js renderer and transitions.
- `frontend/lib/useGameSocket.ts` — socket state and event wiring.
