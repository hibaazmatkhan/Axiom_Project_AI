# AXIOM · THE LAST ROOM protocol (WP1 shared contracts)

All WebSocket messages are JSON. On Vercel Services the browser connects to the
same origin at `wss://HOST/ws/{ROOM}?name={NAME}&pid={PID}&auth=1`; local
development uses `ws://HOST:8000/ws/{ROOM}?name={NAME}&pid={PID}&auth=1`. `pid` is optional and
used for reconnect. The client must send an `auth` frame immediately after
opening an `auth=1` socket. The server is authoritative: clients send intents,
never state.

The arena is a **5×5 matrix of white cube rooms** labelled `A1`–`E5`:
`bx` runs A→E (0–4), `by` runs 1→5 (0–4). Players spawn in **C3** `(2,2)`.
Each match hides its exit in a randomly selected edge room. The exit coordinate
is omitted from player snapshots; only the player who physically enters it gets
`exit_found`. Rooms carry a persistent identity (`rid`) while their grid
position moves every round; players ride their room.

HTTP API is separate (accounts, profiles, history) — see the bottom of this file.

## Client to server

| type | fields | notes |
|---|---|---|
| `auth` | `token` (nullable), `name`, `pid`, `app_check` (optional) | required first frame when `auth=1`; no token creates a guest identity; `app_check` accepts the Firebase App Check token when enforcement is enabled |
| `open_door` | `door` (`N`/`E`/`S`/`W`) or `color` | pay 1 point and hold the doorway open for 10s |
| `choose_door` | `door` or `color` | alias of `open_door` |
| `choose_gate` | `door` | alias of `open_door` |
| `cross_door` | `door` | walk through an active temporary doorway; no extra cost |
| `move` | `door`, or `dx`,`dy`, or `color` | legacy alias of `open_door`; `dx/dy` is mapped to the matching direction |
| `wait` | none | spends 1 point |
| `unlock` | `target` (player id) | asks the server to scan a locked teammate free; two helpers in or beside the room are required, each spends 1 point |
| `predict` | `pattern_type` (optional), `sigils[]` (optional), `rooms[]` (optional) | scored against the hidden rule; correct delays the shift, wrong hurries it; 2-second per-player cooldown |
| `puzzle_submit` | `assignment` with only the sender's `role` and chosen mark | contributes one role mark to the cooperative CSP puzzle |
| `delay_queue` | `tier` (`1`/`2`/`3`) | Timekeeper only; opens one delay puzzle for the Decoder |
| `delay_answer` | `puzzle_id`, `answer` (cell `{row, col}` or suit) | Decoder only; answers the open delay puzzle |
| `chat` | `text` | team chat |
| `notes` | `text` | shared team notes; aliases: `notes_send` |
| `ready` | `value` (bool) | lobby ready toggle; match starts when all connected players are ready |
| `ping` | none | server replies `pong` |

## Server to client

