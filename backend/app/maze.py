"""AXIOM maze engine (WP2).

The maze is a grid of BLOCK x BLOCK tile blocks. Each block has openings
(N/E/S/W) that carve corridors from its centre. Transformations rewrite block
geometry according to a data-defined Rule, so connections appear and disappear
predictably. The starting maze is always solvable, and every state the team must
pass through is checked with a time-expanded reachability search.
"""
from __future__ import annotations

import copy
import heapq
import random
from collections import deque
from dataclasses import dataclass, field

BLOCK = 5  # tiles per block side
N, E, S, W = "N", "E", "S", "W"
STEP = {N: (0, -1), E: (1, 0), S: (0, 1), W: (-1, 0)}  # (dx, dy), y grows downward
OPPOSITE = {N: S, E: W, S: N, W: E}
CLOCKWISE = {N: E, E: S, S: W, W: N}
COUNTER = {v: k for k, v in CLOCKWISE.items()}
SYMBOLS = ("triangle", "circle", "square")
MATERIALS = ("stone", "glass", "rune")  # extra lever for conditional rules

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


@dataclass
class Block:
    openings: set[str]
    symbol: str
    material: str = "stone"
    # transient animation hint for clients (mirror axis / shift direction)
    last_move: dict = field(default_factory=dict)

    def rotate_cw(self) -> None:
        self.openings = {CLOCKWISE[d] for d in self.openings}
        self.last_move = {"kind": "rotate"}

    def rotate_ccw(self) -> None:
        self.openings = {COUNTER[d] for d in self.openings}
        self.last_move = {"kind": "rotate"}

    def mirror(self, axis: str) -> None:
        """axis 'x' flips E<->W, axis 'y' flips N<->S."""
        if axis == "x":
            self.openings = {W if d == E else E if d == W else d for d in self.openings}
        else:
            self.openings = {S if d == N else N if d == S else d for d in self.openings}
        self.last_move = {"kind": "mirror", "axis": axis}

    def reverse(self) -> None:
        """Reverse all openings (180 degree turn)."""
        self.openings = {OPPOSITE[d] for d in self.openings}
        self.last_move = {"kind": "reverse"}

    def tiles(self) -> list[list[bool]]:
        """BLOCK x BLOCK grid indexed [y][x]; True means wall."""
        c = BLOCK // 2
        t = [[True] * BLOCK for _ in range(BLOCK)]
        t[c][c] = False
        for d in self.openings:
            dx, dy = STEP[d]
            for i in range(1, c + 1):
                t[c + dy * i][c + dx * i] = False
        return t

    def clone(self) -> "Block":
        return Block(set(self.openings), self.symbol, self.material)

    def signature(self) -> tuple:
        return tuple(sorted(self.openings))


