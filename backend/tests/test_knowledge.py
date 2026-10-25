"""WP2 knowledge representation + cooperative puzzle generator tests."""
import random

from app.knowledge import Fact, KnowledgeBase, PuzzleGenerator
from app.patterns import Rule


def test_knowledge_base_query():
    kb = KnowledgeBase()
    kb.add(Fact("rule", "pattern_type", "symbol"))
    kb.add(Fact("symbol:triangle", "moves", True))
    assert len(kb.query(predicate="pattern_type")) == 1
    assert len(kb.query()) == 2


def test_describe_rule_to_facts():
    kb = KnowledgeBase()
    rule = Rule.generate(random.Random(1), "sequential")
    facts = kb.describe_rule(rule)
    assert any(f.predicate == "pattern_type" for f in facts)


def test_score_hypothesis_perfect_match():
    kb = KnowledgeBase()
    rule = Rule.generate(random.Random(2), "rotation")
    score = kb.score_hypothesis({"pattern_type": "rotation"}, rule)
    assert score == 1.0


def test_puzzle_clues_split_across_roles():
    gen = PuzzleGenerator(size=3)
    p = gen.generate_many(1, seeds=42)[0]
    assert set(p.clues) == set(gen.ROLES)
    for role in gen.ROLES:
        assert len(p.clues[role]) >= 1


def test_puzzles_solvable_across_many_seeds():
    gen = PuzzleGenerator(size=3)
    assert gen.verify_all_solvable(count=100, seeds=1000) is True


def test_no_single_clue_reveals_the_answer():
    """Each role's clue alone must not name the answer symbol."""
    gen = PuzzleGenerator(size=3)
    for p in gen.generate_many(50, seeds=7):
        for role, clues in p.clues.items():
            for c in clues:
                assert p.answer_key not in c.lower(), (role, c, p.answer_key)


def test_clues_are_distinct_across_roles():
    gen = PuzzleGenerator(size=3)
    for p in gen.generate_many(20, seeds=3):
        flat = [c for clues in p.clues.values() for c in clues]
        assert len(set(flat)) == len(flat)


def test_grade_puzzle():
    gen = PuzzleGenerator(size=3)
    p = gen.generate_many(1, seeds=1)[0]
    assert PuzzleGenerator.grade(p, p.solution) is True