| type | fields | when |
|---|---|---|
| `welcome` | `you`, `state` | to the joining / reconnecting player |
| `state` | `state` | join/leave, lobby change, open/cross/wait/unlock, prediction |
| `players` | `status`, `players[]` | after every accepted door open / wait / unlock |
| `round` | role-filtered shift + `arena`, `players`, `state`, `futures`, `pa`, `pattern_types`; `sigils` for the Watcher, `previous` for the Decoder, `moved`/`ops` for the Pathfinder, `timing`/`next_round_in` for the Timekeeper | the grid shifted and new d10s were rolled |
| `door_result` | `accepted`, `locked`, `door`, `color`, `room_code`, `target_code`, `cost`, `message` | rejected/locked door intent; private to the acting player |
| `door_opened` | `accepted`, `player`, `door`, `color`, `cost`, `open_until`, `message`; plus `room_code`/`target_code` only for players in either connected room | a paid doorway opened for 10s |
| `door_closed` | `door`, `message`; plus `room_code`/`target_code` only for players in either connected room | the 10s window expired or the grid shifted |
| `room_entered` | `player`, `door`, `from`, `to`, `cost` | a player physically crossed an open doorway |
| `exit_found` | `room_code`, `message` | private to a player who entered the exit or saw it through an active doorway |
| `lockdown` | `player`, `room_code`, `door`, `message` | a player hit a second sealed door in one round and is locked |
| `hazard` | `player`, `room_code`, `penalty`, `points` | a Sanction room drained points |
| `dealer_clue` | `tier`, `text` | private to a living, unlocked player near a hidden Sanction room |
| `dealer_nudge` | `role`, `text`, `puzzle`, `round` | private role-appropriate nudge; never carries another role's puzzle mark |
| `puzzle_result` | `correct`, `attempts`, `points`, `complete`, `marks`, `code`, `message` | result of a role-mark submission |
| `puzzle` | `puzzle_id`, `tier`, `question`, `grids`, `highlight`, `answer_ms` | private delay puzzle question to the Decoder; never carries the key |
| `puzzle_key` | `puzzle_id`, `tier`, `key_text`, `key_cells?` | private delay puzzle key to the Timekeeper; never carries the question |
| `delay_status` | `state`, `cooldown_s`, `attempts_left` | private status to the Timekeeper and Decoder |
| `delay_result` | `ok`, `message`, `delta_s` (Timekeeper only) | result of a delay answer or timeout; no countdown or delta for other roles |
| `revive` | `player`, `by[]`, `points{}` | two teammates scanned a locked player free |
| `elimination` | `player`, `reason` | points reached zero or KING OF SPADES eliminated the player |
| `king_watch` | `id`, `appearance`, `total`, `in_seconds`, `starts_at`, `room_code`, `room` | private 30-second Watcher alert with only that session's first room |
| `king_spawn` | `king` | non-player KING OF SPADES appeared for a 180s window; not sent to the Watcher |
| `king_teleport` | `king` | KING OF SPADES moved to the next of five rooms; hidden from the Watcher |
| `king_despawn` | `id`, `appearance`, `king` | KING OF SPADES window ended or match finished; hidden from the Watcher |
| `king_kill` | `id`, `appearance`, `victim`, `victim_name`, `room_code`, `room`, `reason` | KING OF SPADES eliminated a player; hidden from the Watcher |
| `prediction_result` | `correct`, `score`, `points`, `message` | after a prediction |
| `time_up` | `message` | match timer expired; living players were eliminated |
| `chat` | `from`, `color`, `text` | team chat line |
| `notes` | `id`, `from`, `color`, `text` | shared team note; the last 40 are replayed in `state.notes` |
| `game_over` | `won`, `summary`, `nexus` | match ended (stored to the database) |
| `error` | `code`, `message` | advisory: `rate_limited`, `not_adjacent`, `need_two`, `prediction_cooldown`, `internal`; fatal: `invalid_username`, `username_taken`, `profile_unavailable`, `app_check_invalid`, `app_check_unavailable`, `room_not_found`, `auth_*` |

### `state`

```jsonc
{
  "room": "ABCD", "status": "running",
  "round": 3, "max_rounds": 0,
  "stage": 2, "stage_name": "First Shift", "max_stage": 7,
  "arena": { ... }, "wristband": { ... }, "players": [ ... ],
  "you": {
    "id": "p1", "room_id": "r12", "room_code": "C3", "room": [2, 2],
    "doors": {
      "N": { "color": "blue", "open": true, "temporary_open": true, "open_until": 1730000000.0 }
    },
    "locked": false, "eliminated": false, "escaped": false,
    "exit_found": false, "exit_code": null,
    "points": 25, "role": "decoder",
    "wristband_revealed": false, "wristband_cooldown_remaining": 0,
    "prediction_cooldown_remaining": 0
  },
  "next_round_in": null, "round_seconds": 22,
  "match_time_left": 1654.2, "match_seconds": 1800,
  "min_players": 1, "rule_count": 1,
  "sanction_total": 7, "sanction_found": 0,
  "nexus": { ... }, "pa": "ROUND 3. THE GRID MOVES.",
  "notes": [{ "id": 1, "from": "P1", "color": "#fff", "text": "check C3" }],
  "king": null,
  "king_watch": null,
  "futures": { ... },
  "delay_status": { "state": "idle", "cooldown_s": 0, "attempts_left": 2 },
  "dice_relief_rounds": 0,
  "puzzle": {
    "public": { "difficulty": "easy", "complexity": 1, "attempts": 0, "solved": false, "marks": 0 },
    "you": { "role": "watcher", "domain": ["spade", "club"], "clues": ["..."], "mark": null }
  },
  "role": "watcher", "role_label": "Watcher", "role_hint": "..."
}
```

