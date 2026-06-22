from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "PAPZII API"
    app_env: str = Field(default="development", alias="APP_ENV")
    app_version: str = Field(default="0.1.0", alias="APP_VERSION")
    api_public_url: str = Field(default="", alias="API_PUBLIC_URL")

    neon_database_url: str = Field(default="", alias="NEON_DATABASE_URL")

    keycloak_url: str = Field(default="", alias="KEYCLOAK_URL")
    keycloak_realm: str = Field(default="", alias="KEYCLOAK_REALM")
    keycloak_audience: str = Field(default="papzi-mobile", alias="KEYCLOAK_AUDIENCE")

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

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
