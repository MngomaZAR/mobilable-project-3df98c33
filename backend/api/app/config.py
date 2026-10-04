from functools import lru_cache
from ipaddress import ip_network
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "PAPZII API"
    app_env: str = Field(default="development", alias="APP_ENV")
    app_version: str = Field(default="0.1.0", alias="APP_VERSION")
    api_public_url: str = Field(default="", alias="API_PUBLIC_URL")
    forwarded_allow_ips: str = Field(default="127.0.0.1", alias="FORWARDED_ALLOW_IPS")
    allow_runtime_schema_changes: bool = Field(default=False, alias="ALLOW_RUNTIME_SCHEMA_CHANGES")
    admin_user_ids: str = Field(default="", alias="ADMIN_USER_IDS")
    commission_rate: float = Field(default=0.20, alias="COMMISSION_RATE", ge=0, le=1)
    payfast_sandbox: bool = Field(default=True, alias="PAYFAST_SANDBOX")
    payfast_checkout_enabled: bool = Field(default=False, alias="PAYFAST_CHECKOUT_ENABLED")
    payfast_return_url: str = Field(default="", alias="PAYFAST_RETURN_URL")
    payfast_cancel_url: str = Field(default="", alias="PAYFAST_CANCEL_URL")
    osrm_base_url: str = Field(default="", alias="OSRM_BASE_URL")
    openrouteservice_api_key: str = Field(default="", alias="OPENROUTESERVICE_API_KEY")
    expo_access_token: str = Field(default="", alias="EXPO_ACCESS_TOKEN")
    smtp_host: str = Field(default="", alias="SMTP_HOST")
    smtp_port: int = Field(default=587, alias="SMTP_PORT", ge=1, le=65535)
    smtp_user: str = Field(default="", alias="SMTP_USER")
    smtp_password: str = Field(default="", alias="SMTP_PASSWORD")
    smtp_from: str = Field(default="", alias="SMTP_FROM")
    smtp_ssl: bool = Field(default=False, alias="SMTP_SSL")
    recovery_encryption_key: str = Field(default="", alias="RECOVERY_ENCRYPTION_KEY")

    neon_database_url: str = Field(default="", alias="NEON_DATABASE_URL")
    database_url: str = Field(default="", alias="DATABASE_URL")

    keycloak_url: str = Field(default="", alias="KEYCLOAK_URL")
    keycloak_realm: str = Field(default="", alias="KEYCLOAK_REALM")
    keycloak_audience: str = Field(default="papzi-mobile", alias="KEYCLOAK_AUDIENCE")
    keycloak_client_secret: str = Field(default="", alias="KEYCLOAK_CLIENT_SECRET")

    nhost_subdomain: str = Field(default="", alias="NHOST_SUBDOMAIN")
    nhost_region: str = Field(default="", alias="NHOST_REGION")
    nhost_auth_url: str = Field(default="", alias="NHOST_AUTH_URL")
    nhost_graphql_url: str = Field(default="", alias="NHOST_GRAPHQL_URL")
    nhost_functions_url: str = Field(default="", alias="NHOST_FUNCTIONS_URL")
    nhost_admin_secret: str = Field(default="", alias="NHOST_ADMIN_SECRET")

    minio_endpoint: str = Field(default="", alias="MINIO_ENDPOINT")
    minio_access_key: str = Field(default="", alias="MINIO_ACCESS_KEY")
    minio_secret_key: str = Field(default="", alias="MINIO_SECRET_KEY")
    minio_bucket_media: str = Field(default="papzi-media", alias="MINIO_BUCKET_MEDIA")

    nats_url: str = Field(default="nats://nats:4222", alias="NATS_URL")
    typesense_host: str = Field(default="typesense", alias="TYPESENSE_HOST")
    typesense_port: int = Field(default=8108, alias="TYPESENSE_PORT")
    typesense_protocol: str = Field(default="http", alias="TYPESENSE_PROTOCOL")
    typesense_api_key: str = Field(default="", alias="TYPESENSE_API_KEY")

    livekit_url: str = Field(default="", alias="LIVEKIT_URL")
    livekit_enabled: bool = Field(default=False, alias="LIVEKIT_ENABLED")
    livekit_api_url: str = Field(default="", alias="LIVEKIT_API_URL")
    livekit_api_key: str = Field(default="", alias="LIVEKIT_API_KEY")
    livekit_api_secret: str = Field(default="", alias="LIVEKIT_API_SECRET")
    payfast_base_url: str = Field(default="", alias="PAYFAST_BASE_URL")
    payfast_merchant_id: str = Field(default="", alias="PAYFAST_MERCHANT_ID")
    payfast_merchant_key: str = Field(default="", alias="PAYFAST_MERCHANT_KEY")
    payfast_passphrase: str = Field(default="", alias="PAYFAST_PASSPHRASE")

    @field_validator("forwarded_allow_ips")
    @classmethod
    def validate_trusted_proxies(cls, value: str) -> str:
        if not value.strip():
            return ""
        entries = [entry.strip() for entry in value.split(",")]
        for entry in entries:
            if not entry or entry == "*":
                raise ValueError("Trust explicit reverse-proxy IPs, never a wildcard.")
            network = ip_network(entry, strict=False)
            if network.prefixlen == 0:
                raise ValueError("A trusted reverse proxy cannot cover every IP address.")
        return ",".join(entries)

    @property
    def postgres_url(self) -> str:
        return self.neon_database_url or self.database_url

    @property
    def resolved_nhost_auth_url(self) -> str:
        if self.nhost_auth_url:
            return self.nhost_auth_url.rstrip("/")
        if self.nhost_subdomain and self.nhost_region:
            return f"https://{self.nhost_subdomain}.auth.{self.nhost_region}.nhost.run/v1"
        return ""

    @property
    def resolved_nhost_graphql_url(self) -> str:
        if self.nhost_graphql_url:
            return self.nhost_graphql_url.rstrip("/")
        if self.nhost_subdomain and self.nhost_region:
            return f"https://{self.nhost_subdomain}.graphql.{self.nhost_region}.nhost.run/v1"
        return ""

    @property
    def resolved_nhost_functions_url(self) -> str:
        if self.nhost_functions_url:
            return self.nhost_functions_url.rstrip("/")
        if self.nhost_subdomain and self.nhost_region:
            return f"https://{self.nhost_subdomain}.functions.{self.nhost_region}.nhost.run/v1"
        return ""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
