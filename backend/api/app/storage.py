import base64
from typing import Any

import boto3
from botocore.client import Config
from fastapi import HTTPException, status

from .config import Settings


def storage_client(settings: Settings):
    if not settings.minio_endpoint or not settings.minio_access_key or not settings.minio_secret_key:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Object storage is not configured.")
    return boto3.client(
        "s3",
        endpoint_url=settings.minio_endpoint,
        aws_access_key_id=settings.minio_access_key,
        aws_secret_access_key=settings.minio_secret_key,
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",
    )


def normalize_bucket(settings: Settings, bucket: str | None) -> str:
    return bucket or settings.minio_bucket_media


def storage_ref(bucket: str, path: str) -> str:
    return f"{bucket}::{path}"


def put_object(settings: Settings, body: dict[str, Any]) -> dict[str, Any]:
    bucket = normalize_bucket(settings, body.get("bucket"))
    path = str(body.get("path") or "").strip()
    encoded = str(body.get("base64") or "")
    content_type = str(body.get("contentType") or "application/octet-stream")
    if not path or not encoded:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="bucket, path, and base64 are required.")
    payload = base64.b64decode(encoded)
    client = storage_client(settings)
    try:
        client.head_bucket(Bucket=bucket)
    except Exception:
        client.create_bucket(Bucket=bucket)
    client.put_object(Bucket=bucket, Key=path, Body=payload, ContentType=content_type)
    return {
        "bucket": bucket,
        "path": path,
        "storageRef": storage_ref(bucket, path),
        "url": signed_url(settings, bucket, path)["url"],
    }


def signed_url(settings: Settings, bucket: str, path: str, expires_in: int = 60 * 60 * 24 * 7) -> dict[str, str]:
    if not bucket or not path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="bucket and path are required.")
    client = storage_client(settings)
    url = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": path},
        ExpiresIn=expires_in,
    )
    return {"url": url}
