import asyncio
import json
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Annotated, Any, NoReturn
from urllib.parse import urlencode

import httpx
from fastapi import Body, Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel

from .config import Settings, get_settings
from .access_control import authorize_query, redact_result
from .booking_engine import BookingInput, BookingTransition, create_booking, quote_booking, transition_booking
from .builtin_functions import require_user
from .builtin_functions import handle_builtin_function
from .database import execute_rpc, execute_table_query, schema_contract_status as postgres_schema_contract_status
from .local_auth import (
    local_refresh,
    local_sign_in,
    local_sign_out,
    local_sign_up,
    local_update_user,
    user_from_access_token,
)
from .nhost_graphql import (
    execute_nhost_rpc,
    execute_nhost_table_query,
    schema_contract_status as nhost_schema_contract_status,
)
from .storage import PUBLIC_BUCKETS, put_object, read_object, read_public_avatar, signed_url, validate_path
from .payments import checkout, confirm_notification
from .routing import router as routing_router
from .reviews import router as reviews_router
from .social import toggle_post_like, create_comment
from .onboarding import router as onboarding_router
from .database import connect
from .database import close_pools
from .access_control import is_admin, require_admin
from .readiness import release_capabilities
from .auth_security import rate_limit, token_digest, recover_password, reset_password
from .provider_settings import router as provider_settings_router
from .reporting import router as reporting_router
from .provider_availability import router as provider_availability_router
from .location_tracking import router as location_tracking_router
from .account_deletion import router as account_deletion_router
from .dispatch_engine import router as dispatch_router
from .contracts import router as contracts_router
from .admin_moderation import router as admin_moderation_router, handle_content_review
from .financial_operations import create_financial_router
from .video_calls import handle_video_webhook


REQUIRED_SCHEMA_COLUMNS = {
    "profiles": [
        "id",
        "role",
        "full_name",
        "avatar_url",
        "bio",
        "city",
        "phone",
        "availability_status",
        "kyc_status",
        "age_verified",
    ],
    "photographers": [
        "id",
        "name",
        "bio",
        "price_range",
        "style",
        "tags",
        "portfolio_urls",
        "hourly_rate",
        "latitude",
        "longitude",
    ],
    "models": [
        "id",
        "name",
        "bio",
        "price_range",
        "style",
        "tags",
        "portfolio_urls",
        "hourly_rate",
        "latitude",
        "longitude",
    ],
    "bookings": [
        "id",
        "client_id",
        "photographer_id",
        "model_id",
        "status",
        "service_type",
        "package_id",
        "start_datetime",
        "end_datetime",
        "price_total",
        "is_instant",
        "assignment_state",
        "dispatch_request_id",
        "quote_token",
    ],
    "posts": ["id", "author_id", "media_url", "media_type", "created_at"],
    "conversations": ["id", "title", "last_message", "last_message_at", "created_at"],
    "conversation_participants": ["conversation_id", "user_id"],
    "messages": ["id", "conversation_id", "sender_id", "body", "created_at", "read_at", "deleted_at"],
    "reviews": ["id", "reviewer_id", "reviewee_id", "rating", "comment", "status", "created_at"],
    "notification_events": ["id", "user_id", "event_type", "title", "body", "status", "created_at"],
    "credits_wallets": ["user_id", "balance", "updated_at"],
    "credits_ledger": ["id", "user_id", "amount", "direction", "reason", "created_at"],
}
for _table, _columns in json.loads(Path(__file__).with_name("mobile_schema_contract.json").read_text()).items():
    REQUIRED_SCHEMA_COLUMNS[_table] = sorted(set(REQUIRED_SCHEMA_COLUMNS.get(_table, [])) | set(_columns))


class HealthResponse(BaseModel):
    status: str
    service: str
    environment: str


class VersionResponse(BaseModel):
    name: str
    version: str
    environment: str


class AuthMeResponse(BaseModel):
    id: str
    email: str | None
    roles: list[str]


@asynccontextmanager
async def lifespan(_app):
    get_settings()
    yield
    await close_pools()


