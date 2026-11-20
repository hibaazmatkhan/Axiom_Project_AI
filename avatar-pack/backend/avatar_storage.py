from __future__ import annotations

import mimetypes
import secrets
from typing import Callable

import httpx

ImageUploader = Callable[[str, str, bytes, str], str]

_ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp"}


def _extension(content_type: str) -> str:
    if content_type not in _ALLOWED_TYPES:
        raise ValueError("Unsupported image type.")
    guessed = mimetypes.guess_extension(content_type) or ".png"
    return "jpg" if guessed == ".jpe" else guessed.lstrip(".")


def make_supabase_uploader(*, url: str, service_role_key: str, bucket: str = "avatars") -> ImageUploader:
    base = (url or "").rstrip("/")
    if not base or not service_role_key or not bucket:
        raise ValueError("Supabase storage is not configured.")

    def upload(uid: str, filename: str, data: bytes, content_type: str) -> str:
        extension = _extension(content_type)
        path = f"avatars/{uid}/{secrets.token_hex(8)}.{extension}"
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": content_type,
            "x-upsert": "true",
        }
        endpoint = f"{base}/storage/v1/object/{bucket}/{path}"
        with httpx.Client(timeout=15) as client:
            response = client.post(endpoint, headers=headers, content=data)
        if response.status_code >= 400:
            raise RuntimeError("Image upload failed.")
        return f"{base}/storage/v1/object/public/{bucket}/{path}"

    return upload
