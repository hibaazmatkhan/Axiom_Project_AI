# AXIOM · THE LAST ROOM

**A four-player 3D escape-room game of possible futures**

> Every door is a choice. Every room can move.

THE LAST ROOM is a browser-based, four-player 3D game inspired by the final game
of *Alice in Borderland* season 3 ("Possible Futures") and rebuilt around an
original theme. Four players wake inside a **5×5 matrix of white cube rooms**,
each with four coloured doors and a pedestal of four coloured d10s. Every round
the grid rearranges itself by hidden, discoverable rules; an AI director called
**The Dealer** (NEXUS) models each player and adapts the arena to the team in
real time.

Players see the world in first person from inside their own room. LED strips on
the walls preview possible futures. The team must cross doors, manage points,
predict the next shift, free locked teammates and unseal the final door at **A5**.

The game keeps the academic AI deliverables of the original AXIOM proposal:
A*/BFS search, constraint-satisfaction puzzles, seven pattern types, four
asymmetric roles, k-means player modelling and utility-based adaptation.

Players learn the arena → The Dealer learns the players → the arena evolves →
players adapt again.

---

## What is implemented

| Area | Status |
|---|---|
| Real-time, server-authoritative 4-player multiplayer (WebSockets) | Done |
| 5×5 matrix of moving white cube rooms, `A1`–`E5`, spawn C3 / exit A5 | Done |
| Four coloured doors (red / blue / yellow / green) with two-sided passability | Done |
| Four coloured d10 pedestals per room, capacity capped at 4 | Done |
| Data-driven pattern engine, **7 transformation types** as data | Done |
| Door capacity, 0-capacity lockdowns and two-helper scans | Done |
| Points economy, Sanction rooms, 15-round limit, eliminations | Done |
| Cooperative CSP cipher that unseals the final door | Done |
| Asymmetric information across 4 roles (Navigator / Oracle / Timekeeper / Archivist) | Done |
| The Dealer: six-attribute player model, k-means clustering, utility-based adaptation | Done |
| Guaranteed solvability via time-expanded reachability checks | Done |
| Accounts, match history, statistics and Dealer model persistence | Done |
| Full 3D client: first-person cube room, coloured doors, LED futures, d10 gems, wristband map | Done |
| Security: PBKDF2 password hashing, input validation, rate limiting, anti-cheat | Done |
| Tests, Docker, architecture + protocol docs | Done |

Seven transformation types: `rotation, reflection, translation, symbol,
sequential, conditional, compound`.

Seven stages: `Induction → First Shift → Split → Visions → Lockdown →
Convergence → The Last Room`.

### Economy

- Start with **15 points**.
- Cross a door: **−1**. Wait: **−1**. Sanction room: **−1…−3**.
- Correct prediction: **+1** and the next shift is delayed; wrong: **−1**.
- Solve the cooperative cipher: **+2** to each player.
- Scan a locked teammate free: **−1** per helper (two helpers in or beside the
  room are required).
- Points at zero eliminate you. The match ends after **15 rounds**.

---

## Run it (local)

### Backend (Python 3.12+)

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
python -m pytest            # 64 tests
```

### Frontend (Node 20+)

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev                 # http://localhost:3000
```

Open http://localhost:3000, create an account (optional), then open a room or
join with a code. Open the game URL in up to **4 browser tabs** to play the full
four-role experience. Each tab is auto-assigned a role.

> For a real match set the backend env `MIN_PLAYERS=4`. For quick demos set
> `ROUND_SECONDS=8`. Players press **Ready up**; the match starts when all
> connected players are ready.

### Docker

```bash
docker compose up --build
# frontend → http://localhost:3000   backend → http://localhost:8000
```

---

## Controls

| Input | Action |
|---|---|
| `W A S D` / arrow keys | choose the north / west / south / east door |
| Click / tap a door in the room | cross that door |
| `Space` | wait (spends 1 point) |
| Door buttons (N/E/S/W) | cross a named door |
| `V` | toggle first-person / overhead camera |
| `N` | toggle team notes |
| Chat + team notes | coordinate the four roles |

A doorway is passable only when both rooms have that side open. Clicking the
canvas in first person captures the mouse; `Esc` releases it.

