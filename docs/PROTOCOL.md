# AXIOM · THE LAST ROOM protocol (WP1 shared contracts)

All WebSocket messages are JSON over
`ws://HOST:8000/ws/{ROOM}?name={NAME}&pid={PID}`.
`pid` is optional and used for reconnect. The server is authoritative: clients
send intents, never state.

The arena is a **5×5 matrix of white cube rooms** labelled `A1`–`E5`:
`bx` runs A→E (0–4), `by` runs 1→5 (0–4). Players spawn in **C3** `(2,2)` and the
exit is fixed at **A5** `(0,4)`. Rooms carry a persistent identity (`rid`) while
their grid position moves every round; players ride their room.

HTTP API is separate (accounts, profiles, history) — see the bottom of this file.

## Client to server

| type | fields | notes |
|---|---|---|
| `choose_door` | `door` (`N`/`E`/`S`/`W`) or `color` | cross a coloured doorway; costs 1 point; a 0-capacity door triggers a lockdown |
| `choose_gate` | `door` | alias of `choose_door` |
| `move` | `door`, or `dx`,`dy`, or `color` | legacy alias; `dx/dy` is mapped to the matching direction |
| `wait` | none | spends 1 point |
| `unlock` | `target` (player id) | asks the server to scan a locked teammate free; two helpers in or beside the room are required, each spends 1 point |
| `predict` | `pattern_type` (optional), `sigils[]` (optional), `rooms[]` (optional) | scored against the hidden rule; correct delays the shift, wrong hurries it |
| `puzzle_answer` | `choice` (int index into `options`) | cooperative cipher answer; a correct answer unseals the final door |
| `clue_share` | `role`, `text` | broadcast to teammates as a team note |
| `chat` | `text` | team chat |
| `ready` | `value` (bool) | lobby ready toggle; match starts when all connected players are ready |
| `ping` | none | server replies `pong` |

## Server to client

| type | fields | when |
|---|---|---|
| `welcome` | `you`, `state` | to the joining / reconnecting player |
| `state` | `state` | join/leave, lobby change, move/wait/unlock, prediction, puzzle |
| `players` | `status`, `players[]` | after every accepted move / wait / unlock |
| `round` | role-filtered shift + `arena`, `players`, `next_round_in`, `state`, `dice`, `futures`, `puzzle`, `pa` | the grid shifted and new d10s were rolled |
| `door_result` | `accepted`, `locked`, `door`, `color`, `remaining`, `room_code`, `target_code`, `message` | result of a door crossing |
| `lockdown` | `player`, `room_code`, `door`, `message` | a player hit a 0-capacity door and is locked |
| `hazard` | `player`, `room_code`, `penalty`, `points` | a Sanction room drained points |
| `revive` | `player`, `by[]`, `points{}` | two teammates scanned a locked player free |
| `elimination` | `player`, `reason` | points reached zero |
| `prediction_result` | `correct`, `score`, `points`, `message` | after a prediction |
| `puzzle_result` | `correct`, `solved`, `message` | after a cipher answer |
| `exit_unsealed` | `message` | the cooperative cipher opened the final door |
| `team_note` | `from`, `role`, `text` | a teammate shared a clue |
| `team_note_ack` | none | your clue was delivered |
| `chat` | `from`, `color`, `text` | team chat line |
| `game_over` | `won`, `summary`, `nexus` | match ended (stored to the database) |
| `error` | `code`, `message` | e.g. `rate_limited`, `not_adjacent`, `need_two` |

### `state`

```jsonc
{
  "room": "ABCD", "status": "running",
  "round": 3, "max_rounds": 15,
  "stage": 2, "stage_name": "First Shift", "max_stage": 7,
  "arena": { ... }, "players": [ ... ],
  "you": {
    "id": "p1", "room_id": "r12", "room_code": "C3", "room": [2, 2],
    "doors": {
      "N": { "color": "blue", "sealed": false, "open": true, "capacity": 2, "roll": 2 }
    },
    "locked": false, "eliminated": false, "escaped": false,
    "points": 15, "role": "navigator"
  },
  "next_round_in": 12.4, "round_seconds": 22,
  "min_players": 1, "rule_count": 1,
  "nexus": { ... }, "pa": "ROUND 3. THE GRID MOVES.",
  "dice": { ... }, "futures": { ... },
  "puzzle": null, "exit_unsealed": false,
  "role": "oracle", "role_label": "Oracle", "role_hint": "..."
}
```

