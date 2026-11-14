"""THE LAST ROOM arena: a 5x5 matrix of white cube rooms.

Each room is a 6x6m cube with four coloured doors (red, blue, yellow, green)
and a central pedestal holding four coloured d10s. The grid is labelled
A1-E5; the team spawns in C3 and the exit is fixed at A5.

The grid itself moves: hidden pattern rules slide rows, rotate sub-grids,
reflect lines or swap rooms carrying the same sigil. Players ride their room,
so the wristband map must be re-read every round.

Connectivity is a room graph. A doorway is passable only when both rooms have
that door open; some doors are sealed (void). A* over the room graph is used by
the Navigator and by the director to keep the exit reachable.
"""
from __future__ import annotations

import heapq
import random
from collections import deque
from dataclasses import asdict, dataclass, field

SIZE = 5
N, E, S, W = "N", "E", "S", "W"
DIRECTIONS = (N, E, S, W)
STEP = {N: (0, -1), E: (1, 0), S: (0, 1), W: (-1, 0)}  # (dx, dy), y grows downward
OPPOSITE = {N: S, E: W, S: N, W: E}
CLOCKWISE = {N: E, E: S, S: W, W: N}
COUNTER = {v: k for k, v in CLOCKWISE.items()}

DOOR_COLORS = ("red", "blue", "yellow", "green")
SIGILS = ("spade", "heart", "diamond", "club")

# The seven transformation types from the proposal.
PATTERN_TYPES = (
    "rotation",
    "reflection",
    "translation",
    "symbol",
    "sequential",
    "conditional",
    "compound",
)

START_ROOM = (2, 2)  # C3
EXIT_ROOM = (0, 4)   # A5


def room_code(bx: int, by: int) -> str:
    """A1..E5 from a grid position."""
    return f"{chr(ord('A') + bx)}{by + 1}"


def code_to_pos(code: str) -> tuple[int, int] | None:
    code = (code or "").strip().upper()
    if len(code) != 2 or not ("A" <= code[0] <= "E") or not ("1" <= code[1] <= "5"):
        return None
    return (ord(code[0]) - ord("A"), int(code[1]) - 1)


@dataclass
class Door:
    color: str
    sealed: bool = False
    capacity: int = 0
    last_roll: int = 0

    def clone(self) -> "Door":
        return Door(self.color, self.sealed, self.capacity, self.last_roll)

    def public(self) -> dict:
        return {
            "color": self.color,
            "sealed": self.sealed,
            "capacity": self.capacity,
            "roll": self.last_roll,
        }


@dataclass
class Room:
    """One white cube room. Identity (rid) persists while its grid position moves."""

    rid: str
    bx: int
    by: int
    doors: dict[str, Door] = field(default_factory=dict)
    sigil: str = "spade"
    sanction: int = 0
    revealed: bool = False
    future: str = "open"
    last_move: dict = field(default_factory=dict)

    @property
    def code(self) -> str:
        return room_code(self.bx, self.by)

    @property
    def is_exit(self) -> bool:
        return (self.bx, self.by) == EXIT_ROOM

    def open_directions(self) -> list[str]:
        return [d for d in DIRECTIONS if not self.doors[d].sealed]

    def clone(self) -> "Room":
        return Room(
            self.rid,
            self.bx,
            self.by,
            {d: door.clone() for d, door in self.doors.items()},
            self.sigil,
            self.sanction,
            self.revealed,
            self.future,
            dict(self.last_move),
        )

    def public(self) -> dict:
        return {
            "id": self.rid,
            "code": self.code,
            "bx": self.bx,
            "by": self.by,
            "sigil": self.sigil,
            "doors": {d: self.doors[d].public() for d in DIRECTIONS},
            "sanction": self.sanction if self.revealed else None,
            "revealed": self.revealed,
            "is_exit": self.is_exit,
            "future": self.future,
        }

    def signature(self) -> tuple:
        return (self.rid, self.bx, self.by,
                tuple(d for d in DIRECTIONS if not self.doors[d].sealed))


@dataclass
class Shift:
    """One grid transformation. Applied by Arena.apply_shift."""

    kind: str  # row | col | rotate | reflect | swap_sigil | none
    index: int = 0
    direction: int = 1
    cx: int = 1
    cy: int = 1
    size: int = 3
    axis: str = "x"
    a: str | None = None
    b: str | None = None

    def as_dict(self) -> dict:
        return asdict(self)


