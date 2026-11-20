CHARACTER_IDS = (
    "arisu",
    "usagi",
    "chishiya",
    "kuina",
    "ann",
    "karube",
    "chota",
    "shibuki",
    "niragi",
    "aguni",
    "hatter",
    "mira",
    "tatta",
    "lastboss",
    "heiya",
    "kuzuryu",
)


def is_character(value: object) -> bool:
    return isinstance(value, str) and value in CHARACTER_IDS


def character_url(value: str) -> str:
    return f"/avatars/characters/{value}.png"