`status` is `lobby`, `running`, `won` or `over`.
`max_rounds: 0` means the match ends on its 1800-second timer rather than a round
cap. `state.king` is the currently active KING OF SPADES appearance, or `null`
between appearances. The KING is not a player role and is never assigned to a
player; five 180-second appearances begin at 120/420/720/1020/1320 seconds and
each visits five non-exit rooms before the next appearance. `state.king_watch` is the current
private Watcher alert, or `null`; the Watcher snapshot omits `state.king` and
never receives KING spawn, teleport, despawn or kill events.
`next_round_in` is populated only for the Timekeeper; every other role receives
`null`. `delay_status` is sent only to the Timekeeper and Decoder. No player
snapshot contains dice data.
`pattern_type` is one of
`rotation, reflection, translation, symbol, sequential, conditional, compound`;
`pattern_types` carries every active rule type for multi-rule stages.
`sanction_total` and `sanction_found` are counts only. Unrevealed Sanction rooms
stay `sanction: null` and `revealed: false`; no room id, code or location is sent
for them.

`dealer_clue` is private to the player it was sent to. `tier: 1` is a vague clue
for a hidden Sanction two doorways away; `tier: 2` is a clearer clue for one
doorway away. Clues never include a direction, colour, room code or room count.

`state.puzzle.you` contains only the player's own role, domain and constraint
descriptions. `puzzle_submit` accepts only that role's chosen mark; the server
combines the four role marks, validates them against the CSP and rewards the
contributors once. `dealer_nudge` is a private role-appropriate hint and never
includes another role's mark or the full solution.

### `arena`

```jsonc
{
  "size": 5,
  "start_room": [2, 2],          // C3
  "rooms": [{
    "id": "r12", "code": "C3", "bx": 2, "by": 2,
    "sigil": "spade",             // spade | heart | diamond | club (never sent to players)
    "doors": {
      "N": { "color": "red", "temporary_open": false, "open_until": null }
    },
    "sanction": null,              // hidden until revealed
    "revealed": false,
    "future": null,                // never sent to players
    "open": { "N": true, "E": false, "S": true, "W": false }
  }]
}
```

### `wristband`

```jsonc
{
  "C3": { "N": true, "E": false, "S": false, "W": true }
}
```

`wristband` is the player-visible source of structural doorway passability;
`true` means that doorway is blocked by a wall. D10 seals are not shown in the
wristband or in `arena.rooms[].doors`/`you.doors`; all doors look coloured and
locked in the 3D arena. Clicking a sealed door returns `door_result` with
`accepted: false` and `message: "That door is sealed."`; a second sealed click
in the same room during the same shift locks the player until two teammates
scan them free.

Admin observer snapshots (`admin_state`) add `exit_room`, `exit_rid` and
per-room `is_exit`; player snapshots never include those fields. A player learns
the exit through `exit_found` when they enter it or when an active temporary
doorway connects their room to it. The team wins when every living player is in
the exit room.

Door colours are `red | blue | yellow | green`. A structural doorway is passable
only when **both** rooms have that side open (`open[d] === true`). Paying for a
doorway sets `temporary_open = true` and `open_until` for 10 seconds; any living
teammate may send `cross_door` during that window without another cost. Two
sealed-door clicks in the same room during the same round lock the player until
two helpers scan them free. Returning through the door you came from is blocked
for the rest of the round.

### `players[]`

```jsonc
{
  "id": "p1", "name": "Hiba", "slot": 0, "color": "#ff4655",
  "role": "decoder", "room_id": "r12", "room_code": "C3", "room": [2, 2],
  "points": 25, "locked": false, "eliminated": false, "escaped": false,
  "ready": false, "connected": true,
  "predictions": 0, "correct": 0, "streak": 0,
  "waits": 0, "revives": 0
}
```

### Delay puzzle

The Timekeeper and Decoder solve one cooperative puzzle during a shift. The
server config is the single source for all values: answer windows `12/15/18s`,
success `+6/+12/+18s`, failure `-3/-6/-9s`, cooldown `30s`, `2` attempts per
stage, maximum applied delay `+18s`, second success `0.5x`, shift bounds
`18..45s`, penalty floor `3s` before the pending shift.

The Timekeeper sends `delay_queue {tier}`; the server sends `puzzle` to the
Decoder and `puzzle_key` to the Timekeeper. The Decoder sends exactly one
`delay_answer {puzzle_id, answer}`. The server applies the resulting delta to
the pending shift deadline, starts cooldown, then sends `delay_result`. If the
shift fires first, the puzzle is cancelled without penalty, attempt or cooldown.
If either role is dead or disconnected, `delay_queue` is rejected with
`delay_pair_unavailable`; there is no fallback.

`delay_result.delta_s` goes only to the Timekeeper. The Decoder and all other
roles receive only `ok` and a Dealer message; they never receive countdown,
delta, or the other role's payload.

### `futures` (possible futures)

Keyed by room code. Filtered per role:

