from __future__ import annotations

import base64
import binascii
import re
from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

try:
    from .avatar_catalog import CHARACTER_IDS, PFP_PRESETS, is_character_id, is_pfp_preset_id
except ImportError:
    from avatar_catalog import CHARACTER_IDS, PFP_PRESETS, is_character_id, is_pfp_preset_id

try:
    from .avatar_storage import ImageUploader
except ImportError:
    from avatar_storage import ImageUploader

try:
    from .avatar_adapters import ProfilePatcher, UsernameChecker
except ImportError:
    from avatar_adapters import ProfilePatcher, UsernameChecker

_USERNAME_RE = re.compile(r"^[A-Za-z0-9 _-]{3,24}$")
_ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp"}


class PresetRequest(BaseModel):
    preset_id: str


class CharacterRequest(BaseModel):
    character_id: str


class UsernameRequest(BaseModel):
    username: str = Field(min_length=3, max_length=24)


class UploadRequest(BaseModel):
    content_type: str
    data: str


def create_avatar_router(
    *,
    current_user: Callable[..., Any],
    update_profile: ProfilePatcher,
    username_taken: UsernameChecker,
    upload_image: ImageUploader,
    max_upload_bytes: int = 2 * 1024 * 1024,
) -> APIRouter:
    router = APIRouter(prefix="/api/avatar", tags=["avatar"])

    def profile_payload(user: Any, row: Any, patch: dict[str, Any]) -> dict[str, Any]:
        profile = row if isinstance(row, dict) else {}
        return {
            "username": profile.get("username") or getattr(user, "username", None) or getattr(user, "uid", ""),
            "avatar_url": patch.get("avatar_url", profile.get("avatar_url")),
            "avatar_preset_id": patch.get("avatar_preset_id", profile.get("avatar_preset_id")),
            "character_id": patch.get("character_id", profile.get("character_id")),
        }

    @router.get("/presets")
    def presets() -> dict[str, Any]:
        return {"presets": list(PFP_PRESETS), "characters": list(CHARACTER_IDS)}

    @router.post("/pfp/upload")
    def upload_pfp(
        payload: UploadRequest,
        user: Any = Depends(current_user),
    ) -> dict[str, Any]:
        if payload.content_type not in _ALLOWED_TYPES:
            raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Use a PNG, JPEG or WebP image.")
        try:
            data = base64.b64decode(payload.data, validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image data is invalid.")
        if len(data) > max_upload_bytes:
            raise HTTPException(status_code=413, detail="Image must be under 2 MB.")
        url = upload_image(getattr(user, "uid", ""), "pfp", data, payload.content_type)
        row = update_profile(getattr(user, "uid", ""), {"avatar_url": url, "avatar_preset_id": None})
        return profile_payload(user, row, {"avatar_url": url, "avatar_preset_id": None})

    @router.post("/pfp/preset")
    def select_pfp_preset(
        payload: PresetRequest,
        user: Any = Depends(current_user),
    ) -> dict[str, Any]:
        if not is_pfp_preset_id(payload.preset_id):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown profile image preset.")
        src = next(preset["src"] for preset in PFP_PRESETS if preset["id"] == payload.preset_id)
        patch = {"avatar_url": src, "avatar_preset_id": payload.preset_id}
        row = update_profile(getattr(user, "uid", ""), patch)
        return profile_payload(user, row, patch)

    @router.post("/character")
    def select_character(
        payload: CharacterRequest,
        user: Any = Depends(current_user),
    ) -> dict[str, Any]:
        if not is_character_id(payload.character_id):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown 3D avatar.")
        patch = {"character_id": payload.character_id}
        row = update_profile(getattr(user, "uid", ""), patch)
        return profile_payload(user, row, patch)

    @router.put("/username")
    def update_username(
        payload: UsernameRequest,
        user: Any = Depends(current_user),
    ) -> dict[str, Any]:
        username = payload.username.strip()
        if not _USERNAME_RE.fullmatch(username):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username must be 3-24 letters, numbers, spaces, underscores or hyphens.")
        if username_taken(username, getattr(user, "uid", None)):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That username is already taken.")
        patch = {"username": username}
        row = update_profile(getattr(user, "uid", ""), patch)
        return profile_payload(user, row, patch)

    return router
