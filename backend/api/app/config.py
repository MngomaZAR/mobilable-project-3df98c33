from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "PAPZII API"
    app_env: str = Field(default="development", alias="APP_ENV")
    app_version: str = Field(default="0.1.0", alias="APP_VERSION")
    api_public_url: str = Field(default="", alias="API_PUBLIC_URL")

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
    payfast_base_url: str = Field(default="", alias="PAYFAST_BASE_URL")
    payfast_merchant_id: str = Field(default="", alias="PAYFAST_MERCHANT_ID")
    payfast_merchant_key: str = Field(default="", alias="PAYFAST_MERCHANT_KEY")
    payfast_passphrase: str = Field(default="", alias="PAYFAST_PASSPHRASE")

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
