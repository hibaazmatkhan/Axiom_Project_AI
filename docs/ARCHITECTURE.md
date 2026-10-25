# AXIOM architecture

The server holds the authoritative game state. Clients send only intents; the
server validates them, applies the pattern engine on a timer, asks NEXUS for the
next action, filters information per role and broadcasts.

```
                       ┌─────────────────────────────────────────────┐
                       │                Frontend (Next.js)            │
   Browser ─── HTTP ──▶ │  landing · lobby · login · profile · game    │
                       │  Three.js 3D client · HUD · prediction ·     │
                       │  cooperative puzzle · team chat / notes       │
                       └───────────────┬──────────────────────────────┘
                                       │  WebSocket (intents ↓ / state ↑)
                       ┌───────────────▼──────────────────────────────┐
                       │            Game server (FastAPI/asyncio)       │
                       │  rooms · game loop · transition timer          │
                       │  validation · rate limiting · reconnect        │
                       │  per-role information filtering                │
                       └───────┬───────────────────────────┬───────────┘
                               │                           │
              ┌────────────────▼──────────┐   ┌────────────▼──────────────┐
              │   Maze & pattern engine    │   │        NEXUS AI Director   │
              │   (WP2)                    │   │        (WP6)               │
              │  · 5×5 block maze model    │   │  · event log → features    │
              │  · generator + solvability │   │  · six-attribute model     │
              │  · A* pathfinding          │   │  · k-means clustering      │
              │  · 7 transformation types  │   │  · utility decision maker  │
              │  · rule engine (data)      │   │  · adaptive difficulty     │
              │  · knowledge base          │   │  · simulated-team tuning   │
              │  · CSP puzzle generator    │   └───────────────────────────┘
              │  · stage progression       │
              └────────────┬───────────────┘
                           │
              ┌────────────▼───────────────┐
              │   Persistence (WP7, SQLite) │
              │  users · matches · stats   │
              │  · NEXUS player models     │
              └────────────────────────────┘
```

## Data flow for one tick

1. A client sends an intent (`move` / `predict` / `puzzle_answer`).
2. The server validates it against the maze, the rules and the rate limit.
3. The server updates the authoritative state and records the event; NEXUS ingests it.
4. When the timer expires, every active pattern engine applies its hidden rule.
5. A time-expanded reachability check confirms the exit is still reachable (O6).
6. NEXUS decides the next action and may raise/reset difficulty or adjust timing.
7. Each client receives only the information its role may see (O3).

## Module map

| File | Responsibility |
|---|---|
| `backend/app/maze.py` | Block/maze model, generator, A*, reachability |
| `backend/app/patterns.py` | 7 transformation types, rule engine, 7 pattern types |
| `backend/app/knowledge.py` | Knowledge base (facts/observations) + CSP puzzle generator |
| `backend/app/nexus.py` | AI Director: model, clustering, utility decisions, tuning |
| `backend/app/stages.py` | Six+final stage definitions and per-stage rules |
| `backend/app/roles.py` | Roles and per-role information filtering |
| `backend/app/game.py` | Rooms, game loop, transitions, puzzles, reconnect |
| `backend/app/db.py` | SQLite schema + repository (users, matches, models) |
| `backend/app/main.py` | FastAPI HTTP API + WebSocket endpoint |
| `frontend/app/page.tsx` | Landing page |
| `frontend/app/lobby/page.tsx` | Lobby / room create & join |
| `frontend/app/login/page.tsx` | Accounts |
| `frontend/app/profile/page.tsx` | Profile, history, leaderboard |
| `frontend/components/GameCanvas.tsx` | Three.js scene, avatars, effects |
| `frontend/components/GameClient.tsx` | HUD: role, team, NEXUS, prediction, puzzle, chat |
| `frontend/lib/useGameSocket.ts` | WebSocket state machine |
