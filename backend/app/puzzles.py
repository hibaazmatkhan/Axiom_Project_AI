import random
from itertools import product

SUITS = ("spade", "heart", "diamond", "club")
DIRECTIONS = {
    "UP": (-1, 0),
    "DOWN": (1, 0),
    "LEFT": (0, -1),
    "RIGHT": (0, 1),
}


def _cell(row, col):
    return {"row": row, "col": col}


def _answer_key(value):
    if isinstance(value, dict) and "row" in value and "col" in value:
        return f"{int(value['row'])},{int(value['col'])}"
    return str(value)


def _move(cell, direction):
    dr, dc = DIRECTIONS[direction]
    row, col = cell["row"] + dr, cell["col"] + dc
    if not (0 <= row < 3 and 0 <= col < 3):
        return None
    return _cell(row, col)


def _changed_cells(before, after):
    return [
        _cell(row, col)
        for row in range(3) for col in range(3)
        if before[row][col] != after[row][col]
    ]


def _tier_one(rng):
    before = [[rng.choice(SUITS) for _ in range(3)] for _ in range(3)]
    after = [row[:] for row in before]
    first = (rng.randrange(3), rng.randrange(3))
    second = (rng.randrange(3), rng.randrange(3))
    while second == first:
        second = (rng.randrange(3), rng.randrange(3))
    first_suits = [suit for suit in SUITS if suit != before[first[0]][first[1]]]
    first_suit = rng.choice(first_suits)
    second_suits = [
        suit for suit in SUITS
        if suit != before[second[0]][second[1]] and suit != first_suit
    ]
    second_suit = rng.choice(second_suits)
    after[first[0]][first[1]] = first_suit
    after[second[0]][second[1]] = second_suit
    answer = _cell(*first)
    return {
        "question": "Which tile changed?",
        "grids": {"before": before, "after": after},
        "highlight": None,
        "key_text": f"The tile that became {first_suit}.",
        "key_suit": first_suit,
        "answer": answer,
    }


def _tier_two(rng):
    grid = [[rng.choice(SUITS) for _ in range(3)] for _ in range(3)]
    valid_starts = [
        _cell(row, col)
        for row in range(3) for col in range(3)
        if sum(_move(_cell(row, col), d) is not None for d in DIRECTIONS) >= 2
    ]
    highlight = rng.choice(valid_starts)
    valid_directions = [d for d in DIRECTIONS if _move(highlight, d) is not None]
    direction = rng.choice(valid_directions)
    return {
        "question": "Where does it end up?",
        "grids": {"before": grid},
        "highlight": highlight,
        "key_text": f"Everything moves one step {direction}.",
        "key_direction": direction,
        "answer": _move(highlight, direction),
    }


def _latin_square(rng):
    rows = list(range(4))
    cols = list(range(4))
    suits = list(SUITS)
    rng.shuffle(rows)
    rng.shuffle(cols)
    rng.shuffle(suits)
    return [[suits[(rows[row] + cols[col]) % 4] for col in range(4)] for row in range(4)]


def _latin_candidates(given, target):
    candidates = []
    for suit in SUITS:
        trial = dict(given)
        trial[target] = suit
        if _latin_completable(trial):
            candidates.append(suit)
    return candidates


def _latin_completable(given):
    grid = [[given.get((row, col)) for col in range(4)] for row in range(4)]
    row_used = [set(value for value in row if value) for row in grid]
    col_used = [set(grid[row][col] for row in range(4) if grid[row][col]) for col in range(4)]

    def fill():
        empty = None
        for row, col in product(range(4), range(4)):
            if grid[row][col] is None:
                empty = (row, col)
                break
        if empty is None:
            return True
        row, col = empty
        for suit in SUITS:
            if suit in row_used[row] or suit in col_used[col]:
                continue
            grid[row][col] = suit
            row_used[row].add(suit)
            col_used[col].add(suit)
            if fill():
                return True
            row_used[row].remove(suit)
            col_used[col].remove(suit)
            grid[row][col] = None
        return False

    return fill()


