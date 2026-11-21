from __future__ import annotations

import hashlib
import logging
import re
from io import BytesIO
from typing import Any
from urllib.parse import quote

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError

from . import config, db, supabase_store
from .repositories import AvatarRepository

ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp"}
EXTENSIONS = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
PFP_PRESET_IDS = ("joker", "spade", "club", "heart", "diamond")
LEGACY_CHARACTER_PFP = {
    "arisu": "spade",
    "usagi": "heart",
    "chishiya": "diamond",
    "kuina": "club",
    "ann": "spade",
    "karube": "heart",
    "chota": "diamond",
    "shibuki": "club",
    "niragi": "spade",
    "aguni": "heart",
    "hatter": "diamond",
    "mira": "club",
    "tatta": "spade",
    "lastboss": "heart",
    "heiya": "diamond",
    "kuzuryu": "club",
}

logger = logging.getLogger(__name__)


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
    if len(data) > MAX_UPLOAD_BYTES:
        raise AvatarInvalid("Avatar images must be 5 MB or smaller.")
    media_type = (content_type or "").split(";", 1)[0].strip().lower()
    if media_type not in ALLOWED_TYPES:
        raise AvatarInvalid("Use a PNG, JPEG or WEBP image.")
    if not _magic_ok(data, media_type):
        raise AvatarInvalid("The file contents do not match its image type.")
    try:
        with Image.open(BytesIO(data)) as probe:
            image_format = (probe.format or "").upper()
            probe.verify()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise AvatarInvalid("That image could not be read.") from exc
    expected = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}
    if expected.get(image_format) != media_type:
        raise AvatarInvalid("The image format does not match its type.")
    try:
        with Image.open(BytesIO(data)) as source:
            with ImageOps.exif_transpose(source) as oriented:
                width, height = oriented.size
                side = min(width, height)
                left = (width - side) // 2
                top = (height - side) // 2
                cropped = oriented.crop((left, top, left + side, top + side)).convert("RGBA")
                output = BytesIO()
                cropped.save(output, format="PNG", optimize=True)
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise AvatarInvalid("That image could not be read.") from exc
    normalized = output.getvalue()
    return {
        "data": normalized,
        "content_type": "image/png",
        "width": side,
        "height": side,
        "bytes": len(normalized),
    }


def moderate_avatar(uid: str, data: bytes, content_type: str, kind: str) -> bool:
    return bool(uid) and bool(data) and kind in {"upload", "character"}


def public_url(path: str) -> str:
    base = config.SUPABASE_URL.rstrip("/")
    return f"{base}/storage/v1/object/public/{config.SUPABASE_STORAGE_BUCKET}/{quote(path, safe='/')}"


def is_pfp_preset(value: object) -> bool:
    return isinstance(value, str) and value in PFP_PRESET_IDS


def pfp_url(preset_id: str) -> str:
    return f"/avatars/pfp/{preset_id}.png"


def default_pfp_id(seed: object | None) -> str:
    if seed is None or seed == "":
        return "joker"
    digest = hashlib.sha256(str(seed).encode("utf-8")).digest()
    return PFP_PRESET_IDS[digest[0] % len(PFP_PRESET_IDS)]


def normalize_avatar(
    avatar_url: object | None,
    character_id: object | None = None,
    seed: object | None = None,
) -> tuple[str | None, None]:
    raw_url = avatar_url.strip() if isinstance(avatar_url, str) else ""
    if raw_url:
        preset_match = re.fullmatch(r"/avatars/pfp/([a-z]+)\.png", raw_url)
        if preset_match and is_pfp_preset(preset_match.group(1)):
            return raw_url, None
        legacy_match = re.fullmatch(r"/avatars/characters/([a-z0-9-]+)\.png", raw_url)
        if legacy_match:
            preset_id = LEGACY_CHARACTER_PFP.get(legacy_match.group(1))
            return pfp_url(preset_id or default_pfp_id(seed)), None
        if raw_url.startswith("/"):
            return pfp_url(default_pfp_id(seed)), None
        return raw_url, None
    if isinstance(character_id, str) and character_id in LEGACY_CHARACTER_PFP:
        return pfp_url(LEGACY_CHARACTER_PFP[character_id]), None
    return pfp_url(default_pfp_id(seed)), None


def storage_path_for(uid: str) -> str | None:
    row = for_uid(uid)
    path = row.get("storage_path") if row else None
    if isinstance(path, str) and path.startswith(f"{uid}/") and ".." not in path:
        return path
    return None


def delete_storage(path: str | None) -> None:
    if not path or path.startswith("/") or ".." in path or not config.supabase_configured():
        return
    url = (
        f"{config.SUPABASE_URL.rstrip('/')}/storage/v1/object/"
        f"{quote(config.SUPABASE_STORAGE_BUCKET, safe='')}/{quote(path, safe='/')}"
    )
    headers = {
        "apikey": config.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {config.SUPABASE_SERVICE_ROLE_KEY}",
    }
    try:
        with httpx.Client(timeout=15) as client:
            response = client.delete(url, headers=headers)
        if response.status_code >= 400:
            logger.warning("avatar storage cleanup failed with status %s", response.status_code)
    except httpx.HTTPError:
        logger.warning("avatar storage cleanup was unavailable", exc_info=True)


def clear_uploaded_storage(uid: str) -> None:
    delete_storage(storage_path_for(uid))


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


def guest_avatar(payload: object, seed: object | None = None) -> tuple[str | None, None]:
    return normalize_avatar(None, None, seed)
