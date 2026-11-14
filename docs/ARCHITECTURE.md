# AXIOM · THE LAST ROOM architecture

The server holds the authoritative game state. Clients send only intents; the
server validates them, runs the round loop, shifts the grid, rolls the d10
pedestals, asks **The Dealer** (NEXUS) for the next action, filters information
per role and broadcasts.

The arena is a 5×5 matrix of white cube rooms (`A1`–`E5`). Each room has four
coloured doors (red / blue / yellow / green) and a pedestal of four coloured d10s.
The client renders only the room the player is in, in first person, with LED
strips on the walls previewing possible futures.

```
                       ┌─────────────────────────────────────────────┐
                       │                Frontend (Next.js)            │
   Browser ─── HTTP ──▶ │  landing · lobby · login · profile · game    │
                       │  Three.js first-person cube room · HUD ·     │
                       │  wristband map · d10 pedestal · futures ·    │
                       │  locks/revives · chat                        │
                       └───────────────┬──────────────────────────────┘
                                       │  WebSocket (intents ↓ / state ↑)
                       ┌───────────────▼──────────────────────────────┐
                       │            Game server (FastAPI/asyncio)       │
                       │  rooms · round loop · timers · validation      │
                       │  points · locks · revives · eliminations       │
                       │  rate limiting · reconnect                     │
                       │  per-role information filtering                │
                       └───────┬───────────────────────────┬───────────┘
                               │                           │
              ┌────────────────▼──────────┐   ┌────────────▼──────────────┐
              │   Arena & pattern engine   │   │      The Dealer (NEXUS)    │
              │   (WP2)                    │   │        (WP6)               │
              │  · 5×5 matrix of rooms     │   │  · event log → features    │
              │  · coloured doors + d10s   │   │  · six-attribute model     │
              │  · door capacity / locks   │   │  · k-means clustering      │
              │  · Sanction rooms          │   │  · utility decision maker  │
              │  · A* pathfinding          │   │  · adaptive difficulty     │
              │  · 7 transformation types  │   │  · simulated-team tuning   │
              │  · rule engine (data)      │   └───────────────────────────┘
              │  · knowledge base          │
              │  · CSP puzzle generator    │
              │  · stage progression       │
              └────────────┬───────────────┘
                           │
              ┌────────────▼───────────────┐
              │   Persistence (WP7, SQLite) │
              │  users · matches · stats    │
              │  · Dealer player models     │
              └────────────────────────────┘
```

## Round loop

```
round_start → shift_grid → roll_dice → choose_doors → resolve_lockdowns
→ resolve_sanctions → dealer_action → check_endings → next_round
```

1. **Shift.** Every active pattern engine applies its hidden rule. Rows,
   columns or blocks of rooms move; players ride their room, so `rid` persists
   while the room code changes. A repair pass keeps every room reachable.
2. **Roll.** Every room rolls its four coloured d10s. A roll becomes the number
   of crossings allowed through the matching door this round (capped at four).
   Low rolls force the team to split.
3. **Choose doors.** A doorway is passable only when both rooms have that side
   open. Crossing costs 1 point. You cannot return through the door you came
   from in the same round.
4. **Resolve lockdowns.** A 0-capacity door seals and locks the player who
   tried it. Two helpers in or beside the room can scan them free (`−1` each).
5. **Resolve sanctions.** Entering a hidden Sanction room drains 1–3 points the
   first time it is discovered.
6. **Dealer action.** NEXUS scores `raise_complexity / add_hazard / give_clue /
   lower_dice / shift_information / hold` and may seal a door, seed a Sanction
   room, widen doors, offer a clue or hold.
7. **Check endings.** Points at zero eliminate a player. The team wins when
   every living player is in A5 **and** the final door is unsealed by the
   cooperative cipher. The match ends after 15 rounds or when nobody is left.

## Door semantics