def _tier_three(rng):
    while True:
        grid = _latin_square(rng)
        target = (rng.randrange(4), rng.randrange(4))
        cells = [(row, col) for row in range(4) for col in range(4) if (row, col) != target]
        rng.shuffle(cells)
        given_cells = cells[:7]
        key_cells = cells[7:9]
        given = {cell: grid[cell[0]][cell[1]] for cell in given_cells}
        key = {cell: grid[cell[0]][cell[1]] for cell in key_cells}
        without_key = _latin_candidates(given, target)
        with_key = _latin_candidates({**given, **key}, target)
        if len(without_key) >= 2 and len(with_key) == 1:
            shown = [[given.get((row, col)) for col in range(4)] for row in range(4)]
            return {
                "question": "Which suit is marked?",
                "grids": {"given": shown},
                "highlight": _cell(*target),
                "key_text": "Use these two tiles.",
                "key_cells": [
                    {"row": row, "col": col, "suit": suit}
                    for (row, col), suit in key.items()
                ],
                "answer": with_key[0],
            }


def candidates(puzzle, with_key=True):
    tier = puzzle["tier"]
    if tier == 1:
        cells = _changed_cells(puzzle["grids"]["before"], puzzle["grids"]["after"])
        if with_key:
            cells = [
                cell for cell in cells
                if puzzle["grids"]["after"][cell["row"]][cell["col"]] == puzzle["key_suit"]
            ]
        return [_answer_key(cell) for cell in cells]
    if tier == 2:
        directions = [puzzle["key_direction"]] if with_key else list(DIRECTIONS)
        cells = [_move(puzzle["highlight"], direction) for direction in directions]
        return sorted({_answer_key(cell) for cell in cells if cell is not None})
    given = {}
    for row, values in enumerate(puzzle["grids"]["given"]):
        for col, suit in enumerate(values):
            if suit:
                given[(row, col)] = suit
    if with_key:
        for cell in puzzle["key_cells"]:
            given[(cell["row"], cell["col"])] = cell["suit"]
    return _latin_candidates(given, (puzzle["highlight"]["row"], puzzle["highlight"]["col"]))


def verify(puzzle):
    if len(candidates(puzzle, with_key=True)) != 1:
        return False
    if len(candidates(puzzle, with_key=False)) < 2:
        return False
    if candidates(puzzle, with_key=True)[0] != _answer_key(puzzle["answer"]):
        return False
    if puzzle["tier"] == 1:
        cells = _changed_cells(puzzle["grids"]["before"], puzzle["grids"]["after"])
        return len(cells) == 2 and any(
            puzzle["grids"]["before"][c["row"]][c["col"]]
            != puzzle["grids"]["after"][c["row"]][c["col"]]
            for c in cells
        )
    if puzzle["tier"] == 2:
        return puzzle["answer"] in [
            _move(puzzle["highlight"], d) for d in DIRECTIONS
        ]
    return True


def generate(seed, counter, tier):
    if tier not in (1, 2, 3):
        raise ValueError("unknown puzzle tier")
    for attempt in range(256):
        rng = random.Random(seed ^ (counter * 0x9E3779B9) ^ (tier * 0x85EBCA6B) ^ attempt)
        if tier == 1:
            data = _tier_one(rng)
        elif tier == 2:
            data = _tier_two(rng)
        else:
            data = _tier_three(rng)
        puzzle = {"puzzle_id": f"{seed}:{counter}:{tier}", "tier": tier, **data}
        if verify(puzzle):
            return puzzle
    raise RuntimeError("puzzle generation failed")


def public_view(puzzle, answer_ms):
    return {
        "puzzle_id": puzzle["puzzle_id"],
        "tier": puzzle["tier"],
        "question": puzzle["question"],
        "grids": puzzle["grids"],
        "highlight": puzzle["highlight"],
        "answer_ms": answer_ms,
    }


def key_view(puzzle):
    view = {
        "puzzle_id": puzzle["puzzle_id"],
        "tier": puzzle["tier"],
        "key_text": puzzle["key_text"],
    }
    if puzzle["tier"] == 3:
        view["key_cells"] = puzzle["key_cells"]
    return view


def check_answer(puzzle, answer):
    try:
        return _answer_key(answer) == _answer_key(puzzle["answer"])
    except (TypeError, ValueError):
        return False