`status` is `lobby`, `running`, `won` or `over`.
`pattern_type` is one of
`rotation, reflection, translation, symbol, sequential, conditional, compound`.

### `arena`

```jsonc
{
  "size": 5,
  "start_room": [2, 2],          // C3
  "exit_room": [0, 4],           // A5
  "exit_unsealed": false,
  "rooms": [{
    "id": "r12", "code": "C3", "bx": 2, "by": 2,
    "sigil": "spade",             // spade | heart | diamond | club (Oracle/Archivist only)
    "doors": {
      "N": { "color": "red", "sealed": false, "capacity": 3, "roll": 3 }
    },
    "sanction": null,              // hidden until revealed
    "revealed": false,
    "is_exit": false,
    "future": null,                // Oracle only
    "open": { "N": true, "E": false, "S": true, "W": false }
  }]
}
```

Door colours are `red | blue | yellow | green`. A doorway is passable only when
**both** rooms have that side open (`open[d] === true`). A door with
`capacity <= 0` locks the player who tries to cross it until two helpers scan
them free. Returning through the door you came from is blocked for the rest of
the round.

### `players[]`

```jsonc
{
  "id": "p1", "name": "Hiba", "slot": 0, "color": "#e23b3b",
  "role": "navigator", "room_id": "r12", "room_code": "C3", "room": [2, 2],
  "points": 15, "locked": false, "eliminated": false, "escaped": false,
  "ready": false, "connected": true,
  "predictions": 0, "correct": 0, "streak": 0,
  "waits": 0, "revives": 0
}
```

### `dice`

Keyed by room code. Every player receives their own room; the Timekeeper
receives every room.

```jsonc
{
  "C3": {
    "room": "C3", "rid": "r12",
    "doors": {
      "N": { "color": "red", "roll": 3, "capacity": 3 },
      "E": { "color": "green", "roll": 0, "capacity": 0 }
    }
  }
}
```

### `futures` (possible futures)

Keyed by room code. Filtered per role:

| role | receives |
|---|---|
| `oracle` | door `future` (open/sanction/exit/void) + door `color` |
| `navigator` | only `exit`/`void` futures, otherwise `unknown` |
| `timekeeper` | door `capacity` |
| `archivist` | nothing here; the `round` payload carries `previous` (the old arena) |

## Asymmetric information (O3)

The server filters every `round` and `state` per role (see
`backend/app/roles.py`):

| role | sees |
|---|---|
| `navigator` | which rooms moved (positions only) |
| `oracle` | sigils and door colours of moved rooms + the cleanest futures |
| `timekeeper` | d10 rolls, door capacity and timing |
| `archivist` | the previous grid configuration only |

Sigils are stripped from the arena for every role except the Oracle and
Archivist; capacity and rolls are stripped for every role except the Timekeeper.
No client ever receives another role's hidden data, and the hidden rule itself
(`PatternEngine.rule`) is never serialised.

## Economy (server constants)

| Constant | Value |
|---|---|
| `START_POINTS` | 15 |
| `DOOR_COST` | 1 |
| `WAIT_COST` | 1 |
| `REVIVE_COST` | 1 per helper |
| `EXIT_BONUS` | 2 per player on cipher success |
| `MAX_ROUNDS` | 15 |

## HTTP API

| method | path | purpose |
|---|---|---|
| GET | `/health` | liveness + live room/player counts |
| POST | `/api/signup` | create account (PBKDF2-hashed password) |
| POST | `/api/login` | verify credentials |
| GET | `/api/profile/{username}` | The Dealer's attributes, style, aggregate stats |
| GET | `/api/history/{username}` | match history |
| GET | `/api/leaderboard` | top players |
| GET | `/api/stages` | stage definitions |
| GET | `/api/nexus/tune?team_skill=&cycles=` | run a simulated team through The Dealer |
