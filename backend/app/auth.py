"""Who is calling: checks the Supabase login token sent as `Authorization: Bearer <token>`.

The backend connects to the database as its owner, so row level security does not
protect it. Every query must filter by the user returned here.
"""

import uuid
from functools import cache
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.config import get_settings

# REPLAY=1 runs with no network, so it cannot check tokens: it acts as this user.
DEMO_USER_ID = uuid.UUID("00000000-0000-0000-0000-00000000de30")

ASYMMETRIC_ALGORITHMS = {"ES256", "RS256", "EdDSA"}

bearer = HTTPBearer(auto_error=False)


class User(BaseModel):
    id: uuid.UUID
    email: str | None = None


class AuthError(Exception):
    pass


@cache
def _jwks_client() -> jwt.PyJWKClient:
    url = f"{get_settings().supabase_url}/auth/v1/.well-known/jwks.json"
    return jwt.PyJWKClient(url, cache_keys=True, lifespan=3600, timeout=5)


def _signing_key(token: str, algorithm: str) -> object:
    if algorithm == "HS256":
        # Older Supabase projects sign with one shared secret instead of a key pair.
        secret = get_settings().supabase_jwt_secret
        if not secret:
            raise AuthError("Server cannot check this login: SUPABASE_JWT_SECRET is not set")
        return secret
    if algorithm in ASYMMETRIC_ALGORITHMS:
        if not get_settings().supabase_url:
            raise AuthError("Server cannot check this login: SUPABASE_URL is not set")
        return _jwks_client().get_signing_key_from_jwt(token).key
    raise AuthError("Login token uses an unsupported signature")


def verify_token(token: str) -> User:
    try:
        algorithm = jwt.get_unverified_header(token).get("alg", "")
        claims = jwt.decode(
            token,
            _signing_key(token, algorithm),  # type: ignore[arg-type]
            algorithms=[algorithm],
            audience="authenticated",
            options={"require": ["sub", "exp"]},
        )
        return User(id=uuid.UUID(claims["sub"]), email=claims.get("email"))
    except jwt.PyJWKClientConnectionError as exc:
        raise AuthError("Could not reach Supabase to check the login. Try again.") from exc
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("Login expired. Log in again.") from exc
    except (jwt.InvalidTokenError, jwt.PyJWKClientError, ValueError) as exc:
        raise AuthError("Login is not valid. Log in again.") from exc


def current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> User:
    """FastAPI dependency. Sync on purpose: fetching signing keys blocks, so it runs in a thread."""
    if get_settings().replay:
        return User(id=DEMO_USER_ID)
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Log in first.")
    try:
        return verify_token(credentials.credentials)
    except AuthError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc


CurrentUser = Annotated[User, Depends(current_user)]
