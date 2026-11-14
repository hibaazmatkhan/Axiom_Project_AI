"""Stage progression for THE LAST ROOM.

Seven stages keep early play teachable and later play combinatorial. Each stage
defines how many hidden grid rules run, which pattern types are allowed, round
timing and how strongly The Dealer may adapt.
"""
from __future__ import annotations

import random

from .arena import PATTERN_TYPES, SIZE
from .patterns import Rule

STAGES = [
    {
        "stage": 1, "name": "Induction",
        "what": "Learn the room, the coloured doors and the d10 pedestal.",
        "rules": 1, "types": ["symbol"], "round_seconds": 26.0, "adapt": 0.0,
    },
    {
        "stage": 2, "name": "First Shift",
        "what": "The grid moves. Re-read the wristband map every round.",
        "rules": 1, "types": ["symbol", "translation", "sequential"],
        "round_seconds": 22.0, "adapt": 0.2,
    },
    {
        "stage": 3, "name": "Split",
        "what": "Door capacity forces the team apart; communication is essential.",
        "rules": 1, "types": ["translation", "reflection", "rotation"],
        "round_seconds": 20.0, "adapt": 0.4,
    },
    {
        "stage": 4, "name": "Visions",
        "what": "LED walls show possible futures. Predict before committing.",
        "rules": 2, "types": ["sequential", "conditional", "translation"],
        "round_seconds": 18.0, "adapt": 0.6,
    },
    {
        "stage": 5, "name": "Lockdown",
        "what": "The Dealer reacts to the team and seals doors.",
        "rules": 2, "types": ["conditional", "compound", "reflection"],
        "round_seconds": 17.0, "adapt": 0.9,
    },
    {
        "stage": 6, "name": "Convergence",
        "what": "Several rules interact and the grid becomes hard to read.",
        "rules": 3, "types": list(PATTERN_TYPES), "round_seconds": 15.0, "adapt": 1.0,
    },
    {
        "stage": 7, "name": "The Last Room",
        "what": "Reach A5 with every living player and open the final door.",
        "rules": 3, "types": list(PATTERN_TYPES), "round_seconds": 14.0, "adapt": 1.0,
    },
]
MAX_STAGE = len(STAGES)


def stage_config(stage: int) -> dict:
    return dict(STAGES[max(0, min(stage - 1, MAX_STAGE - 1))])


def rules_for_stage(stage: int, seed: int) -> list[Rule]:
    cfg = stage_config(stage)
    rng = random.Random(seed * 31 + stage)
    rules = []
    for _ in range(cfg["rules"]):
        pt = rng.choice(cfg["types"])
        rules.append(Rule.generate(rng, pt, size=SIZE))
    return rules
