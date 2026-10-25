"""AXIOM stage progression (WP2, task 43; proposal section 4.4).

Six stages plus a final escape stage. Each stage defines how many hidden rules
run, which pattern types are allowed, transition timing and how strongly NEXUS
may adapt. Staging keeps early play teachable and later play combinatorial.
"""
from __future__ import annotations

import random

from .patterns import Rule
from .maze import PATTERN_TYPES

STAGES = [
    {
        "stage": 1, "name": "Introduction",
        "what": "Players learn movement and interaction.",
        "rules": 1, "types": ["symbol"], "transition": 20.0, "adapt": 0.0,
    },
    {
        "stage": 2, "name": "First Pattern",
        "what": "The maze starts changing; the first hidden rule is discovered.",
        "rules": 1, "types": ["symbol", "rotation", "sequential"], "transition": 16.0, "adapt": 0.2,
    },
    {
        "stage": 3, "name": "Cooperation",
        "what": "Players receive different information and must communicate.",
        "rules": 1, "types": ["rotation", "reflection", "symbol"], "transition": 14.0, "adapt": 0.4,
    },
    {
        "stage": 4, "name": "Prediction",
        "what": "Players begin predicting future maze states.",
        "rules": 2, "types": ["sequential", "conditional", "translation"], "transition": 12.0, "adapt": 0.6,
    },
    {
        "stage": 5, "name": "Adaptive Labyrinth",
        "what": "NEXUS begins reacting to player behaviour.",
        "rules": 2, "types": ["conditional", "compound", "reflection"], "transition": 11.0, "adapt": 0.9,
    },
    {
        "stage": 6, "name": "Complex Patterns",
        "what": "Several rules interact and become harder to identify.",
        "rules": 3, "types": list(PATTERN_TYPES), "transition": 10.0, "adapt": 1.0,
    },
    {
        "stage": 7, "name": "Escape",
        "what": "Players combine everything learned to understand the final system and escape.",
        "rules": 3, "types": list(PATTERN_TYPES), "transition": 9.0, "adapt": 1.0,
    },
]
MAX_STAGE = len(STAGES)


def stage_config(stage: int) -> dict:
    return STAGES[max(0, min(stage - 1, MAX_STAGE - 1))]


def rules_for_stage(stage: int, seed: int) -> list[Rule]:
    cfg = stage_config(stage)
    rng = random.Random(seed * 31 + stage)
    rules = []
    for i in range(cfg["rules"]):
        pt = rng.choice(cfg["types"])
        rules.append(Rule.generate(rng, pt))
    return rules