- `arena.door_open(room, d)` requires `room.doors[d]` to be open **and** the
  neighbour's opposite door to be open.
- `arena.consume(room, d)` spends one crossing and returns the remaining
  capacity; `0` remaining is a lockdown.
- Door colours are stable per door; d10 results and capacity reset every round.
- Sealed doors render as a void (black) panel; open doorways reveal the void
  beyond the room.

## Data flow for one round

1. A client sends an intent (`choose_door` / `wait` / `unlock` / `predict` /
   `puzzle_answer`).
2. The server validates it against the arena, door capacity and the rate limit.
3. The server updates the authoritative state and records the event; The Dealer
   ingests it.
4. When the round timer expires, every active pattern engine applies its rule.
5. A time-expanded reachability check confirms the exit is still reachable (O6).
6. The Dealer decides the next action and may raise pressure, seed a Sanction
   room, widen doors or offer a clue.
7. New d10s are rolled, new possible futures are generated, and each client
   receives only the information its role may see (O3).

## Module map

| File | Responsibility |
|---|---|
| `backend/app/arena.py` | 5×5 room matrix, generator, doors, shifts, A*, reachability |
| `backend/app/maze.py` | Backwards-compatible shim re-exporting `arena` |
| `backend/app/fate.py` | d10 rolls, door capacity, possible futures, Sanction reveal |
| `backend/app/patterns.py` | 7 transformation types, rule engine |
| `backend/app/knowledge.py` | Knowledge base (facts/observations) + CSP puzzle generator |
| `backend/app/nexus.py` | The Dealer AI: model, clustering, utility decisions, tuning |
| `backend/app/stages.py` | Seven stage definitions and per-stage rules |
| `backend/app/roles.py` | Navigator/Oracle/Timekeeper/Archivist + per-role filtering |
| `backend/app/game.py` | Rooms, round state machine, points, locks, revives, reconnect |
| `backend/app/db.py` | SQLite schema + repository (users, matches, models) |
| `backend/app/main.py` | FastAPI HTTP API + WebSocket endpoint |
| `frontend/app/page.tsx` | Landing page |
| `frontend/app/lobby/page.tsx` | Lobby / room create & join |
| `frontend/app/login/page.tsx` | Accounts |
| `frontend/app/profile/page.tsx` | Profile, history, leaderboard |
| `frontend/components/GameCanvas.tsx` | Three.js first-person cube room, doors, pedestal, teammates |
| `frontend/components/GameClient.tsx` | HUD: points, doors, futures, locks, cipher, chat |
| `frontend/components/WristbandMap.tsx` | 5×5 wristband map with door-colour edges |
| `frontend/lib/useGameSocket.ts` | WebSocket state machine |
| `frontend/lib/types.ts` | Shared v3 message and entity types |

## AI techniques and where they live

| Technique | Where |
|---|---|
| Informed search (A*) | `arena.py` pathfinding and reachability |
| Procedural generation | seeded spanning-tree rooms + door colours/d10s/sanctions |
| Constraint satisfaction | `knowledge.py` cooperative cipher, solver-verified |
| Knowledge representation | `knowledge.py` facts, observations, hypothesis scoring |
| Pattern recognition | `patterns.py` periodic/sequential rules + prediction scoring |
| Clustering & classification | `nexus.py` k-means over six-attribute player vectors |
| Utility-based decisions | `nexus.py` scores raise complexity / hazard / clue / widen doors / hold |
| Adaptive difficulty | `nexus.py` + `game.py` timing, capacity and hazards |

## Theme and naming

The game is inspired by the final game of *Alice in Borderland* season 3
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

## Palette

Off-white paper `#f4f1ea`, charcoal ink `#14161a`, near-black `#0b0c0e`, door
red `#e23b3b`, blue `#3f7bd9`, yellow `#e8b53a`, green `#3f9f6b`.
The shell pages use the paper palette; the in-game HUD uses charcoal glass over
the white cube room.