class Arena:
    def __init__(self, size: int, grid: list[list[Room]], seed: int):
        self.size = size
        self.grid = grid
        self.seed = seed
        self.exit_unsealed = False
        self.shift_history: list[dict] = []

    # ---- accessors -------------------------------------------------------
    @property
    def rooms(self) -> list[Room]:
        return [room for row in self.grid for room in row]

    def room_at(self, bx: int, by: int) -> Room | None:
        if 0 <= by < self.size and 0 <= bx < self.size:
            return self.grid[by][bx]
        return None

    def room_by_id(self, rid: str) -> Room | None:
        return next((r for r in self.rooms if r.rid == rid), None)

    def room_by_code(self, code: str) -> Room | None:
        pos = code_to_pos(code)
        return self.room_at(*pos) if pos else None

    def start_room(self) -> Room:
        return self.room_at(*START_ROOM)

    def exit_room(self) -> Room:
        return self.room_at(*EXIT_ROOM)

    # ---- doorway / connectivity -----------------------------------------
    def door_open(self, room: Room, d: str) -> bool:
        """A doorway is passable only when both sides are open."""
        if room is None or d not in room.doors or room.doors[d].sealed:
            return False
        dx, dy = STEP[d]
        nb = self.room_at(room.bx + dx, room.by + dy)
        if nb is None:
            return False
        return not nb.doors[OPPOSITE[d]].sealed

    def door_target(self, room: Room, d: str) -> Room | None:
        if not self.door_open(room, d):
            return None
        dx, dy = STEP[d]
        return self.room_at(room.bx + dx, room.by + dy)

    def neighbours(self, room: Room) -> list[tuple[str, Room]]:
        out = []
        for d in DIRECTIONS:
            nb = self.door_target(room, d)
            if nb is not None:
                out.append((d, nb))
        return out

    def consume(self, room: Room, d: str) -> tuple[bool, int]:
        """Spend one crossing of a door. Returns (accepted, remaining)."""
        if not self.door_open(room, d):
            return False, 0
        door = room.doors[d]
        if door.capacity <= 0:
            return False, 0
        door.capacity -= 1
        return True, door.capacity

    # ---- search ----------------------------------------------------------
    def path_positions(self, start: tuple[int, int],
                       goal: tuple[int, int]) -> list[tuple[int, int]] | None:
        return astar(self, start, goal)

    def path(self, start_room: Room, goal_room: Room) -> list[tuple[int, int]] | None:
        return astar(self, (start_room.bx, start_room.by), (goal_room.bx, goal_room.by))

    def solvable(self) -> bool:
        return self.path(self.start_room(), self.exit_room()) is not None

    def connected(self) -> bool:
        return len(self._component(self.start_room())) == len(self.rooms)

    def _component(self, start: Room) -> set[str]:
        seen = {start.rid}
        q = deque([start])
        while q:
            room = q.popleft()
            for _, nb in self.neighbours(room):
                if nb.rid not in seen:
                    seen.add(nb.rid)
                    q.append(nb)
        return seen

    def ensure_connected(self) -> list[dict]:
        """Unseal doors until every room is reachable from the start room."""
        repairs: list[dict] = []
        while True:
            seen = self._component(self.start_room())
            if len(seen) == len(self.rooms):
                break
            fixed = False
            for room in self.rooms:
                if room.rid not in seen:
                    continue
                for d, (dx, dy) in STEP.items():
                    nb = self.room_at(room.bx + dx, room.by + dy)
                    if nb is None or nb.rid in seen:
                        continue
                    if room.doors[d].sealed or nb.doors[OPPOSITE[d]].sealed:
                        room.doors[d].sealed = False
                        nb.doors[OPPOSITE[d]].sealed = False
                        repairs.append({
                            "room": room.code,
                            "door": d,
                            "color": room.doors[d].color,
                            "to": nb.code,
                        })
                        fixed = True
                        break
                if fixed:
                    break
            if not fixed:
                break
        return repairs

    # ---- transformations -------------------------------------------------
    def apply_shift(self, op: Shift) -> list[dict]:
        before = {room.rid: (room.bx, room.by) for room in self.rooms}
        if op.kind == "row":
            self._shift_row(op.index % self.size, op.direction)
        elif op.kind == "col":
            self._shift_col(op.index % self.size, op.direction)
        elif op.kind == "rotate":
            self._rotate_block(op.cx, op.cy, op.size, op.direction)
        elif op.kind == "reflect":
            self._reflect(op.axis, op.index % self.size)
        elif op.kind == "swap_sigil":
            self._swap_sigil(op.a, op.b)

        moved = []
        for room in self.rooms:
            old = before.get(room.rid)
            if old is not None and old != (room.bx, room.by):
                moved.append({
                    "rid": room.rid,
                    "from": [old[0], old[1]],
                    "to": [room.bx, room.by],
                    "code_from": room_code(*old),
                    "code_to": room.code,
                    "sigil": room.sigil,
                })
        return moved

    def _shift_row(self, y: int, direction: int) -> None:
        row = self.grid[y]
        row = (row[-1:] + row[:-1]) if direction >= 0 else (row[1:] + row[:1])
        self.grid[y] = row
        for x, room in enumerate(row):
            room.bx, room.by = x, y

    def _shift_col(self, x: int, direction: int) -> None:
        col = [self.grid[y][x] for y in range(self.size)]
        col = (col[-1:] + col[:-1]) if direction >= 0 else (col[1:] + col[:1])
        for y, room in enumerate(col):
            self.grid[y][x] = room
            room.bx, room.by = x, y

    def _rotate_block(self, cx: int, cy: int, size: int, direction: int) -> None:
        k = max(2, min(size, self.size))
        cx = max(0, min(cx, self.size - k))
        cy = max(0, min(cy, self.size - k))
        block = [[self.grid[cy + j][cx + i] for i in range(k)] for j in range(k)]
        if direction >= 0:
            new = [list(row) for row in zip(*block[::-1])]
        else:
            new = [list(row) for row in zip(*block)][::-1]
        for j in range(k):
            for i in range(k):
                room = new[j][i]
                self.grid[cy + j][cx + i] = room
                room.bx, room.by = cx + i, cy + j

    def _reflect(self, axis: str, index: int) -> None:
        if axis == "x":
            row = list(reversed(self.grid[index]))
            self.grid[index] = row
            for x, room in enumerate(row):
                room.bx, room.by = x, index
        else:
            col = [self.grid[y][index] for y in range(self.size)]
            col.reverse()
            for y, room in enumerate(col):
                self.grid[y][index] = room
                room.bx, room.by = index, y

    def _swap_sigil(self, a: str | None, b: str | None) -> None:
        if not a or not b or a == b:
            return
        left = [r for r in self.rooms if r.sigil == a]
        right = [r for r in self.rooms if r.sigil == b]
        for ra, rb in zip(left, right):
            pa, pb = (ra.bx, ra.by), (rb.bx, rb.by)
            if pa == pb:
                continue
            self.grid[pa[1]][pa[0]], self.grid[pb[1]][pb[0]] = rb, ra
            ra.bx, ra.by = pb
            rb.bx, rb.by = pa

    # ---- serialization ---------------------------------------------------
    def to_public(self) -> dict:
        rooms = []
        for room in self.rooms:
            pub = room.public()
            pub["open"] = {d: self.door_open(room, d) for d in DIRECTIONS}
            rooms.append(pub)
        return {
            "size": self.size,
            "start_room": list(START_ROOM),
            "exit_room": list(EXIT_ROOM),
            "exit_unsealed": self.exit_unsealed,
            "rooms": rooms,
        }

    def clone(self) -> "Arena":
        grid = [[room.clone() for room in row] for row in self.grid]
        clone = Arena(self.size, grid, self.seed)
        clone.exit_unsealed = self.exit_unsealed
        return clone

    # ---- generation ------------------------------------------------------
    @classmethod
    def generate(cls, size: int = SIZE, seed: int | None = None,
                 loop_chance: float = 0.38) -> "Arena":
        if seed is None:
            seed = random.randrange(1 << 30)
        rng = random.Random(seed)

        # Randomised spanning tree so every room starts reachable.
        open_edges: set[frozenset] = set()
        visited = {(0, 0)}
        stack = [(0, 0)]
        while stack:
            x, y = stack[-1]
            options = [
                (nx, ny)
                for nx, ny in (
                    (x + dx, y + dy) for dx, dy in STEP.values()
                )
                if 0 <= nx < size and 0 <= ny < size and (nx, ny) not in visited
            ]
            if not options:
                stack.pop()
                continue
            nx, ny = rng.choice(options)
            open_edges.add(frozenset({(x, y), (nx, ny)}))
            visited.add((nx, ny))
            stack.append((nx, ny))

        # Extra links create loops and alternate routes.
        for y in range(size):
            for x in range(size):
                for dx, dy in ((1, 0), (0, 1)):
                    nx, ny = x + dx, y + dy
                    if nx >= size or ny >= size:
                        continue
                    edge = frozenset({(x, y), (nx, ny)})
                    if edge not in open_edges and rng.random() < loop_chance:
                        open_edges.add(edge)

        rooms: list[list[Room]] = []
        for y in range(size):
            row: list[Room] = []
            for x in range(size):
                colors = list(DOOR_COLORS)
                rng.shuffle(colors)
                doors = {d: Door(color=colors[i]) for i, d in enumerate(DIRECTIONS)}
                for d, (dx, dy) in STEP.items():
                    nx, ny = x + dx, y + dy
                    if not (0 <= nx < size and 0 <= ny < size):
                        doors[d].sealed = True
                    else:
                        doors[d].sealed = frozenset({(x, y), (nx, ny)}) not in open_edges
                row.append(Room(f"r{y * size + x}", x, y, doors))
            rooms.append(row)

        sigils = [SIGILS[i % len(SIGILS)] for i in range(size * size)]
        rng.shuffle(sigils)
        for i, room in enumerate(room for row in rooms for room in row):
            room.sigil = sigils[i]

        # Hidden Sanction rooms: never the start, the exit, or their neighbours.
        protected = {START_ROOM, EXIT_ROOM}
        for px, py in list(protected):
            for dx, dy in STEP.values():
                protected.add((px + dx, py + dy))
        candidates = [
            (x, y)
            for y in range(size)
            for x in range(size)
            if (x, y) not in protected
        ]
        rng.shuffle(candidates)
        for i, (x, y) in enumerate(candidates[:7]):
            rooms[y][x].sanction = rng.choice([1, 1, 2, 3]) if i < 5 else rng.choice([4, 5, 6, 8])

        arena = cls(size, rooms, seed)
        arena.ensure_connected()
        return arena


