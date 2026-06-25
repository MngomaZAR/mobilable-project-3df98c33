from typing import Annotated, Any
from urllib.parse import urlencode

import httpx
from fastapi import Body, Depends, FastAPI, HTTPException, Request, status
from pydantic import BaseModel

from .config import Settings, get_settings
from .database import execute_rpc, execute_table_query, schema_contract_status as postgres_schema_contract_status
from .nhost_graphql import (
    execute_nhost_rpc,
    execute_nhost_table_query,
    schema_contract_status as nhost_schema_contract_status,
)
from .storage import put_object, signed_url


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


app = FastAPI(
    title="PAPZII API",
    version="0.1.0",
    description="Public backend API boundary for PAPZII mobile clients.",
)


@app.get("/health", response_model=HealthResponse, tags=["system"])
async def health(settings: Annotated[Settings, Depends(get_settings)]) -> HealthResponse:
    return HealthResponse(status="ok", service=settings.app_name, environment=settings.app_env)


@app.get("/version", response_model=VersionResponse, tags=["system"])
async def version(settings: Annotated[Settings, Depends(get_settings)]) -> VersionResponse:
    return VersionResponse(name=settings.app_name, version=settings.app_version, environment=settings.app_env)


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


def normalize_user(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    if not raw:
        return None
    metadata = raw.get("metadata") or raw.get("user_metadata") or raw.get("raw_user_meta_data") or {}
    return {
        "id": raw.get("id") or raw.get("sub"),
        "email": raw.get("email"),
        "user_metadata": {
            "role": raw.get("defaultRole") or metadata.get("role") or "client",
            "full_name": raw.get("displayName") or metadata.get("full_name") or metadata.get("name"),
            "avatar_url": raw.get("avatarUrl") or metadata.get("avatar_url"),
            "kyc_status": metadata.get("kyc_status"),
            "age_verified": metadata.get("age_verified"),
        },
    }


def normalize_session(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    if not raw:
        return None
    user = normalize_user(raw.get("user"))
    return {
        "access_token": raw.get("accessToken") or raw.get("access_token"),
        "refresh_token": raw.get("refreshToken") or raw.get("refresh_token"),
        "expires_at": raw.get("accessTokenExpiresAt") or raw.get("expires_at"),
        "user": user,
    }


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
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.request(
            method,
            f"{settings.resolved_nhost_auth_url}/{path.lstrip('/')}",
            json=body,
            headers=headers,
        )
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
    metadata = options.get("metadata", {}) if isinstance(options, dict) else {}
    role = metadata.get("role") or "client"
    profile = {
        "id": user_id,
        "role": role,
        "verified": False,
        "kyc_status": "pending" if role in {"photographer", "model"} else None,
        "full_name": options.get("displayName") if isinstance(options, dict) else None,
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
    body = await nhost_auth_request(settings, "GET", "/user", token=token)
    user = normalize_user(body)
    return {"user": user, "id": user.get("id") if user else "", "email": user.get("email") if user else None, "roles": []}


@app.post("/auth/sign-in", tags=["auth"])
async def auth_sign_in(
    payload: Annotated[dict[str, Any], Body()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    body = await nhost_auth_request(
        settings,
        "POST",
        "/signin/email-password",
        {"email": payload.get("email"), "password": payload.get("password")},
    )
    session = normalize_session(body.get("session") or body)
    return {"session": session, "user": session.get("user") if session else normalize_user(body.get("user"))}


@app.post("/auth/sign-up", tags=["auth"])
async def auth_sign_up(
    payload: Annotated[dict[str, Any], Body()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
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
    session = normalize_session(body.get("session") or body)
    user = session.get("user") if session else normalize_user(body.get("user"))
    if user:
        await ensure_signup_profile(settings, user, options, session.get("access_token") if session else None)
    return {"session": session, "user": user}


@app.post("/auth/sign-out", tags=["auth"])
async def auth_sign_out(request: Request, settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, bool]:
    token = bearer_token(request)
    if token:
        await nhost_auth_request(settings, "POST", "/signout", token=token)
    return {"success": True}


@app.post("/auth/refresh", tags=["auth"])
async def auth_refresh(
    payload: Annotated[dict[str, Any], Body()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    body = await nhost_auth_request(settings, "POST", "/token", {"refreshToken": payload.get("refresh_token")})
    session = normalize_session(body.get("session") or body)
    return {"session": session, "user": session.get("user") if session else None}


@app.post("/auth/oauth", tags=["auth"])
async def auth_oauth(payload: Annotated[dict[str, Any], Body()], settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, str]:
    provider = str(payload.get("provider") or "").strip()
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    redirect_to = options.get("redirectTo") or ""
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


@app.post("/auth/exchange", tags=["auth"])
async def auth_exchange(
    payload: Annotated[dict[str, Any], Body()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    code = payload.get("code")
    code_verifier = payload.get("codeVerifier") or payload.get("code_verifier")
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing OAuth code.")
    body = await nhost_auth_request(
        settings,
        "POST",
        "/token/exchange",
        {"code": code, "codeVerifier": code_verifier},
    )
    session = normalize_session(body.get("session") or body)
    return {"session": session, "user": session.get("user") if session else normalize_user(body.get("user"))}


@app.post("/auth/update-user", tags=["auth"])
async def auth_update_user(
    request: Request,
    payload: Annotated[dict[str, Any], Body()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    token = bearer_token(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token.")
    try:
        body = await nhost_auth_request(settings, "PATCH", "/user", payload, token=token)
        return {"user": normalize_user(body.get("user") or body)}
    except HTTPException:
        # Profile updates should not fail just because the auth provider rejected
        # a cosmetic metadata update. Return the current user and let the profile
        # table update continue on the client.
        body = await nhost_auth_request(settings, "GET", "/user", token=token)
        return {"user": normalize_user(body)}


@app.post("/data/{table}", tags=["data"])
async def data_query(
    table: str,
    request: Request,
    payload: Annotated[dict[str, Any], Body()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    if settings.postgres_url:
        return await execute_table_query(settings, table, payload)
    return await execute_nhost_table_query(settings, table, payload, bearer_token(request))


@app.post("/rpc/{name}", tags=["data"])
async def rpc_query(
    name: str,
    request: Request,
    payload: Annotated[dict[str, Any], Body()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    if settings.postgres_url:
        return await execute_rpc(settings, name, payload)
    return await execute_nhost_rpc(settings, name, payload, bearer_token(request))


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
    if settings.nhost_admin_secret:
        headers["x-hasura-admin-secret"] = settings.nhost_admin_secret
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(settings.resolved_nhost_graphql_url, json=payload, headers=headers)
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text)
    return response.json()


@app.post("/storage/upload", tags=["storage"])
async def storage_upload(
    payload: Annotated[dict[str, Any], Body()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    return put_object(settings, payload)


@app.post("/storage/signed-url", tags=["storage"])
async def storage_signed_url(
    payload: Annotated[dict[str, Any], Body()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str]:
    return signed_url(settings, str(payload.get("bucket") or ""), str(payload.get("path") or ""))


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

    if not settings.resolved_nhost_functions_url:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Function {name} is not configured.")
    headers = {"Content-Type": "application/json"}
    token = bearer_token(request)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(f"{settings.resolved_nhost_functions_url}/{name}", json=payload, headers=headers)
    if response.status_code >= 400:
        detail = response.json() if response.headers.get("content-type", "").startswith("application/json") else response.text
        raise HTTPException(status_code=response.status_code, detail=detail)
    return response.json() if response.content else {"success": True}
