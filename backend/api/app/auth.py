from dataclasses import dataclass
from typing import Annotated, Any

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from .config import Settings, get_settings


bearer = HTTPBearer(auto_error=False)


@dataclass
class Principal:
    subject: str
    email: str | None
    roles: list[str]
    claims: dict[str, Any]


class KeycloakVerifier:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._jwks: dict[str, Any] | None = None

    @property
    def issuer(self) -> str:
        base = self.settings.keycloak_url.rstrip("/")
        realm = self.settings.keycloak_realm
        return f"{base}/realms/{realm}"

    async def jwks(self) -> dict[str, Any]:
        if self._jwks is None:
            if not self.settings.keycloak_url or not self.settings.keycloak_realm:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Keycloak is not configured.",
                )
            async with httpx.AsyncClient(timeout=8) as client:
                response = await client.get(f"{self.issuer}/protocol/openid-connect/certs")
                response.raise_for_status()
                self._jwks = response.json()
        return self._jwks

    async def verify(self, token: str) -> Principal:
        try:
            claims = jwt.decode(
                token,
                await self.jwks(),
                algorithms=["RS256"],
                audience=self.settings.keycloak_audience,
                issuer=self.issuer,
                options={"verify_at_hash": False},
            )
        except JWTError as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.") from exc

        realm_roles = claims.get("realm_access", {}).get("roles", [])
        client_roles = []
        resource_access = claims.get("resource_access", {})
        for access in resource_access.values():
            client_roles.extend(access.get("roles", []))
        roles = sorted(set([*realm_roles, *client_roles]))
        return Principal(
            subject=str(claims.get("sub", "")),
            email=claims.get("email"),
            roles=roles,
            claims=claims,
        )


async def get_principal(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Principal:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token.")
    return await KeycloakVerifier(settings).verify(credentials.credentials)
