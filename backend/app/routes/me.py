from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import storage
from app.auth import CurrentUser, User
from app.db.session import DB
from app.db.tables import Profile
from app.models import ProfileOut, ProfileUpdate

router = APIRouter(prefix="/me", tags=["me"])

AVATAR_TYPES = {"image/jpeg", "image/png", "image/webp"}
AVATAR_MAX_BYTES = 5 * 1024 * 1024


async def _profile(db: AsyncSession, user: User) -> Profile:
    """The sign-up trigger creates profiles; this covers users made before it existed.
    Insert-or-nothing, so two requests at once cannot both create one."""
    profile = await db.get(Profile, user.id)
    if profile is not None:
        return profile
    try:
        await db.execute(insert(Profile).values(id=user.id).on_conflict_do_nothing())
    except IntegrityError as exc:  # token is valid but the account was deleted
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Account not found. Log in again."
        ) from exc
    profile = await db.get(Profile, user.id)
    assert profile is not None
    return profile


async def _out(profile: Profile, user: User) -> ProfileOut:
    return ProfileOut(
        id=user.id,
        email=user.email,
        display_name=profile.display_name,
        avatar_url=await storage.try_signed_url(profile.avatar_path),
        home_city=profile.home_city,
    )


@router.get("")
async def get_me(user: CurrentUser, db: DB) -> ProfileOut:
    return await _out(await _profile(db, user), user)


@router.patch("")
async def update_me(body: ProfileUpdate, user: CurrentUser, db: DB) -> ProfileOut:
    profile = await _profile(db, user)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(profile, field, value)
    await db.flush()
    return await _out(profile, user)


@router.post("/avatar")
async def upload_avatar(
    file: Annotated[UploadFile, File()], user: CurrentUser, db: DB
) -> ProfileOut:
    if file.content_type not in AVATAR_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Use a JPEG, PNG or WebP.")
    data = await file.read(AVATAR_MAX_BYTES + 1)
    if len(data) > AVATAR_MAX_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Avatar must be under 5 MB.")
    try:
        # One path per user, overwritten on each upload, so old avatars never pile up.
        path = await storage.upload(f"avatars/{user.id}", data, file.content_type)
    except storage.StorageError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    profile = await _profile(db, user)
    profile.avatar_path = path
    await db.flush()
    return await _out(profile, user)