def astar(arena: Arena, start: tuple[int, int],
          goal: tuple[int, int]) -> list[tuple[int, int]] | None:
    """A* over the room graph with a Manhattan heuristic."""

    def h(p: tuple[int, int]) -> int:
        return abs(p[0] - goal[0]) + abs(p[1] - goal[1])

    heap = [(h(start), 0, start)]
    came: dict[tuple[int, int], tuple[int, int] | None] = {start: None}
    best = {start: 0}
    while heap:
        _, cost, cur = heapq.heappop(heap)
        if cur == goal:
            out = []
            while cur is not None:
                out.append(cur)
                cur = came[cur]
            return out[::-1]
        if cost > best[cur]:
            continue
        room = arena.room_at(*cur)
        if room is None:
            continue
        for d, (dx, dy) in STEP.items():
            if not arena.door_open(room, d):
                continue
            nxt = (cur[0] + dx, cur[1] + dy)
            if arena.room_at(*nxt) is None:
                continue
            ncost = cost + 1
            if ncost < best.get(nxt, 1 << 30):
                best[nxt] = ncost
                came[nxt] = cur
                heapq.heappush(heap, (ncost + h(nxt), ncost, nxt))
    return None


def reachable_after_changes(arena: Arena, engine, start: tuple[int, int],
                            goal: tuple[int, int], horizon: int) -> bool:
    """Time-expanded reachability across grid shifts.

    The arena and engines are copied first: the simulation must not advance the
    live pattern sequence.
    """
    import copy

    sim = arena.clone()
    engines = engine if isinstance(engine, (list, tuple)) else [engine]
    sims = [copy.deepcopy(e) for e in engines]
    for _ in range(horizon + 1):
        if sim.path_positions(start, goal) is not None:
            return True
        for e in sims:
            e.apply(sim, announce=False)
    return sim.path_positions(start, goal) is not None
