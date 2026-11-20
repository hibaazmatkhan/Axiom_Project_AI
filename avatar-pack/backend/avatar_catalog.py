PFP_PRESETS = (
    {"id": "joker", "label": "Joker", "glyph": "JKR", "src": "/avatars/pfp/joker.png"},
    {"id": "spade", "label": "Spade", "glyph": "SPADE", "src": "/avatars/pfp/spade.png"},
    {"id": "club", "label": "Club", "glyph": "CLUB", "src": "/avatars/pfp/club.png"},
    {"id": "heart", "label": "Heart", "glyph": "HEART", "src": "/avatars/pfp/heart.png"},
    {"id": "diamond", "label": "Diamond", "glyph": "DIAMOND", "src": "/avatars/pfp/diamond.png"},
)

PFP_PRESET_IDS = tuple(preset["id"] for preset in PFP_PRESETS)

CHARACTER_IDS = (
    "arisu",
    "usagi",
    "chishiya",
    "kuina",
    "ann",
    "karube",
    "chota",
    "rei",
    "niragi",
    "aguni",
    "banda",
    "mira",
    "tatta",
    "shion",
    "heiya",
    "kuzuryu",
)


def is_pfp_preset_id(value: object) -> bool:
    return isinstance(value, str) and value in PFP_PRESET_IDS


def is_character_id(value: object) -> bool:
    return isinstance(value, str) and value in CHARACTER_IDS
