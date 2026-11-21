# AXIOM · THE LAST ROOM

**A four-player 3D escape-room game of possible futures**

> Every door is a choice. Every room can move.

THE LAST ROOM is a browser-based, four-player 3D fan game set in an *Alice in
Borderland* broadcast theme. Four players wake inside a **5×5 matrix of white cube rooms**,
each with four fully coloured doors. Every round
the grid rearranges itself by hidden, discoverable rules; an AI director called
**The Dealer** (NEXUS) models each player and adapts the arena to the team in
real time.

Players see the world in first person from inside their own room. LED strips on
the walls preview possible futures. The team must cross doors, manage points,
predict the next shift, free locked teammates, find the hidden edge exit and bring every living player into it.

The game keeps the academic AI deliverables of the original AXIOM proposal:
A*/BFS search, seven pattern types, four asymmetric roles, k-means player
modelling and utility-based adaptation.

Players learn the arena → The Dealer learns the players → the arena evolves →
players adapt again.

---

## What is implemented

| Area | Status |
|---|---|
| Real-time, server-authoritative 4-player multiplayer (WebSockets) | Done |
| 5×5 matrix of moving white cube rooms, `A1`–`E5`, spawn C3 / hidden edge exit | Done |
| Four coloured doors (red / blue / yellow / green) with two-sided passability | Done |
| Four coloured d10 rolls per room, with bounded seal relief | Done |
| Data-driven pattern engine, **7 transformation types** as data | Done |
| D10 door seals, two-sealed-click lockdowns and two-helper scans | Done |
| Points economy, Sanction rooms, 15-round limit, eliminations | Done |
| Hidden edge exit discovery and team escape win condition | Done |
| Asymmetric information across 4 roles (Navigator / Oracle / Timekeeper / Archivist) | Done |
| The Dealer: six-attribute player model, k-means clustering, utility-based adaptation | Done |
| Cooperative CSP role-mark puzzle with per-role private clues | Done |
| Guaranteed solvability via time-expanded reachability checks | Done |
| Firebase Auth accounts, email verification, password reset, Google, guest, optional TOTP MFA | Done |
| Supabase public profiles + match history, statistics and Dealer model persistence | Done |
| Profile avatars: five card PFP presets, adjustable crop, 5 MB uploads and storage cleanup | Done |
| Full 3D client: first-person cube room, coloured doors, LED futures, wristband map | Done |
| Security: Firebase ID tokens, first-frame WebSocket auth, server-only Supabase service key, input validation, rate limiting, anti-cheat | Done |
| Tests, Docker, architecture + protocol docs | Done |

Seven transformation types: `rotation, reflection, translation, symbol,
sequential, conditional, compound`.

Seven stages: `Induction → First Shift → Split → Visions → Lockdown →
Convergence → The Last Room`.

### Economy

- Start with **15 points**.
- Open a door: **−1**. Cross through an active doorway: **free**.
- Wait: **−1**. Sanction room: **−1…−8** depending on the room.
- Correct prediction: **+1** and the next shift is delayed; wrong: **−1**.
- Scan a locked teammate free: **−1** per helper (two helpers in or beside the
  room are required).
- Points at zero eliminate you. The match ends after **15 rounds** or when the
  match timer expires.

---

## Run it (local)

### Configuration

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Fill the Firebase web config in `frontend/.env.local` and the Firebase Admin +
Supabase service credentials in `backend/.env`. The service-role key and private
key must never be exposed to the browser or committed.

Set `AXIOM_MATCH_STORE=supabase` in production so match history, stats and
Dealer models use Supabase. `AXIOM_MATCH_STORE=sqlite` keeps the local/test
fallback; it must not be used for deployed ranked data.

Run the Supabase migrations once in the Supabase SQL editor:

```text
backend/migrations/001_profiles.sql
backend/migrations/002_matches.sql
backend/migrations/003_phase4_avatar.sql
```

Or, with a working `SUPABASE_DB_URL` in `backend/.env`:

```bash
cd backend
python scripts/apply_migrations.py
```

