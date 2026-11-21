"""WP2 knowledge representation tests."""
import random

from app.knowledge import Fact, KnowledgeBase
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
