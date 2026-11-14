import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from app import auth
from app.auth import DEMO_USER_ID, AuthError, verify_token
from app.main import app

SECRET = "test-jwt-secret-at-least-32-bytes-long!"
USER_ID = uuid.uuid4()


def token(**overrides: object) -> str:
    claims = {"sub": str(USER_ID), "aud": "authenticated", "exp": time.time() + 600}
    claims |= overrides
    return jwt.encode(claims, SECRET, algorithm="HS256")


@pytest.fixture(autouse=True)
def live_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REPLAY", "0")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")


def test_valid_token_gives_the_user() -> None:
    user = verify_token(token(email="a@example.com"))
    assert user.id == USER_ID
    assert user.email == "a@example.com"


@pytest.mark.parametrize(
    ("bad_token", "message"),
    [
        (lambda: token(exp=time.time() - 10), "expired"),
        (lambda: token(aud="anon"), "not valid"),
        (
            lambda: jwt.encode(
                {"sub": str(USER_ID), "aud": "authenticated", "exp": time.time() + 600},
                "wrong-secret-also-32-bytes-long!!!",
                algorithm="HS256",
            ),
            "not valid",
        ),
        (
            lambda: jwt.encode(
                {"sub": str(USER_ID), "aud": "authenticated", "exp": time.time() + 600},
                None,
                algorithm="none",
            ),
            "unsupported",
        ),
        (lambda: token(sub="not-a-uuid"), "not valid"),
        (lambda: "garbage", "not valid"),
    ],
)
def test_bad_tokens_are_refused(bad_token, message: str) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(AuthError, match=message):
        verify_token(bad_token())


def test_asymmetric_token_checked_with_supabase_signing_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    private_key = ec.generate_private_key(ec.SECP256R1())

    class FakeJwks:
        def get_signing_key_from_jwt(self, _token: str) -> object:
            return type("Key", (), {"key": private_key.public_key()})()

    monkeypatch.setattr(auth, "_jwks_client", lambda: FakeJwks())
    signed = jwt.encode(
        {"sub": str(USER_ID), "aud": "authenticated", "exp": time.time() + 600},
        private_key,
        algorithm="ES256",
    )
    assert verify_token(signed).id == USER_ID


def test_hs256_without_secret_says_what_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SUPABASE_JWT_SECRET")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "")
    with pytest.raises(AuthError, match="SUPABASE_JWT_SECRET"):
        verify_token(token())


def test_api_refuses_calls_without_login() -> None:
    response = TestClient(app).get("/conversations")
    assert response.status_code == 401
    assert response.json()["detail"] == "Log in first."


def test_replay_mode_acts_as_demo_user(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REPLAY", "1")
    assert auth.current_user(None).id == DEMO_USER_ID


def test_token_from_unknown_key_is_invalid_not_a_network_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class NoMatchingKey:
        def get_signing_key_from_jwt(self, _token: str) -> object:
            raise jwt.PyJWKClientError("Unable to find a signing key that matches")

    monkeypatch.setattr(auth, "_jwks_client", lambda: NoMatchingKey())
    other_key = ec.generate_private_key(ec.SECP256R1())
    forged = jwt.encode(
        {"sub": str(USER_ID), "aud": "authenticated", "exp": time.time() + 600},
        other_key,
        algorithm="ES256",
    )
    with pytest.raises(AuthError, match="not valid"):
        verify_token(forged)