### Backend (Python 3.12+)

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
python -m pytest -q         # 94 tests
```

### Frontend (Node 20+)

```bash
cd frontend
npm install
npm run dev                 # http://localhost:3000
```

Open http://localhost:3000, sign in with email/password or Google (optional),
then open a room or join with a code. Guests and unverified accounts can play;
only verified accounts persist ranked match data. Open the game URL in up to
**4 browser tabs** to play the full four-role experience. Each tab is
auto-assigned a role.

> For a real match set the backend env `MIN_PLAYERS=4`. For quick demos set
> `ROUND_SECONDS=8` and optionally `MATCH_SECONDS=120`. The match timer starts
> when the round begins; the whole living team must reach the exit before it
> expires or everyone left alive is eliminated. Players press **Ready up**;
> the match starts when all connected players are ready.
>
> Firebase Auth needs Email/Password and Google enabled, with `localhost`
> authorized. TOTP MFA is optional and may require Identity Platform.

### Docker

```bash
docker compose up --build
# frontend → http://localhost:3000   backend → http://localhost:8000
```

### Vercel

The root `vercel.json` deploys `frontend/` and `backend/` as one Services project. `/backend/*` is rewritten directly to the backend service and normalized by `BackendPrefixMiddleware`; `/ws/*` is also routed to the backend. Keep both on the same Vercel domain. The internal `BACKEND_URL` binding is injected by Vercel and is only needed by the local Next.js fallback proxy at `frontend/app/backend/[...path]/route.ts`; do not set it manually in Vercel.

For standalone frontend development, set `BACKEND_URL=http://localhost:8000` in `frontend/.env.local`. Leave `WS_URL` unset so the browser connects to the current host; set it to `ws://localhost:8000` only when running the backend separately. Browser config uses non-prefixed `FIREBASE_*`, `SITE_URL`, and `WS_URL` values injected by `frontend/next.config.mjs`; do not add a public prefix to these variables. Run `vercel dev` at the repository root to test both services with bindings.

Before going live, authorize the Vercel domain in Firebase Auth, add its credentials to both services' environment variables, set `AXIOM_MATCH_STORE=supabase`, and keep the backend long-lived. Rooms are in memory (`rooms` in `backend/app/main.py`), so Vercel Services must run a single long-lived backend instance or be replaced by shared state/Redis before scaling. Configure Fluid Compute/max duration for the backend service in the Vercel dashboard so WebSocket connections are not cut off by short function timeouts. The Render Blueprint uses one Docker instance (`numInstances: 1`) for the same reason. Match data is shared through Supabase.

---

## Controls

| Input | Action |
|---|---|
| `W A S D` / arrow keys | move freely inside the current room |
| Click / tap a door in the room | open it for 10 seconds (−1 point) |
| `W A S D` toward an open doorway | cross into the next room (free) |
| `E` / `Enter` while facing a door | open it for 10 seconds (−1 point) |
| `Space` | wait (spends 1 point) |
| Click into the arena, then move the mouse | look around in first person |
| `Esc` | stop mouse look |
| Drag on touch screens | look around in first person |
| Chat | coordinate the four roles |

A doorway is passable only when both rooms have that side open. Clicking a
door opens it for 10 seconds and shows the remaining time above the frame.
Structural walls are hidden in the shared map; your wristband dims blocked
doorways, while d10 seals stay hidden until a door is tried.

---

## Repository layout

```
axiom/
├── backend/
│   ├── app/
│   │   ├── arena.py        # 5×5 room matrix, generator, doors, shifts, A*, reachability
│   │   ├── maze.py         # backwards-compatible shim over arena.py
│   │   ├── fate.py         # d10 seals, possible futures, sanctions
│   │   ├── patterns.py     # 7 transformation types + rule engine
│   │   ├── knowledge.py    # knowledge base, CSP puzzles + observations
│   │   ├── nexus.py        # The Dealer player model + utility decision core
│   │   ├── directors.py    # Director interface, Nexus/Static/Random directors
│   │   ├── simulation.py   # simulated players + 900-match experiment runner
│   │   ├── experiment_charts.py # CSV-driven evaluation charts
│   │   ├── stages.py       # seven-stage progression
│   │   ├── roles.py        # four roles + asymmetric information filtering
│   │   ├── game.py         # rooms, round loop, points, locks, revives, reconnect
│   │   ├── auth.py         # Firebase ID token, App Check and admin guards
│   │   ├── audit.py        # audit log and room inventory persistence
│   │   ├── avatar_store.py # avatar validation, storage upload and cleanup
│   │   ├── characters.py   # character avatar allowlist
│   │   ├── supabase_store.py # profiles, avatars, export and deletion
│   │   ├── repositories.py # storage abstraction protocols
│   │   ├── db.py           # match store selection (Supabase / SQLite fallback)
│   │   └── main.py         # FastAPI HTTP API + WebSocket endpoint
│   ├── tests/              # pytest suite + live-server smoke scripts
│   ├── experiments/        # CLI entry point + generated result artifacts
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── app/                # landing, lobby, login, profile, game
│   ├── components/         # GameCanvas (Three.js), GameClient (HUD), WristbandMap
│   ├── lib/                # socket hook, types, api client, avatar rules
│   ├── public/avatars/pfp/ # card PFP presets
│   └── Dockerfile
├── avatar-pack/            # standalone avatar assets, backend API and preview
├── docs/
│   ├── ARCHITECTURE.md     # system design + module map + theme mapping
│   ├── PROTOCOL.md         # WebSocket + HTTP contracts
│   └── AXIOM_AL2002_Project_Proposal.md
├── docker-compose.yml
└── README.md
```

---

## How the AI is used

| Technique | Where |
|---|---|
| Informed search (A*) | Pathfinding, reachability checks |
| Procedural generation | Seeded spanning-tree rooms + door colours/d10s/sanctions |
| Knowledge representation | Rules & observations as structured facts |
| Pattern recognition | Periodic / sequential rules + prediction scoring |
| Clustering & classification | k-means over six-attribute player vectors → play styles |
| Utility-based decision making | The Dealer scores `raise_complexity / add_hazard / give_clue / lower_dice / shift_information / hold` using skill fit, progress, cooperation balance and frustration |
| Director baselines | `NexusDirector` is compared with `StaticDirector` and `RandomDirector` through the common `Director` interface |
| Simulated players | Novice, average and expert policies generate seeded event streams for evaluation |
| Adaptive difficulty | Rule complexity, hazards, clues, dice relief, information nudges and CSP difficulty adjust to measured team skill |

Try The Dealer without the game:

```
GET http://localhost:8000/api/nexus/tune?team_skill=0.9&cycles=10
```

Run the full director comparison (3 directors × 3 team levels × 100 seeds = 900 matches):

```
cd backend
python -m experiments.run_experiment
```

Artifacts are written to `backend/experiments/results/`: `experiment_results.csv`,
`summary.csv`, `difficulty_history.csv`, `player_clusters.csv`,
`search_results.csv`, `search_dynamic_summary.csv`, and six PNG charts for
A* vs BFS nodes, search success, path length, difficulty over time, rule
discovery and k-means clusters. See `docs/NEXUS_Evaluation.md` for the report.

---

## Theme and naming

The client uses a full **Alice in Borderland** broadcast theme as an unofficial
fan project. The default broadcast faces are five card symbols; custom images
come only from user-supplied assets.

| Show concept | Game term |
|---|---|
| points | **Points** (start 15) |
| dice | **d10 pedestal** (four coloured dice per room) |
| coloured doors | **Red / Blue / Yellow / Green doors** |
| sigils | **Spade / Heart / Diamond / Club** |
| penalty rooms | **Sanction Rooms** |
| possible-futures preview | **Possible Futures** (LED wall strips) |
| AI game master | **The Dealer** (NEXUS) |
| final room | **The Last Room** (hidden edge exit) |
| roles | **Navigator / Oracle / Timekeeper / Archivist** |

The shell uses a near-black broadcast palette with signal red, card gold and
neon cyan. The landing page, login, lobby, profile and game HUD share the same
responsive design system and animated favicon.

Palette: paper `#f4f1ea`, ink `#14161a`, void `#040507`, door red `#ff4655`,
blue `#5aa7ff`, yellow `#f4c542`, green `#58d68d`.

---

## Security

- Firebase Authentication owns credentials; the backend verifies ID tokens with
  Firebase Admin and never sees passwords.
- WebSocket gameplay requires a first-frame auth message; verified identity is
  attached server-side, and guests cannot write ranked data.
- Supabase service-role credentials stay in `backend/.env`; the browser only
  receives Firebase public web config.
- All intents validated server-side (doors, seals, cooldown, adjacency,
  rate limit) — clients cannot cheat by sending state.
- Token-bucket rate limiting on game intents.
- The hidden rule is never serialised to any client.
- Sigils are stripped for non-Oracle/Archivist clients; hidden d10 seal results
  are never serialised to any client (each player sees only door colours).

## Tests

`cd backend && python -m pytest -q` covers the arena engine, all seven pattern
types, solvability, The Dealer model and adaptation, hidden-exit discovery,
Supabase migration contracts, WebSocket first-frame auth, profile
avatar presets/uploads/cleanup, and the server (movement, anti-cheat,
prediction, asymmetric information, locks/revives, reconnect, rate limiting,
room APIs, cooperative CSP puzzles, director baselines, 900-match configuration,
changing-maze search and chart generation).

Live-server smoke scripts (start the backend first, then run from `backend/`):

| Script | What it proves |
| --- | --- |
| `python tests/integration_smoke.py` | HTTP health, four roles assigned, core message types flow |
| `python tests/transition_smoke.py` | a round fires and each role receives only its own slice |
| `python tests/match_smoke.py` | a full match runs to `game_over` and is persisted to SQLite |

---

*Project proposal: AXIOM — AI-Driven Multiplayer Dynamic Labyrinth · Team
24K-(2009, 2040, 2044, 2049) · AI Lab · October 2026.*
