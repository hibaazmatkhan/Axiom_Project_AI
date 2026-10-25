# AXIOM

**AI-Driven Multiplayer Dynamic Labyrinth**

> The maze has a pattern. Find it before it changes.

AXIOM is a browser-based, four-player 3D puzzle game in which a labyrinth
rearranges itself according to hidden, discoverable rules. The environment never
changes randomly — blocks follow structured transformations that the team must
observe, hypothesise about, test and predict. A behavioural AI Director called
**NEXUS** models each player and adapts the labyrinth to the team in real time.

Players learn the maze → NEXUS learns the players → the maze evolves → players adapt again.

---

## What is implemented

| Area | Status |
|---|---|
| Real-time, server-authoritative 4-player multiplayer (WebSockets) | ✅ |
| Data-driven pattern engine, **7 transformation types** as data | ✅ |
| Asymmetric information across 4 roles (Mover / Symbolist / Chronologist / Archivist) | ✅ |
| Cooperative puzzles via constraint satisfaction, auto-verified solvable | ✅ |
| NEXUS: six-attribute player model, k-means clustering, utility-based adaptation | ✅ |
| Guaranteed solvability via time-expanded reachability checks | ✅ |
| Accounts, match history, statistics and NEXUS model persistence | ✅ |
| 3D client: avatars, animated transitions, effects, HUD, prediction, chat | ✅ |
| Security: PBKDF2 password hashing, input validation, rate limiting, anti-cheat | ✅ |
| Tests, Docker, architecture + protocol docs | ✅ |

Seven transformation types: `rotation, reflection, translation, symbol,
sequential, conditional, compound`.

Seven stages: `Introduction → First Pattern → Cooperation → Prediction →
Adaptive Labyrinth → Complex Patterns → Escape`.

---

## Run it (local)

### Backend (Python 3.11+)

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
python -m pytest            # 55 tests
```

### Frontend (Node 18+)

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev                 # http://localhost:3000
```

Open http://localhost:3000, create an account (optional), then either **Create a
room** or join with a code. Open the game URL in up to **4 browser tabs** to play
the full four-role experience. Each tab is auto-assigned a role.

> For a real match set the backend env `MIN_PLAYERS=4`. For quick demos set
> `TRANSITION_SECONDS=5`. Players press **Ready up**; the match starts when all
> connected players are ready.

### Docker

```bash
docker compose up --build
# frontend → http://localhost:3000   backend → http://localhost:8000
```

---

## Repository layout

```
axiom/
├── backend/
│   ├── app/
│   │   ├── maze.py         # block/maze model, generator, A*, reachability
│   │   ├── patterns.py     # 7 transformation types + rule engine
│   │   ├── knowledge.py    # knowledge base + CSP cooperative puzzle generator
│   │   ├── nexus.py        # NEXUS AI Director
│   │   ├── stages.py       # stage progression
│   │   ├── roles.py        # roles + asymmetric information filtering
│   │   ├── game.py         # rooms, game loop, transitions, reconnect
│   │   ├── db.py           # SQLite persistence
│   │   └── main.py         # FastAPI HTTP API + WebSocket endpoint
│   ├── tests/              # 55 pytest tests
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── app/                # landing, lobby, login, profile, game
│   ├── components/         # GameCanvas (Three.js), GameClient (HUD)
│   ├── lib/                # socket hook, types, api client
│   └── Dockerfile
├── docs/
│   ├── ARCHITECTURE.md     # system design + module map
│   └── PROTOCOL.md         # WebSocket + HTTP contracts
├── docker-compose.yml
└── README.md
```

---

## How the AI is used

| Technique | Where |
|---|---|
| Informed search (A*) | Pathfinding, reachability checks |
| Procedural generation | Seeded randomised spanning tree maze + block layouts |
| Constraint satisfaction | Cooperative puzzles split across 4 roles, solver-verified |
| Knowledge representation | Rules & observations as structured facts |
| Pattern recognition | Periodic / sequential rules + prediction scoring |
| Clustering & classification | k-means over six-attribute player vectors → play styles |
| Utility-based decision making | NEXUS scores `raise_complexity / give_clue / shift_information / hold` |
| Adaptive difficulty | Timing and complexity adjust to measured team skill |

Try the Director without the game:

```
GET http://localhost:8000/api/nexus/tune?team_skill=0.9&cycles=10
```

---

## Security

- Passwords stored as PBKDF2-HMAC-SHA256 with per-user salts.
- All moves validated server-side (bounds, walls, cooldown) — clients cannot cheat by sending state.
- Token-bucket rate limiting on game intents.
- The hidden rule is never serialised to any client.

## Tests

`cd backend && python -m pytest` — covers the maze engine, all seven pattern
types, solvability, the NEXUS model and adaptation, the puzzle solver across
1,000 seeds, and the server (movement, anti-cheat, prediction, asymmetric
information, reconnect, rate limiting).

Live-server smoke scripts (start the backend first, then run from `backend/`):

| Script | What it proves |
| --- | --- |
| `python tests/integration_smoke.py` | HTTP health, four roles assigned, core message types flow |
| `python tests/transition_smoke.py` | a transition fires and each role receives only its own slice |
| `python tests/match_smoke.py` | a full match is played to a win and persisted to SQLite |

---

*Project proposal: AXIOM — AI-Driven Multiplayer Dynamic Labyrinth · Team 24K-(2009, 2040, 2044, 2049) · AI Lab · October 2026.*