app = FastAPI(
    title="PAPZII API",
    version="0.1.0",
    description="Public backend API boundary for PAPZII mobile clients.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(routing_router)
app.include_router(reviews_router)
app.include_router(onboarding_router)
app.include_router(provider_settings_router)
app.include_router(reporting_router)
app.include_router(provider_availability_router)
app.include_router(location_tracking_router)
app.include_router(account_deletion_router)
app.include_router(dispatch_router)
app.include_router(contracts_router)
app.include_router(admin_moderation_router)


async def financial_user(request: Request, settings: Annotated[Settings, Depends(get_settings)]):
    return await require_user(settings, bearer_token(request))


app.include_router(create_financial_router(get_settings, financial_user))


@app.middleware('http')
async def authentication_abuse_guard(request: Request, call_next):
    protected = {'/auth/sign-in', '/auth/sign-up', '/auth/refresh', '/auth/recover-password', '/auth/reset-password', '/functions/auth-signup'}
    path = request.scope.get('path', '')
    if request.method == 'POST' and path in protected:
        settings = get_settings()
        if settings.postgres_url:
            # Do not trust arbitrary client-supplied forwarding headers.
            remote = request.client.host if request.client else 'unknown'
            try:
                await rate_limit(settings, f'auth-ip:{path}:{remote}', 120)
            except HTTPException as error:
                return JSONResponse({'detail': error.detail}, status_code=error.status_code, headers=error.headers)
    return await call_next(request)


def raise_upstream_unreachable(provider: str, url: str, error: httpx.RequestError) -> NoReturn:
    try:
        host = httpx.URL(url).host or url
    except httpx.InvalidURL:
        host = url
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "provider": provider,
            "ok": False,
            "message": f"{provider} could not be reached.",
            "host": host,
            "error": type(error).__name__,
        },
    ) from error


@app.get("/health", response_model=HealthResponse, tags=["system"])
async def health(settings: Annotated[Settings, Depends(get_settings)]) -> HealthResponse:
    return HealthResponse(status="ok", service=settings.app_name, environment=settings.app_env)


@app.get("/version", response_model=VersionResponse, tags=["system"])
async def version(settings: Annotated[Settings, Depends(get_settings)]) -> VersionResponse:
    return VersionResponse(name=settings.app_name, version=settings.app_version, environment=settings.app_env)


@app.get("/health/readiness", tags=["system"])
async def health_readiness(settings: Annotated[Settings, Depends(get_settings)]):
    return release_capabilities(settings)


@app.get("/health/contract", tags=["system"])
async def health_contract(settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, Any]:
    if settings.postgres_url:
        result = await postgres_schema_contract_status(settings, REQUIRED_SCHEMA_COLUMNS)
    elif settings.resolved_nhost_graphql_url:
        result = await nhost_schema_contract_status(settings, REQUIRED_SCHEMA_COLUMNS)
    else:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No data backend is configured. Set DATABASE_URL/NEON_DATABASE_URL or NHOST_GRAPHQL_URL/NHOST_SUBDOMAIN.",
        )
    if not result.get("ok"):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=result)
    return result


def bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return None
    return header.split(" ", 1)[1].strip() or None


def normalize_user(raw: dict[str, Any] | None, settings: Settings) -> dict[str, Any] | None:
    if not raw:
        return None
    metadata = raw.get("metadata") or raw.get("user_metadata") or raw.get("raw_user_meta_data") or {}
    return {
        "id": raw.get("id") or raw.get("sub"),
        "email": raw.get("email"),
        "is_admin": is_admin(settings, {"id": raw.get("id") or raw.get("sub")}),
        "user_metadata": {
            "role": raw.get("defaultRole") or metadata.get("role") or "client",
            "full_name": raw.get("displayName") or metadata.get("full_name") or metadata.get("name"),
            "avatar_url": raw.get("avatarUrl") or metadata.get("avatar_url"),
            "kyc_status": metadata.get("kyc_status"),
            "age_verified": metadata.get("age_verified"),
        },
    }


def normalize_session(raw: dict[str, Any] | None, settings: Settings) -> dict[str, Any] | None:
    if not raw:
        return None
    user = normalize_user(raw.get("user"), settings)
    return {
        "access_token": raw.get("accessToken") or raw.get("access_token"),
        "refresh_token": raw.get("refreshToken") or raw.get("refresh_token"),
        "expires_at": raw.get("accessTokenExpiresAt") or raw.get("expires_at"),
        "user": user,
    }


