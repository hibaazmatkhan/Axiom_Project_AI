# Avatar Pack Integration

This folder is standalone. The app uses the copied PFP assets and native avatar routes; 3D character models remain disabled until Phase 5 polish is complete.

## Assets

These five files are included in `avatar-pack/assets/pfp/`:

- `joker.png`
- `spade.png`
- `club.png`
- `heart.png`
- `diamond.png`

During integration, copy them to `frontend/public/avatars/pfp/`.

## Local preview

A standalone preview lives in `avatar-pack/preview/`. It renders the five PFPs and all 16 Three.js avatars without touching the app:

- `npm install --prefix avatar-pack/preview`
- `npm --prefix avatar-pack/preview run dev`
- Open `http://127.0.0.1:5175`

The preview folder is included in the handoff. `node_modules/` and `dist/` are ignored.

## Frontend copy

Preserve this internal structure:

- `avatar-pack/contracts/` to `frontend/avatar-pack/contracts/`
- `avatar-pack/frontend/characters/` to `frontend/avatar-pack/frontend/characters/`
- `avatar-pack/frontend/pfp/` to `frontend/avatar-pack/frontend/pfp/`

Useful imports after copying:

- `@/avatar-pack/frontend/pfp/AvatarPicker`
- `@/avatar-pack/frontend/pfp/avatarApi`
- `@/avatar-pack/frontend/pfp/guestIdentity`
- `@/avatar-pack/frontend/characters/createCharacterModel`
- `@/avatar-pack/frontend/characters/CharacterRegistry`

Wire `avatarApi` to Firebase auth by passing the project token provider:

```ts
const avatarClient = createAvatarApi({
  tokenProvider: () => getFirebaseAuth().currentUser?.getIdToken() ?? null,
});
```

For guests, merge `guestAuthFrame(identity)` into the existing WebSocket auth frame.

## Backend copy

Copy these modules to `backend/app/`:

- `avatar_catalog.py`
- `avatar_storage.py`
- `avatar_adapters.py`
- `avatar_router.py`

Copy `avatar-pack/backend/migrations/003_avatar_fields.sql` to `backend/migrations/` and run it in Supabase.

After `app = FastAPI(...)`, include the router:

```py
from . import config, supabase_store
from .avatar_adapters import make_supabase_patch_profile, make_supabase_username_taken
from .avatar_router import create_avatar_router
from .avatar_storage import make_supabase_uploader
from .auth import get_current_user

app.include_router(
    create_avatar_router(
        current_user=get_current_user,
        update_profile=make_supabase_patch_profile(supabase_store),
        username_taken=make_supabase_username_taken(supabase_store),
        upload_image=make_supabase_uploader(
            url=config.SUPABASE_URL,
            service_role_key=config.SUPABASE_SERVICE_ROLE_KEY,
            bucket=config.SUPABASE_STORAGE_BUCKET,
        ),
    )
)
```

Extend `supabase_store.profile_public()` with:

```py
"avatar_preset_id": profile.get("avatar_preset_id"),
"character_id": profile.get("character_id"),
```

The Supabase `avatars` bucket must be public, or `avatar_storage.py` must be changed to return signed URLs.

## Runtime links

- Profile settings: render `AvatarPicker` and call `avatarClient.selectPfpPreset`, `avatarClient.uploadPfp`, `avatarClient.selectCharacter`, and `avatarClient.updateUsername`. Uploads are JSON base64, so no multipart middleware is required.
- Lobby: show the selected PFP and 3D character beside the player name.
- WebSocket: add `avatar_url`, `avatar_preset_id`, and `character_id` to player payloads so other clients render the same choices.
- GameCanvas: replace the capsule block with `createCharacterModel(getCharacterSpec(player.character_id))`; track each model, call `update(deltaMs)` in the animation loop, and `dispose()` on cleanup.

## Character modesty rule

Keep the current full-coverage look. Skin is limited to the head/face; torso, arms, and legs stay clothed. Do not add exposed midriffs, low necklines, short bottoms, form-fitting accents, or suggestive details. Palettes, accessories, builds, and heights are part of the approved roster and should not be changed without approval.

## Verification

- `python -m pytest -q avatar-pack/backend/tests`
- `frontend/node_modules/.bin/tsc -p avatar-pack/tsconfig.json`
- `npm --prefix avatar-pack/preview run build`
- After integration: `python -m pytest -q`, `npm --prefix frontend run build`, and a live room smoke.
