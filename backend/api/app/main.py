from typing import Annotated

from fastapi import Depends, FastAPI
from pydantic import BaseModel

from .auth import Principal, get_principal
from .config import Settings, get_settings


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


@app.get("/auth/me", response_model=AuthMeResponse, tags=["auth"])
async def auth_me(principal: Annotated[Principal, Depends(get_principal)]) -> AuthMeResponse:
    return AuthMeResponse(id=principal.subject, email=principal.email, roles=principal.roles)
