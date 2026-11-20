from __future__ import annotations

from io import BytesIO
from typing import Any
from urllib.parse import quote

import httpx
from PIL import Image, UnidentifiedImageError

from . import config, db, supabase_store
from .characters import character_url, is_character
from .repositories import AvatarRepository

MAX_BYTES = 500 * 1024
MIN_DIMENSION = 64
MAX_DIMENSION = 512
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp"}
EXTENSIONS = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}


class AvatarInvalid(ValueError):
    pass


class AvatarUnavailable(RuntimeError):
    pass


def _magic_ok(data: bytes, content_type: str) -> bool:
    if content_type == "image/png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/jpeg":
        return data.startswith(b"\xff\xd8\xff")
    return len(data) > 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"


def validate_upload(data: bytes, content_type: str) -> dict[str, Any]:
    media_type = (content_type or "").split(";", 1)[0].strip().lower()
    if media_type not in ALLOWED_TYPES:
        raise AvatarInvalid("Use a PNG, JPEG or WEBP image.")
    if not data or len(data) > MAX_BYTES:
        raise AvatarInvalid("Avatar images must be under 500 KB.")
    if not _magic_ok(data, media_type):
        raise AvatarInvalid("The file contents do not match its image type.")
    try:
        with Image.open(BytesIO(data)) as image:
            width, height = image.size
            image_format = (image.format or "").upper()
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise AvatarInvalid("That image could not be read.") from exc
    expected = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}
    if expected.get(image_format) != media_type:
        raise AvatarInvalid("The image format does not match its type.")
    if width != height or not MIN_DIMENSION <= width <= MAX_DIMENSION:
        raise AvatarInvalid("Avatars must be square, between 64×64 and 512×512.")
    return {"content_type": media_type, "width": width, "height": height, "bytes": len(data)}


def moderate_avatar(uid: str, data: bytes, content_type: str, kind: str) -> bool:
    return bool(uid) and bool(data) and kind in {"upload", "character"}


def public_url(path: str) -> str:
    base = config.SUPABASE_URL.rstrip("/")
    return f"{base}/storage/v1/object/public/{config.SUPABASE_STORAGE_BUCKET}/{quote(path, safe='/')}"


def upload(uid: str, data: bytes, content_type: str) -> tuple[str, str]:
    if not config.supabase_configured():
        raise AvatarUnavailable("Avatar storage is not configured.")
    if not moderate_avatar(uid, data, content_type, "upload"):
        raise AvatarInvalid("This avatar was rejected by moderation.")
    path = f"{uid}/avatar.{EXTENSIONS[content_type]}"
    url = (
        f"{config.SUPABASE_URL.rstrip('/')}/storage/v1/object/"
        f"{quote(config.SUPABASE_STORAGE_BUCKET, safe='')}/{quote(path, safe='/')}"
    )
    headers = {
        "apikey": config.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {config.SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": content_type,
        "x-upsert": "true",
        "cache-control": "3600",
    }
    try:
        with httpx.Client(timeout=15) as client:
            response = client.post(url, headers=headers, content=data)
    except httpx.HTTPError as exc:
        raise AvatarUnavailable("Avatar storage is unavailable.") from exc
    if response.status_code >= 400:
        raise AvatarUnavailable("Avatar storage rejected the upload.")
    return path, public_url(path)


def _repository() -> AvatarRepository:
    return supabase_store if config.supabase_configured() else db.store


def persist(
    uid: str,
    character_id: str | None,
    avatar_url: str | None,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    try:
        return _repository().set_avatar(uid, character_id, avatar_url, meta or {})
    except supabase_store.SupabaseUnavailable as exc:
        raise AvatarUnavailable(str(exc)) from exc


def for_uid(uid: str) -> dict[str, Any] | None:
    try:
        return _repository().get_avatar(uid)
    except supabase_store.SupabaseUnavailable:
        return None


def clear(uid: str) -> None:
    try:
        _repository().clear_avatar(uid)
    except supabase_store.SupabaseUnavailable as exc:
        raise AvatarUnavailable(str(exc)) from exc


def guest_avatar(payload: object) -> tuple[str | None, str | None]:
    if not isinstance(payload, dict):
        return None, None
    character_id = payload.get("character_id")
    if not is_character(character_id):
        return None, None
    return character_id, character_url(character_id)