def metadata_from_auth_options(options: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(options, dict):
        return {}
    metadata: dict[str, Any] = {}
    for key in ("metadata", "data", "user_metadata"):
        value = options.get(key)
        if isinstance(value, dict):
            metadata.update(value)
    return metadata


async def nhost_auth_request(
    settings: Settings,
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
    token: str | None = None,
) -> dict[str, Any]:
    if not settings.resolved_nhost_auth_url:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Nhost Auth is not configured.")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    url = f"{settings.resolved_nhost_auth_url}/{path.lstrip('/')}"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.request(
                method,
                url,
                json=body,
                headers=headers,
            )
    except httpx.RequestError as error:
        raise_upstream_unreachable("nhost_auth", url, error)
    if response.status_code >= 400:
        detail = response.json() if response.headers.get("content-type", "").startswith("application/json") else response.text
        raise HTTPException(status_code=response.status_code, detail=detail)
    return response.json() if response.content else {}


async def ensure_signup_profile(
    settings: Settings,
    user: dict[str, Any],
    options: dict[str, Any] | None,
    token: str | None = None,
) -> None:
    user_id = user.get("id")
    if not user_id:
        return
    metadata = metadata_from_auth_options(options)
    role = metadata.get("role") or "client"
    profile = {
        "id": user_id,
        "role": role,
        "verified": False,
        "kyc_status": "pending" if role in {"photographer", "model"} else None,
        "full_name": (options.get("displayName") if isinstance(options, dict) else None)
        or metadata.get("full_name")
        or metadata.get("name"),
        "city": metadata.get("city"),
        "phone": metadata.get("phone"),
        "date_of_birth": metadata.get("date_of_birth"),
        "age_verified": bool(metadata.get("date_of_birth")),
        "age_verified_at": None,
        "contact_details": {"gender": metadata.get("gender")},
        "availability_status": "offline" if role in {"photographer", "model"} else None,
        "avatar_url": None,
    }
    query = {
        "action": "upsert",
        "payload": profile,
        "select": "*",
        "onConflict": "id",
        "maybeSingle": True,
        "filters": [],
    }
    if settings.postgres_url:
        await execute_table_query(settings, "profiles", query)
    elif settings.resolved_nhost_graphql_url:
        await execute_nhost_table_query(settings, "profiles", query, token)