| role | receives |
|---|---|
| `pathfinder` | only `exit`/`void` futures, otherwise `unknown` |
| `watcher` | nothing here; KING first-room warnings arrive separately |
| `timekeeper` | nothing here; the delay key and countdown arrive separately |
| `decoder` | nothing here; the delay question arrives separately |

## Asymmetric information (O3)

The server filters every `round` and `state` per role (see
`backend/app/roles.py`):

| role | sees |
|---|---|
| `pathfinder` | which rooms moved (positions only); `pathfinder_reveal` exposes blocked walls and sanction rooms until the next shift |
| `watcher` | 30-second warning before each KING session: time remaining and first room only; sigils attached to moved rooms; no active KING state and no teleport rooms |
| `timekeeper` | the countdown and the delay puzzle key, never the puzzle question |
| `decoder` | the delay puzzle question and the previous filtered layout, never the key or countdown |

The `wristband` is neutral by default: every door reads unsealed and no
sanction room is listed. A Pathfinder may send `{ "type": "pathfinder_reveal" }`
once per shift while the match is running. The server answers with
`wristband_reveal`; the reveal lasts until `step_round()` shifts the grid. At
that shift the Pathfinder enters a 120-second cooldown. Hidden sanction room
codes are only included as `wristband_sanctions` for an active reveal.
`you.wristband_revealed` and `you.wristband_cooldown_remaining` expose that
state; d10 `rolled_sealed` values are still never serialised.

Sigils are stripped from the arena for every role; hidden d10 seal results are
never serialised to any player. Active KING position and teleport events are
stripped from the Watcher, which receives only the private first-room warning.
No client ever receives another role's hidden data, and the hidden rule itself
(`PatternEngine.rule`) is never serialised.

## Economy (server constants)

| Constant | Value |
|---|---|
| `START_POINTS` | 25 |
| `DOOR_COST` | 1 |
| `WAIT_COST` | 1 |
| `REVIVE_COST` | 1 per helper |
| `DEFAULT_MATCH_SECONDS` | 1800 |
| `MAX_ROUNDS` | 0 (no round cap) |
| `KING_APPEARANCES` | 5 |
| `KING_APPEARANCE_SECONDS` | 180 |
| `KING_APPEARANCE_INTERVAL` | 300 |
| `KING_FIRST_SPAWN_SECONDS` | 120 |
| `KING_WATCH_LEAD_SECONDS` | 30 |
| `KING_ROOMS_PER_APPEARANCE` | 5 |

## HTTP API

Browser HTTP calls use the `/backend` prefix (for example `/backend/health`).
On Vercel Services, the root `vercel.json` rewrites `/backend/:path*` to the
FastAPI service; `BackendPrefixMiddleware` strips the prefix before routing.
WebSocket games use the same origin (`wss://.../ws/<room>`) and the root rewrite
routes `/ws/*` to the same backend service. Local development can use the Next.js
proxy with `BACKEND_URL` and `WS_URL`, or FastAPI on port 8000 directly.
Firebase ID tokens are sent as `Authorization: Bearer <token>`; only endpoints
marked public omit auth.

| method | path | purpose |
|---|---|---|
| GET | `/health` | public liveness + live room/player counts |
| GET | `/api/me` | create/read the caller's Supabase profile and stats |
| PUT | `/api/me/profile` | update username and display name |
| PUT | `/api/me/avatar/preset` | select a default symbol PFP (`joker`, `spade`, `club`, `heart`, `diamond`) |
| POST | `/api/me/avatar/upload` | upload a PNG/JPEG/WEBP avatar up to 5 MB; server crops it to a square PNG |
| DELETE | `/api/me/avatar` | clear the custom avatar, remove uploaded storage and restore the default symbol |
| POST | `/api/me/mfa` | update optional MFA flag |
| GET | `/api/me/history?limit=` | verified caller's match history |
| GET | `/api/me/export` | current user's account data export |
| DELETE | `/api/me` | current user's account deletion |
| GET | `/api/leaderboard?limit=` | public top players |
| GET | `/api/stages` | public stage definitions |
| GET | `/api/nexus/tune?team_skill=&cycles=` | public simulated-team tuning |
| GET | `/api/admin/rooms` | administrator-only room inventory |
| POST | `/api/admin/revoke/{uid}` | administrator-only token revocation |

Players without a custom upload or chosen preset receive a deterministic default
symbol from `joker`, `spade`, `club`, `heart` and `diamond`. Guests receive the
same default symbol treatment from their stable client id. Legacy character
avatar URLs are normalized to the matching suit symbol for display only.
