"""Firebase Authentication verification for HTTP and WebSocket callers."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import firebase_admin
from fastapi import Depends, Header, HTTPException, status
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials

from . import config


class AuthConfigurationError(RuntimeError):
    pass


class AuthTokenError(ValueError):
    pass


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


def get_current_user(authorization: str | None = Header(default=None)) -> AuthUser:
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


def require_admin(user: AuthUser = Depends(get_current_user)) -> AuthUser:
    if user.uid not in config.ADMIN_UIDS and not user.claims.get("admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access is required.",
        )
    return user