@app.get("/auth/me", tags=["auth"])
async def auth_me(request: Request, settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, Any]:
    token = bearer_token(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token.")
    if settings.postgres_url:
        user = await user_from_access_token(settings, token)
        role = (user.get("user_metadata") or {}).get("role") or "client"
        return {"user": user, "id": user.get("id"), "email": user.get("email"), "roles": [role]}
    body = await nhost_auth_request(settings, "GET", "/user", token=token)
    user = normalize_user(body, settings)
    return {"user": user, "id": user.get("id") if user else "", "email": user.get("email") if user else None, "roles": []}


@app.post("/auth/sign-in", tags=["auth"])
async def auth_sign_in(
    payload: Annotated[dict[str, Any], Body()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    if settings.postgres_url:
        return await local_sign_in(settings, payload)
    body = await nhost_auth_request(
        settings,
        "POST",
        "/signin/email-password",
        {"email": payload.get("email"), "password": payload.get("password")},
    )
    session = normalize_session(body.get("session") or body, settings)
    return {"session": session, "user": session.get("user") if session else normalize_user(body.get("user"), settings)}


@app.post("/auth/sign-up", tags=["auth"])
async def auth_sign_up(
    payload: Annotated[dict[str, Any], Body()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    if settings.postgres_url:
        return await local_sign_up(settings, payload)
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    body = await nhost_auth_request(
        settings,
        "POST",
        "/signup/email-password",
        {
            "email": payload.get("email"),
            "password": payload.get("password"),
            "options": options,
        },
    )
    session = normalize_session(body.get("session") or body, settings)
    user = session.get("user") if session else normalize_user(body.get("user"), settings)
    if user:
        await ensure_signup_profile(settings, user, options, session.get("access_token") if session else None)
    return {"session": session, "user": user}


@app.post("/auth/sign-out", tags=["auth"])
async def auth_sign_out(request: Request, settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, bool]:
    token = bearer_token(request)
    if settings.postgres_url:
        await local_sign_out(settings, token)
        return {"success": True}
    if token:
        await nhost_auth_request(settings, "POST", "/signout", token=token)
    return {"success": True}


@app.post("/auth/refresh", tags=["auth"])
async def auth_refresh(
    payload: Annotated[dict[str, Any], Body()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    if settings.postgres_url:
        return await local_refresh(settings, payload.get("refresh_token"))
    body = await nhost_auth_request(settings, "POST", "/token", {"refreshToken": payload.get("refresh_token")})
    session = normalize_session(body.get("session") or body, settings)
    return {"session": session, "user": session.get("user") if session else None}


@app.post("/auth/oauth", tags=["auth"])
async def auth_oauth(payload: Annotated[dict[str, Any], Body()], settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, str]:
    provider = str(payload.get("provider") or "").strip()
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    redirect_to = options.get("redirectTo") or ""
    if settings.postgres_url:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"OAuth provider {provider or 'unknown'} is not configured on the self-hosted API yet. Use email and password sign-in.")
    if not provider or not settings.resolved_nhost_auth_url:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="OAuth is not configured.")
    params: dict[str, str] = {}
    if redirect_to:
        params["redirectTo"] = str(redirect_to)
    code_challenge = options.get("codeChallenge") or options.get("code_challenge")
    if code_challenge:
        params["code_challenge"] = str(code_challenge)
        params["code_challenge_method"] = str(options.get("codeChallengeMethod") or options.get("code_challenge_method") or "S256")
    query = f"?{urlencode(params)}" if params else ""
    return {"url": f"{settings.resolved_nhost_auth_url}/signin/provider/{provider}{query}"}


@app.post('/auth/recover-password', tags=['auth'])
async def auth_recover(payload: Annotated[dict[str, Any], Body()], settings: Annotated[Settings, Depends(get_settings)]):
    if not settings.postgres_url:
        raise HTTPException(status_code=503, detail='Password recovery is unavailable on this backend.')
    return await recover_password(settings, str(payload.get('email') or ''))


@app.post('/auth/reset-password', tags=['auth'])
async def auth_reset(payload: Annotated[dict[str, Any], Body()], settings: Annotated[Settings, Depends(get_settings)]):
    return await reset_password(settings, str(payload.get('token') or ''), str(payload.get('password') or ''))


@app.get('/auth/sessions', tags=['auth'])
async def auth_sessions(request: Request, settings: Annotated[Settings, Depends(get_settings)]):
    user = await require_user(settings, bearer_token(request))
    conn = await connect(settings)
    try:
        rows = await conn.fetch('SELECT id,created_at,expires_at,access_token FROM api_sessions WHERE user_id=$1 AND refresh_expires_at>now() ORDER BY created_at DESC', user['id'])
        current = token_digest(bearer_token(request))
        return {'sessions': [{'id': row['id'], 'created_at': row['created_at'], 'expires_at': row['expires_at'], 'current': row['access_token'] == current} for row in rows]}
    finally:
        await conn.close()


@app.post('/auth/sessions/revoke', tags=['auth'])
async def auth_revoke_session(request: Request, payload: Annotated[dict[str, Any], Body()], settings: Annotated[Settings, Depends(get_settings)]):
    user = await require_user(settings, bearer_token(request))
    conn = await connect(settings)
    try:
        result = await conn.execute('DELETE FROM api_sessions WHERE id=$1 AND user_id=$2', str(payload.get('session_id') or ''), user['id'])
        if result == 'DELETE 0':
            raise HTTPException(status_code=404, detail='Session not found.')
        return {'revoked': True}
    finally:
        await conn.close()


@app.post("/auth/exchange", tags=["auth"])
async def auth_exchange(
    payload: Annotated[dict[str, Any], Body()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    code = payload.get("code")
    code_verifier = payload.get("codeVerifier") or payload.get("code_verifier")
    if settings.postgres_url:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="OAuth code exchange is not configured on the self-hosted API yet.")
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing OAuth code.")
    body = await nhost_auth_request(
        settings,
        "POST",
        "/token/exchange",
        {"code": code, "codeVerifier": code_verifier},
    )
    session = normalize_session(body.get("session") or body, settings)
    return {"session": session, "user": session.get("user") if session else normalize_user(body.get("user"), settings)}


@app.post("/auth/update-user", tags=["auth"])
async def auth_update_user(
    request: Request,
    payload: Annotated[dict[str, Any], Body()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    token = bearer_token(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token.")
    if settings.postgres_url:
        return await local_update_user(settings, token, payload)
    try:
        body = await nhost_auth_request(settings, "PATCH", "/user", payload, token=token)
        return {"user": normalize_user(body.get("user") or body, settings)}
    except HTTPException:
        # Profile updates should not fail just because the auth provider rejected
        # a cosmetic metadata update. Return the current user and let the profile
        # table update continue on the client.
        body = await nhost_auth_request(settings, "GET", "/user", token=token)
        return {"user": normalize_user(body, settings)}


@app.post("/data/{table}", tags=["data"])
async def data_query(
    table: str,
    request: Request,
    payload: Annotated[dict[str, Any], Body()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    if settings.postgres_url:
        token = bearer_token(request)
        user = await user_from_access_token(settings, token) if token else None
        if table == 'model_services' and payload.get('action', 'select') != 'select':
            if not user:
                raise HTTPException(status_code=401, detail='Authentication is required.')
            raise HTTPException(status_code=403, detail='Use the model-services replacement command to save services atomically.')
        records = payload.get('payload')
        records = records if isinstance(records, list) else [records]
        fields = {field for row in records if isinstance(row, dict) for field in row}
        if payload.get('action', 'select') != 'select' and (
            table == 'location_tracks'
            or (table == 'profiles' and 'availability_status' in fields)
            or (table in {'photographers', 'models'} and 'is_online' in fields)
        ):
            await require_user(settings, token)
            raise HTTPException(status_code=403, detail='Use the authenticated provider availability or booking location command.')
        if table == "bookings" and payload.get("action") == "insert":
            user = await require_user(settings, token)
            row = await create_booking(settings, BookingInput.model_validate(payload.get("payload")), user)
            return {"data": row if payload.get("single") else [row], "error": None}
        if table == "bookings" and payload.get("action") == "update" and set(payload.get("payload") or {}) == {"status"}:
            user = await require_user(settings, token)
            booking_id = next((str(item.get("value")) for item in payload.get("filters", []) if item.get("op") == "eq" and item.get("column") == "id"), None)
            if not booking_id:
                raise HTTPException(status_code=400, detail="A specific booking ID is required.")
            target = BookingTransition.model_validate(payload["payload"])
            row = await transition_booking(settings, booking_id, target.status, user)
            return {"data": row if payload.get("single") else [row], "error": None}
        authorized, scope = authorize_query(settings, table, payload, user)
        result = await execute_table_query(settings, table, authorized, scope, actor_id=user['id'] if user else None)
        return redact_result(settings, table, result, user)
    return await execute_nhost_table_query(settings, table, payload, bearer_token(request))


@app.post("/bookings/quote", tags=["bookings"])
async def booking_quote(command: BookingInput, request: Request, settings: Annotated[Settings, Depends(get_settings)]):
    user = await require_user(settings, bearer_token(request))
    return await quote_booking(settings, command, user)


@app.post("/bookings", tags=["bookings"])
async def booking_create(command: BookingInput, request: Request, settings: Annotated[Settings, Depends(get_settings)]):
    user = await require_user(settings, bearer_token(request))
    return await create_booking(settings, command, user)


@app.patch("/bookings/{booking_id}", tags=["bookings"])
async def booking_transition(booking_id: str, command: BookingTransition, request: Request, settings: Annotated[Settings, Depends(get_settings)]):
    user = await require_user(settings, bearer_token(request))
    return await transition_booking(settings, booking_id, command.status, user)


@app.post("/rpc/{name}", tags=["data"])
async def rpc_query(
    name: str,
    request: Request,
    payload: Annotated[dict[str, Any], Body()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    if settings.postgres_url:
        if name == "toggle_post_like":
            user = await require_user(settings, bearer_token(request))
            return await toggle_post_like(settings, user, payload)
        raise HTTPException(status_code=403, detail="Direct database functions are not exposed. Use the application services.")
    return await execute_nhost_rpc(settings, name, payload, bearer_token(request))


@app.post('/social/comments', tags=['social'])
async def social_comment(request: Request, payload: Annotated[dict[str, Any], Body()], settings: Annotated[Settings, Depends(get_settings)]):
    user = await require_user(settings, bearer_token(request))
    return await create_comment(settings, user, payload)


@app.post('/moderation/review', tags=['moderation'])
async def moderate_content(request: Request, payload: Annotated[dict[str, Any], Body()], settings: Annotated[Settings, Depends(get_settings)]):
    user = await require_user(settings, bearer_token(request))
    return await handle_content_review(settings, user, payload)


@app.post('/video-calls/webhook', tags=['video'])
async def video_webhook(request: Request, settings: Annotated[Settings, Depends(get_settings)]):
    body = await request.body()
    if len(body) > 262144:
        raise HTTPException(status_code=413, detail='Video webhook is too large.')
    try:
        text = body.decode('utf-8')
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail='Invalid webhook encoding.') from None
    return await handle_video_webhook(settings, text, request.headers.get('authorization'))


@app.post("/graphql", tags=["graphql"])
async def graphql_proxy(
    request: Request,
    payload: Annotated[dict[str, Any], Body()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    if not settings.resolved_nhost_graphql_url:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="GraphQL is not configured.")
    headers = {"Content-Type": "application/json"}
    token = bearer_token(request)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(settings.resolved_nhost_graphql_url, json=payload, headers=headers)
    except httpx.RequestError as error:
        raise_upstream_unreachable("nhost_graphql", settings.resolved_nhost_graphql_url, error)
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text)
    return response.json()


@app.post("/storage/upload", tags=["storage"])
async def storage_upload(
    request: Request,
    payload: Annotated[dict[str, Any], Body()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    user = await require_user(settings, bearer_token(request))
    conn = await connect(settings)
    try:
        async with conn.transaction():
            state = await conn.fetchval("SELECT metadata->>'deletion_status' FROM api_users WHERE id=$1 FOR UPDATE", user['id'])
            if state:
                raise HTTPException(status_code=409, detail='Uploads are disabled while account deletion is pending.')
            # Cleanup waits for an in-flight upload before enumerating owned keys.
            return await run_in_threadpool(put_object, settings, payload, user["id"])
    finally:
        await conn.close()


@app.post("/storage/signed-url", tags=["storage"])
async def storage_signed_url(
    request: Request,
    payload: Annotated[dict[str, Any], Body()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str]:
    user = await require_user(settings, bearer_token(request))
    bucket, path = str(payload.get("bucket") or ""), str(payload.get("path") or "")
    validate_path(bucket, path)
    own = path.startswith(f"users/{user['id']}/")
    if bucket not in PUBLIC_BUCKETS and not own and not is_admin(settings, user):
        conn = await connect(settings)
        try:
            shared = await conn.fetchval(
                """SELECT EXISTS(SELECT 1 FROM media_assets m JOIN bookings b ON b.id=m.booking_id
                WHERE m.object_path=$1 AND m.bucket=$3 AND (b.client_id=$2 OR b.photographer_id=$2 OR b.model_id=$2))""", path, user["id"], bucket,
            )
            if not shared and bucket == "chat-media":
                shared = await conn.fetchval(
                    """SELECT EXISTS(SELECT 1 FROM messages m
                    JOIN conversation_participants p ON p.conversation_id=m.conversation_id
                    WHERE m.media_url=$1 AND p.user_id=$2 AND m.deleted_at IS NULL
                    AND NOT EXISTS(SELECT 1 FROM conversation_participants other JOIN user_blocks b
                    ON (b.blocker_id=$2 AND b.blocked_id=other.user_id) OR (b.blocked_id=$2 AND b.blocker_id=other.user_id)
                    WHERE other.conversation_id=m.conversation_id))""",
                    f"{bucket}::{path}", user["id"],
                )
        finally:
            await conn.close()
        if not shared or bucket == "kyc-documents":
            raise HTTPException(status_code=403, detail="This media belongs to another user.")
    return signed_url(settings, bucket, path)


@app.get("/storage/object", tags=["storage"])
async def storage_object(bucket: str, path: str, expiry: int, signature: str, settings: Annotated[Settings, Depends(get_settings)]):
    await require_active_media_owner(settings, path)
    obj = await run_in_threadpool(read_object, settings, bucket, path, expiry, signature)
    def chunks():
        try:
            yield from obj["Body"].iter_chunks(chunk_size=65536)
        finally:
            obj["Body"].close()
    return StreamingResponse(chunks(), media_type=obj.get("ContentType", "application/octet-stream"),
                             headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=300"})


@app.get('/storage/avatar', tags=['storage'])
async def storage_avatar(path: str, settings: Annotated[Settings, Depends(get_settings)]):
    await require_active_media_owner(settings, path)
    obj = await run_in_threadpool(read_public_avatar, settings, path)
    def chunks():
        try:
            yield from obj['Body'].iter_chunks(chunk_size=65536)
        finally:
            obj['Body'].close()
    return StreamingResponse(chunks(), media_type=obj.get('ContentType', 'application/octet-stream'),
                             headers={'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=300'})


async def require_active_media_owner(settings, path):
    parts = path.split('/')
    if len(parts) < 3 or parts[0] != 'users':
        raise HTTPException(status_code=404, detail='Media not found.')
    conn = await connect(settings)
    try:
        owner = await conn.fetchrow("SELECT metadata->>'deletion_status' AS deletion_status FROM api_users WHERE id=$1", parts[1])
        if not owner or owner['deletion_status'] in {'processing', 'completed'}:
            raise HTTPException(status_code=404, detail='Media not found.')
    finally:
        await conn.close()


@app.post("/payments/checkout", tags=["payments"])
async def payment_checkout(request: Request, payload: Annotated[dict[str, Any], Body()], settings: Annotated[Settings, Depends(get_settings)]):
    user = await require_user(settings, bearer_token(request))
    return await checkout(settings, str(payload.get("booking_id") or ""), user)


@app.post("/payments/payfast/itn", tags=["payments"])
async def payment_notification(request: Request, settings: Annotated[Settings, Depends(get_settings)]):
    await confirm_notification(settings, await request.body())
    return {"received": True}


@app.get("/payments/return", response_class=HTMLResponse, tags=["payments"])
async def payment_return():
    return '<html><body><h1>Return to PAPZII</h1><p>Payment confirmation is checked with the payment gateway, not this page.</p><a href="papzi://payfast/success">Open your booking</a></body></html>'


@app.get("/payments/cancel", response_class=HTMLResponse, tags=["payments"])
async def payment_cancel():
    return '<html><body><h1>Checkout cancelled</h1><a href="papzi://payfast/cancel">Return to PAPZII</a></body></html>'


@app.post("/functions/{name}", tags=["functions"])
async def function_proxy(
    name: str,
    request: Request,
    payload: Annotated[dict[str, Any], Body()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    if name == "auth-signup":
      result = await auth_sign_up(
          {
              "email": payload.get("email"),
              "password": payload.get("password"),
              "options": {
                  "displayName": payload.get("fullName"),
                  "metadata": {
                      "role": payload.get("role") or "client",
                      "full_name": payload.get("fullName"),
                      "city": (payload.get("extras") or {}).get("city") if isinstance(payload.get("extras"), dict) else None,
                      "phone": (payload.get("extras") or {}).get("phone") if isinstance(payload.get("extras"), dict) else None,
                      "gender": (payload.get("extras") or {}).get("gender") if isinstance(payload.get("extras"), dict) else None,
                      "date_of_birth": payload.get("dob"),
                  },
              },
          },
          settings,
      )
      return {"user": result.get("user")}

    builtin = await handle_builtin_function(settings, name, bearer_token(request), payload)
    if builtin is not None:
        return builtin

    if settings.postgres_url:
        raise HTTPException(status_code=404, detail=f"Application service {name} is not available.")

    if not settings.resolved_nhost_functions_url:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Function {name} is not configured.")
    headers = {"Content-Type": "application/json"}
    token = bearer_token(request)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    url = f"{settings.resolved_nhost_functions_url}/{name}"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, json=payload, headers=headers)
    except httpx.RequestError as error:
        raise_upstream_unreachable("nhost_functions", url, error)
    if response.status_code >= 400:
        detail = response.json() if response.headers.get("content-type", "").startswith("application/json") else response.text
        raise HTTPException(status_code=response.status_code, detail=detail)
    return response.json() if response.content else {"success": True}