class Maze:
    def __init__(self, size: int, blocks: list[list[Block]], seed: int):
        self.size = size  # blocks per side
        self.blocks = blocks
        self.seed = seed
        self._tiles: list[list[bool]] | None = None

    # ---- geometry -------------------------------------------------------
    @property
    def tile_size(self) -> int:
        return self.size * BLOCK

    @property
    def start(self) -> tuple[int, int]:
        c = BLOCK // 2
        return (c, c)

    @property
    def exit(self) -> tuple[int, int]:
        last = self.tile_size - BLOCK + BLOCK // 2
        return (last, last)

    def tiles(self) -> list[list[bool]]:
        if self._tiles is None:
            n = self.tile_size
            grid = [[True] * n for _ in range(n)]
            for by, row in enumerate(self.blocks):
                for bx, block in enumerate(row):
                    for y, trow in enumerate(block.tiles()):
                        for x, wall in enumerate(trow):
                            grid[by * BLOCK + y][bx * BLOCK + x] = wall
            self._tiles = grid
        return self._tiles

    def is_open(self, x: int, y: int) -> bool:
        n = self.tile_size
        return 0 <= x < n and 0 <= y < n and not self.tiles()[y][x]

    def nearest_open(self, x: int, y: int) -> tuple[int, int]:
        n = self.tile_size
        seen = {(x, y)}
        q = deque([(x, y)])
        while q:
            cx, cy = q.popleft()
            if self.is_open(cx, cy):
                return (cx, cy)
            for dx, dy in STEP.values():
                nx, ny = cx + dx, cy + dy
                if 0 <= nx < n and 0 <= ny < n and (nx, ny) not in seen:
                    seen.add((nx, ny))
                    q.append((nx, ny))
        return self.start

    def block_at(self, x: int, y: int) -> Block | None:
        bx, by = x // BLOCK, y // BLOCK
        if 0 <= by < self.size and 0 <= bx < self.size:
            return self.blocks[by][bx]
        return None

    # ---- block-level connectivity ----------------------------------------
    def block_connected(self, a: tuple[int, int], b: tuple[int, int]) -> bool:
        """Two adjacent blocks connect only if BOTH open towards each other."""
        bx, by = a
        nx, ny = b
        dx, dy = nx - bx, ny - by
        d = next((k for k, v in STEP.items() if v == (dx, dy)), None)
        if d is None:
            return False
        return d in self.blocks[by][bx].openings and OPPOSITE[d] in self.blocks[ny][nx].openings

    def block_path(self, start: tuple[int, int], goal: tuple[int, int]) -> list[tuple[int, int]]:
        """Shortest path of blocks where both sides open towards each other."""
        if start not in (goal,):
            seen = {start}
            q = deque([(start, [start])])
            while q:
                cur, path = q.popleft()
                if cur == goal:
                    return path
                cx, cy = cur
                for d, (dx, dy) in STEP.items():
                    nb = (cx + dx, cy + dy)
                    if not (0 <= nb[0] < self.size and 0 <= nb[1] < self.size):
                        continue
                    if nb in seen:
                        continue
                    if self.block_connected(cur, nb):
                        seen.add(nb)
                        q.append((nb, path + [nb]))
        return []

    def ensure_corridor(self, path: list[tuple[int, int]]) -> bool:
        """Force the corridors along a block path open so the exit stays reachable.

        Used as the solvability fallback: if a transformation would strand the
        team, the corridor along the last known good path is re-opened rather
        than letting the maze become unwinnable.
        """
        if len(path) < 2:
            return False
        for a, b in zip(path, path[1:]):
            dx, dy = b[0] - a[0], b[1] - a[1]
            d = next((k for k, v in STEP.items() if v == (dx, dy)), None)
            if d is None:
                continue
            self.blocks[a[1]][a[0]].openings.add(d)
            self.blocks[b[1]][b[0]].openings.add(OPPOSITE[d])
        self._tiles = None
        return True

    # ---- search ---------------------------------------------------------
    def path(self, start: tuple[int, int], goal: tuple[int, int]):
        return astar(self, start, goal)

    def solvable(self) -> bool:
        return self.path(self.start, self.exit) is not None

    # ---- serialization --------------------------------------------------
    def to_public(self) -> dict:
        rows = ["".join("#" if w else "." for w in row) for row in self.tiles()]
        blocks = [
            {"bx": bx, "by": by, "symbol": b.symbol, "material": b.material,
             "openings": sorted(b.openings)}
            for by, row in enumerate(self.blocks)
            for bx, b in enumerate(row)
        ]
        return {
            "size": self.size,
            "block": BLOCK,
            "tile_size": self.tile_size,
            "tiles": rows,
            "blocks": blocks,
            "start": list(self.start),
            "exit": list(self.exit),
        }

    def clone(self) -> "Maze":
        return Maze(self.size, [[b.clone() for b in row] for row in self.blocks], self.seed)

    # ---- generation -----------------------------------------------------
    @classmethod
    def generate(cls, size: int = 3, seed: int | None = None, loop_chance: float = 0.2) -> "Maze":
        if seed is None:
            seed = random.randrange(1 << 30)
        rng = random.Random(seed)
        openings: dict[tuple[int, int], set[str]] = {
            (x, y): set() for y in range(size) for x in range(size)
        }
        # Randomised spanning tree (DFS) so the starting maze is always solvable.
        visited = {(0, 0)}
        stack = [(0, 0)]
        while stack:
            x, y = stack[-1]
            options = [
                (d, x + dx, y + dy)
                for d, (dx, dy) in STEP.items()
                if 0 <= x + dx < size and 0 <= y + dy < size and (x + dx, y + dy) not in visited
            ]
            if not options:
                stack.pop()
                continue
            d, nx, ny = rng.choice(options)
            openings[(x, y)].add(d)
            openings[(nx, ny)].add(OPPOSITE[d])
            visited.add((nx, ny))
            stack.append((nx, ny))
        # A few extra links create loops.
        for y in range(size):
            for x in range(size):
                for d in (E, S):
                    dx, dy = STEP[d]
                    nx, ny = x + dx, y + dy
                    if nx < size and ny < size and d not in openings[(x, y)] and rng.random() < loop_chance:
                        openings[(x, y)].add(d)
                        openings[(nx, ny)].add(OPPOSITE[d])
        symbols = [SYMBOLS[i % len(SYMBOLS)] for i in range(size * size)]
        rng.shuffle(symbols)
        materials = [MATERIALS[i % len(MATERIALS)] for i in range(size * size)]
        rng.shuffle(materials)
        blocks = [
            [Block(set(openings[(x, y)]), symbols[y * size + x], materials[y * size + x]) for x in range(size)]
            for y in range(size)
        ]
        return cls(size, blocks, seed)


def astar(maze: Maze, start: tuple[int, int], goal: tuple[int, int]):
    """A* over open tiles with Manhattan heuristic. Returns list of tiles or None."""

    def h(p):
        return abs(p[0] - goal[0]) + abs(p[1] - goal[1])

    heap = [(h(start), 0, start)]
    came: dict = {start: None}
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
        for dx, dy in STEP.values():
            nxt = (cur[0] + dx, cur[1] + dy)
            if not maze.is_open(*nxt):
                continue
            ncost = cost + 1
            if ncost < best.get(nxt, 1 << 30):
                best[nxt] = ncost
                came[nxt] = cur
                heapq.heappush(heap, (ncost + h(nxt), ncost, nxt))
    return None


def reachable_after_changes(maze: Maze, engine, start: tuple[int, int], goal: tuple[int, int],
                            horizon: int) -> bool:
    """Time-expanded reachability: can the team reach the exit within `horizon`
    transitions, moving between states? Used to guarantee solvability (O6).

    `engine` may be a single PatternEngine or a list of them, so the check
    reflects every active rule in a room. The engines are copied first: the
    simulation must not advance the live pattern sequence.
    """
    sim = maze.clone()
    engines = engine if isinstance(engine, (list, tuple)) else [engine]
    sims = [copy.deepcopy(e) for e in engines]
    for _ in range(horizon):
        if sim.path(start, goal) is not None:
            return True
        for e in sims:
            e.apply(sim, announce=False)
    return sim.path(start, goal) is not None
