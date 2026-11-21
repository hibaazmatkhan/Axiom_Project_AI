"""Firebase Authentication verification for HTTP and WebSocket callers."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import firebase_admin
from fastapi import Depends, Header, HTTPException, status
from firebase_admin import app_check
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials

from . import config


class AuthConfigurationError(RuntimeError):
    pass


class AuthTokenError(ValueError):
    pass


class AppCheckTokenError(ValueError):
    pass


APP_CHECK_CONFIG_DETAIL = (
    "App Check enforcement is enabled but Firebase Admin credentials are missing. "
    "Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY, or "
    "disable APP_CHECK_ENFORCE."
)


@dataclass(frozen=True)
class AuthUser:
    uid: str
    email: str | None
    email_verified: bool
    name: str | None
    picture: str | None
    mfa_enabled: bool
    claims: dict[str, Any]


_app: firebase_admin.App | None = None


def _firebase_app() -> firebase_admin.App:
    global _app
    if _app is not None:
        return _app
    if not config.firebase_configured():
        raise AuthConfigurationError("Firebase Admin credentials are not configured.")
    try:
        _app = firebase_admin.get_app()
    except ValueError:
        _app = firebase_admin.initialize_app(
            credentials.Certificate(
                {
                    "type": "service_account",
                    "project_id": config.FIREBASE_PROJECT_ID,
                    "private_key": config.FIREBASE_PRIVATE_KEY,
                    "client_email": config.FIREBASE_CLIENT_EMAIL,
                    "token_uri": "https://oauth2.googleapis.com/token",
                }
            )
        )
    return _app


def verify_token(token: str) -> AuthUser:
    if not token:
        raise AuthTokenError("Missing Firebase ID token.")
    try:
        claims = firebase_auth.verify_id_token(token, check_revoked=True, app=_firebase_app())
    except firebase_auth.ExpiredIdTokenError as exc:
        raise AuthTokenError("The sign-in session has expired.") from exc
    except firebase_auth.RevokedIdTokenError as exc:
        raise AuthTokenError("The sign-in session was revoked.") from exc
    except (firebase_auth.InvalidIdTokenError, ValueError) as exc:
        raise AuthTokenError("Invalid Firebase ID token.") from exc
    except firebase_auth.CertificateFetchError as exc:
        raise AuthTokenError("Could not verify the Firebase token right now.") from exc

    uid = str(claims.get("uid") or claims.get("sub") or "")
    if not uid:
        raise AuthTokenError("Firebase token did not contain a user id.")
    firebase_claim = claims.get("firebase") or {}
    return AuthUser(
        uid=uid,
        email=claims.get("email"),
        email_verified=bool(claims.get("email_verified")),
        name=claims.get("name"),
        picture=claims.get("picture"),
        mfa_enabled=bool(firebase_claim.get("sign_in_second_factor")),
        claims=claims,
    )


def verify_app_check(token: str | None) -> dict[str, Any]:
    if not token:
        raise AppCheckTokenError("App Check token is required.")
    try:
        return app_check.verify_token(token, app=_firebase_app())
    except app_check.InvalidTokenError as exc:
        raise AppCheckTokenError("Invalid App Check token.") from exc
    except ValueError as exc:
        raise AppCheckTokenError("App Check token could not be verified.") from exc


def app_check_config_error() -> str | None:
    """Return a startup/config explanation when enforcement cannot work."""
    if config.APP_CHECK_ENFORCE and not config.firebase_configured():
        return APP_CHECK_CONFIG_DETAIL
    return None


def enforce_app_check(
    x_firebase_app_check: str | None = Header(default=None, alias="X-Firebase-AppCheck"),
) -> None:
    if not config.APP_CHECK_ENFORCE:
        return
    detail = app_check_config_error()
    if detail:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail)
    try:
        verify_app_check(x_firebase_app_check)
    except AppCheckTokenError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except AuthConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=APP_CHECK_CONFIG_DETAIL,
        ) from exc


def _bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token.strip()


def get_current_user(
    authorization: str | None = Header(default=None),
    _: None = Depends(enforce_app_check),
) -> AuthUser:
    token = _bearer_token(authorization)
    try:
        return verify_token(token)
    except AuthConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication is not configured.",
        ) from exc
    except AuthTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def get_verified_user(user: AuthUser = Depends(get_current_user)) -> AuthUser:
    if not user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Verify your email before saving ranked data.",
        )
    return user


def is_admin(user: AuthUser) -> bool:
    return user.uid in config.ADMIN_UIDS or bool(user.claims.get("admin"))


def require_admin(user: AuthUser = Depends(get_current_user)) -> AuthUser:
    if not is_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access is required.",
        )
    return user


def mfa_enabled_from_profile(profile: dict[str, Any] | None, fallback: bool = False) -> bool:
    """DB profiles.mfa_enabled is authoritative; the token claim is a fallback."""
    if not profile or "mfa_enabled" not in profile or profile.get("mfa_enabled") is None:
        return bool(fallback)
    value = profile["mfa_enabled"]
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in {"1", "true", "yes", "on"}
