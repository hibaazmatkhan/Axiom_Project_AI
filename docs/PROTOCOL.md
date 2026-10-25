# AXIOM protocol (WP1 shared contracts)

All WebSocket messages are JSON over `ws://HOST:8000/ws/{ROOM}?name={NAME}&pid={PID}`.
Tile coordinates: `x` right, `y` down. `pid` is optional and used for reconnect.

HTTP API is separate (accounts, profiles, history) — see the bottom of this file.

## Client to server

| type | fields | notes |
|---|---|---|
| `move` | `dx`, `dy` (ints, exactly one ±1) | server validates walls, bounds, cooldown and rate limit |
| `predict` | `pattern_type` (optional), `symbols[]` (optional) | scored against the primary hidden rule |
| `puzzle_answer` | `choice` (int index) | cooperative puzzle answer; server waits for all players |
| `clue_share` | `role`, `text` | broadcast to teammates as a team note |
| `chat` | `text` | team chat |
| `ready` | `value` (bool) | lobby ready toggle; match starts when all connected players are ready |
| `ping` | none | server replies `pong` |

## Server to client

| type | fields | when |
|---|---|---|
| `welcome` | `you`, `state` | to the joining / reconnecting player |
| `state` | `state` | someone joined, left or the lobby changed |
| `players` | `status`, `players[]` | after every accepted move |
| `transition` | role-filtered `moved[]`, plus `maze`, `players`, `next_transition_in`, `state`, `puzzle`, `nexus_message` | the maze just changed |
| `prediction_result` | `correct`, `score`, `message` | after a prediction |
| `puzzle_result` | `correct` | after a puzzle answer |
| `team_note` | `from`, `role`, `text` | a teammate shared a clue |
| `team_note_ack` | none | your clue was delivered |
| `chat` | `from`, `color`, `text` | team chat line |
| `game_over` | `won`, `summary`, `nexus` | match ended (stored to the database) |
| `error` | `code`, `message` | e.g. `room_full`, `rate_limited` |

`state` = `{room, status, cycle, stage, stage_name, max_stage, maze, players,
next_transition_in, transition_seconds, min_players, rule_count, nexus, nexus_message,
puzzle, role, role_label, role_hint}`.

`maze` = `{size, block, tile_size, tiles[] ("#" wall, "." open),
blocks[{bx,by,symbol,material,openings}], start, exit}`.

`status` is `lobby`, `running`, `won` or `over`.
`pattern_type` is one of `rotation, reflection, translation, symbol, sequential, conditional, compound`.

## Asymmetric information (O3)

The server filters every `transition` per role (see `backend/app/roles.py`):

| role | sees |
|---|---|
| `mover` | positions of the blocks that moved |
| `symbolist` | the symbols carried by the moved blocks |
| `chronologist` | timing of the next transition only |
| `archivist` | the previous maze configuration only |

No client ever receives another role's hidden data, and the hidden rule itself
(`Room.engines[*].rule`) is never serialised.

## HTTP API

| method | path | purpose |
|---|---|---|
| GET | `/health` | liveness + live room/player counts |
| POST | `/api/signup` | create account (PBKDF2-hashed password) |
| POST | `/api/login` | verify credentials |
| GET | `/api/profile/{username}` | NEXUS attributes, style, aggregate stats |
| GET | `/api/history/{username}` | match history |
| GET | `/api/leaderboard` | top players |
| GET | `/api/stages` | stage definitions |
| GET | `/api/nexus/tune?team_skill=&cycles=` | run a simulated team through NEXUS |
