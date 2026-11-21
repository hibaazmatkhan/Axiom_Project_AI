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
                        │  wristband map · door animations · futures · │
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
               │  · sealed doors / locks    │   │  · k-means clustering      │
               │  · Sanction rooms          │   │  · utility decision maker  │
               │  · A* pathfinding          │   │  · static/random baselines │
               │  · 7 transformation types  │   │  · adaptive difficulty     │
               │  · rule engine (data)      │   │  · 900-match experiments   │
               │  · knowledge base          │   └───────────────────────────┘

               │  · knowledge base          │
               │  · stage progression       │
              └────────────┬───────────────┘
                           │
               ┌────────────────────────────────┐
                │ Persistence (WP7, Supabase)     │
                │ profiles · matches · stats      │
                │ avatars · audit · RPCs          │
                │ Dealer player models            │
                └────────────────────────────────┘
```

## Deployment

Vercel Services builds `frontend/` and `backend/` into one deployment. Public
`/backend/*` rewrites route to the FastAPI service, which normalizes the prefix
with `BackendPrefixMiddleware`; `/ws/*` routes to the same backend service. The
frontend keeps a local Next.js proxy for `vercel dev` and Docker development; on
Vercel it is bypassed by the
top-level rewrite. The `BACKEND_URL` binding is internal and injected by Vercel.

Rooms are authoritative but process-local. Keep one long-lived backend instance,
and configure Fluid Compute/max duration for WebSocket traffic in the Vercel
dashboard. Before horizontal scaling, move `rooms` to shared state such as Redis
or a pub/sub-backed coordinator. The Render Blueprint keeps `numInstances: 1`
for the same reason. Persistent data is shared through Supabase.

## Round loop


```
round_start → shift_grid → roll_dice → choose_doors → resolve_lockdowns
→ resolve_sanctions → dealer_action → check_endings → next_round
```

1. **Shift.** Every active pattern engine applies its hidden rule. Rows,
   columns or blocks of rooms move; players ride their room, so `rid` persists
   while the room code changes. A repair pass keeps every room reachable.
 2. **Roll.** Every room rolls its four coloured d10s. A roll of `0` or `1`
    seals an otherwise open door; the Dealer's `lower_dice` actuator adds a
    bounded bonus that makes seals less likely.
  3. **Choose doors.** A structural doorway is passable only when both rooms
    have that side open. Opening a door costs 1 point; crossing through the
    active doorway is free. You cannot return through the door you came from in
    the same round.
 4. **Resolve lockdowns.** Two sealed-door clicks in the same round lock the
    player. Two helpers in or beside the room can scan them free (`−1` each).
 5. **Resolve sanctions.** Entering a hidden Sanction room drains its assigned
    penalty the first time it is discovered.
 6. **Dealer action.** The injected `Director` scores `raise_complexity /
    lower_complexity / add_hazard / give_clue / lower_dice / shift_information /
    hold` and may rebuild hidden rules, seal or reopen a door, seed a Sanction
    room, grant dice relief, nudge one role, offer a clue or hold.
    `NexusDirector` uses skill fit, progress, cooperation balance and
    frustration; `StaticDirector` and `RandomDirector` are evaluation baselines.


 7. **Check endings.** Points at zero eliminate a player. The team wins when
    every living player is in the hidden exit room. The match ends after 15
    rounds, when the match timer expires, or when nobody is left.

## Door semantics

- `arena.door_open(room, d)` requires `room.doors[d]` to be open **and** the
  neighbour's opposite door to be open.
- Paying for a doorway creates a temporary ten-second opening; any living
  teammate may cross during that window without another cost.
- Door colours are stable per door; d10 seal states reset every round.
- Sealed doors render like every other coloured door until clicked; open
  doorways reveal the connected room.

## Data flow for one round

 1. A client sends an intent (`open_door` / `cross_door` / `wait` / `unlock` /
    `predict`).
 2. The server validates it against the arena, door seals and the rate limit.

3. The server updates the authoritative state and records the event; The Dealer
   ingests it.
4. When the round timer expires, every active pattern engine applies its rule.
5. A time-expanded reachability check confirms the exit is still reachable (O6).
 6. The Dealer decides the next action and may raise pressure, seed a Sanction
    room, grant dice relief, nudge one role or offer a clue.

7. New d10s are rolled, new possible futures are generated, and each client
   receives only the information its role may see (O3).

## Module map

| File | Responsibility |
|---|---|
| `backend/app/arena.py` | 5×5 room matrix, generator, doors, shifts, A*, reachability |
| `backend/app/maze.py` | Backwards-compatible shim re-exporting `arena` |
| `backend/app/fate.py` | d10 rolls, sealed doors, possible futures, Sanction reveal |
| `backend/app/patterns.py` | 7 transformation types, rule engine |
| `backend/app/knowledge.py` | Knowledge base, CSP puzzle generator/solver and role-private views |
| `backend/app/nexus.py` | The Dealer AI: model, clustering, utility decisions, tuning |
| `backend/app/directors.py` | Director interface, NexusDirector, StaticDirector, RandomDirector |
| `backend/app/simulation.py` | Simulated players, seeded experiment runner, search benchmark |
| `backend/app/experiment_charts.py` | CSV-driven evaluation charts |
| `backend/app/stages.py` | Seven stage definitions and per-stage rules |
| `backend/app/roles.py` | Navigator/Oracle/Timekeeper/Archivist + per-role filtering |
| `backend/app/game.py` | Rooms, round state machine, points, locks, revives, reconnect |
| `backend/app/auth.py` | Firebase ID token, App Check and admin dependency guards |
| `backend/app/audit.py` | Audit log and live room inventory persistence |
| `backend/app/avatar_store.py` | Default symbol PFPs, legacy normalization, avatar validation, Supabase Storage upload and cleanup |
| `backend/app/supabase_store.py` | Profiles, avatars, export and account deletion |
| `backend/app/repositories.py` | Storage abstraction protocols |
| `backend/app/db.py` | Match store selection: Supabase production store with SQLite fallback |
| `backend/app/main.py` | FastAPI HTTP API + WebSocket endpoint |
| `frontend/app/page.tsx` | Landing page |
| `frontend/app/lobby/page.tsx` | Lobby / room create & join with read-only avatar preview |
| `frontend/app/login/page.tsx` | Accounts |
| `frontend/app/profile/page.tsx` | Profile, avatars, history, leaderboard |
| `frontend/components/GameCanvas.tsx` | Three.js first-person cube room, animated doors, physics-like walking/crossing, teammates |
| `frontend/components/GameClient.tsx` | HUD: points, doors, futures, locks, exit notices, chat |
| `frontend/components/WristbandMap.tsx` | 5×5 wristband map with door-colour edges and private sealed-door state |
| `frontend/lib/avatarRules.ts` | Client-side default symbol PFPs, fallback assignment and upload validation |
| `frontend/lib/useGameSocket.ts` | WebSocket state machine |
| `frontend/lib/types.ts` | Shared v3 message and entity types |

## AI techniques and where they live

| Technique | Where |
|---|---|
| Informed search (A*) | `arena.py` pathfinding and reachability |
| Procedural generation | seeded spanning-tree rooms + door colours/d10s/sanctions |
| Knowledge representation | `knowledge.py` facts, observations, hypothesis scoring |
| Pattern recognition | `patterns.py` periodic/sequential rules + prediction scoring |
| Clustering & classification | `nexus.py` deterministic k-means over six-attribute player vectors |
| Constraint satisfaction | `knowledge.py` generated CSP puzzles, backtracking solver and role-private clues |
| Utility-based decisions | `nexus.py` scores skill fit, progress, cooperation balance and frustration |
| Director baselines | `directors.py` Nexus/Static/Random implementations |
| Simulated players | `simulation.py` novice, average and expert policies |
| Experiment runner | `simulation.py` 900 seeded matches, CSV metrics and mean/std summary |
| Evaluation charts | `experiment_charts.py` A*/BFS, difficulty, rule discovery and cluster plots |
| Evaluation report | `docs/NEXUS_Evaluation.md` methodology, retained artifacts and results |
| Adaptive difficulty | `nexus.py` + `game.py` timing, door openings and hazards |

## Theme and naming

The game is an unofficial fan project inspired by the final game of *Alice in
Borderland* season 3 ("Possible Futures"). It uses the broadcast theme and show
roles; the default broadcast faces are five card symbols, with custom images
loaded only from user-supplied assets.

| Show concept | Original name here |
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

## Palette

Off-white paper `#f4f1ea`, charcoal ink `#14161a`, near-black void `#040507`,
door red `#ff4655`, blue `#5aa7ff`, yellow `#f4c542`, green `#58d68d`.
The shell pages use the paper palette; the in-game HUD uses charcoal glass over
the white cube room.
