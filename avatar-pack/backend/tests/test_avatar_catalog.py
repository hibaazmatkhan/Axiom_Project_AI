from avatar_catalog import CHARACTER_IDS, PFP_PRESET_IDS, is_character_id, is_pfp_preset_id


def test_pfp_presets_are_symbols_only():
    assert PFP_PRESET_IDS == ("joker", "spade", "club", "heart", "diamond")
    assert is_pfp_preset_id("spade") is True
    assert is_pfp_preset_id("arisu") is False


def test_character_roster_has_sixteen_ids():
    assert len(CHARACTER_IDS) == 16
    assert "rei" in CHARACTER_IDS
    assert "banda" in CHARACTER_IDS
    assert "shion" in CHARACTER_IDS
    assert "hatter" not in CHARACTER_IDS
    assert "lastboss" not in CHARACTER_IDS
    assert is_character_id("kuzuryu") is True