---

## Repository layout

```
axiom/
├── backend/
│   ├── app/
│   │   ├── arena.py        # 5×5 room matrix, generator, doors, shifts, A*, reachability
│   │   ├── maze.py         # backwards-compatible shim over arena.py
│   │   ├── fate.py         # d10 rolls, capacity, possible futures, sanctions
│   │   ├── patterns.py     # 7 transformation types + rule engine
│   │   ├── knowledge.py    # knowledge base + CSP cooperative cipher generator
│   │   ├── nexus.py        # The Dealer AI director
│   │   ├── stages.py       # seven-stage progression
│   │   ├── roles.py        # four roles + asymmetric information filtering
│   │   ├── game.py         # rooms, round loop, points, locks, revives, reconnect
│   │   ├── db.py           # SQLite persistence
│   │   └── main.py         # FastAPI HTTP API + WebSocket endpoint
│   ├── tests/              # 64 pytest tests + live-server smoke scripts
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── app/                # landing, lobby, login, profile, game
│   ├── components/         # GameCanvas (Three.js), GameClient (HUD), WristbandMap
│   ├── lib/                # socket hook, types, api client
│   └── Dockerfile
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
| Constraint satisfaction | Cooperative cipher split across 4 roles, solver-verified |
| Knowledge representation | Rules & observations as structured facts |
| Pattern recognition | Periodic / sequential rules + prediction scoring |
| Clustering & classification | k-means over six-attribute player vectors → play styles |
| Utility-based decision making | The Dealer scores `raise_complexity / add_hazard / give_clue / lower_dice / shift_information / hold` |
| Adaptive difficulty | Timing, door capacity and hazards adjust to measured team skill |

Try The Dealer without the game:

```
GET http://localhost:8000/api/nexus/tune?team_skill=0.9&cycles=10
```

---

## Theme and naming

The game is **inspired by** the final game of *Alice in Borderland* season 3
("Possible Futures") but uses original names and assets. No copyrighted names,
art or text from the show are used.

| Show concept | Original name here |
|---|---|
| points | **Points** (start 15) |
| dice | **d10 pedestal** (four coloured dice per room) |
| coloured doors | **Red / Blue / Yellow / Green doors** |
| sigils | **Spade / Heart / Diamond / Club** |
| penalty rooms | **Sanction Rooms** |
| possible-futures preview | **Possible Futures** (LED wall strips) |
| AI game master | **The Dealer** (NEXUS) |
| final room | **The Last Room** (A5) |
| roles | **Navigator / Oracle / Timekeeper / Archivist** |

Palette: paper `#f4f1ea`, ink `#14161a`, coal `#0b0c0e`, door red `#e23b3b`,
blue `#3f7bd9`, yellow `#e8b53a`, green `#3f9f6b`.

---

## Security

- Passwords stored as PBKDF2-HMAC-SHA256 with per-user salts.
- All intents validated server-side (doors, capacity, cooldown, adjacency,
  rate limit) — clients cannot cheat by sending state.
- Token-bucket rate limiting on game intents.
- The hidden rule is never serialised to any client.
- Sigils are stripped for non-Oracle/Archivist clients; d10 rolls and capacity
  are stripped for non-Timekeeper clients (each player always sees their own
  room's doors).

## Tests

`cd backend && python -m pytest` covers the arena engine, all seven pattern
types, solvability, The Dealer model and adaptation, the cipher solver across
1,000 seeds, and the server (movement, anti-cheat, prediction, asymmetric
information, locks/revives, reconnect, rate limiting).

Live-server smoke scripts (start the backend first, then run from `backend/`):

| Script | What it proves |
| --- | --- |
| `python tests/integration_smoke.py` | HTTP health, four roles assigned, core message types flow |
| `python tests/transition_smoke.py` | a round fires and each role receives only its own slice |
| `python tests/match_smoke.py` | a full match runs to `game_over` and is persisted to SQLite |

---

*Project proposal: AXIOM — AI-Driven Multiplayer Dynamic Labyrinth · Team
24K-(2009, 2040, 2044, 2049) · AI Lab · October 2026.*
