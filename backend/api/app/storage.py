import base64
import binascii
import hashlib
import hmac
import time
import uuid
from typing import Any
from urllib.parse import urlencode, urlsplit

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from fastapi import HTTPException, status

from .config import Settings


ALLOWED_BUCKETS = {"avatars", "post-images", "chat-media", "media", "kyc-documents", "papzi-media"}
PUBLIC_BUCKETS = {"avatars", "post-images"}
CONTENT_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "video/mp4": ".mp4", "application/pdf": ".pdf"}


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


def put_object(settings: Settings, body: dict[str, Any], user_id: str) -> dict[str, Any]:
    bucket = normalize_bucket(settings, body.get("bucket"))
    if bucket not in ALLOWED_BUCKETS:
        raise HTTPException(status_code=400, detail="Unsupported upload bucket.")
    encoded = str(body.get("base64") or "")
    content_type = str(body.get("contentType") or "application/octet-stream")
    if content_type not in CONTENT_TYPES or (content_type == "application/pdf" and bucket != "kyc-documents"):
        raise HTTPException(status_code=400, detail="Unsupported upload type or bucket.")
    if not encoded or len(encoded) > 14 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Upload must be under 10 MB.")
    try:
        payload = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status_code=400, detail="Invalid upload encoding.") from error
    matches = {
        "image/jpeg": payload.startswith(b"\xff\xd8\xff"), "image/png": payload.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": payload.startswith(b"RIFF") and payload[8:12] == b"WEBP",
        "video/mp4": payload[4:8] == b"ftyp", "application/pdf": payload.startswith(b"%PDF-"),
    }
    if not payload or len(payload) > 10 * 1024 * 1024 or not matches[content_type]:
        raise HTTPException(status_code=400, detail="Media is too large or does not match its file type.")
    path = f"users/{user_id}/{uuid.uuid4()}{CONTENT_TYPES[content_type]}"
    client = storage_client(settings)
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") not in {"404", "NoSuchBucket", "NotFound"}:
            raise HTTPException(status_code=503, detail="Media storage is unavailable.") from error
        try:
            client.create_bucket(Bucket=bucket)
        except ClientError as create_error:
            if create_error.response.get("Error", {}).get("Code") != "BucketAlreadyOwnedByYou":
                raise HTTPException(status_code=503, detail="Media storage is unavailable.") from create_error
    client.put_object(Bucket=bucket, Key=path, Body=payload, ContentType=content_type)
    return {
        "bucket": bucket,
        "path": path,
        "storageRef": storage_ref(bucket, path),
        "url": signed_url(settings, bucket, path)["url"],
    }


def validate_path(bucket: str, path: str) -> None:
    if bucket not in ALLOWED_BUCKETS or not path or len(path) > 512 or any(part in {"", ".", ".."} for part in path.split("/")) or "\\" in path:
        raise HTTPException(status_code=400, detail="Invalid media location.")


def media_signature(settings: Settings, bucket: str, path: str, expiry: int) -> str:
    if not settings.minio_secret_key:
        raise HTTPException(status_code=503, detail="Media signing is not configured.")
    return hmac.new(settings.minio_secret_key.encode(), f"papzi-media:{bucket}:{path}:{expiry}".encode(), hashlib.sha256).hexdigest()


def signed_url(settings: Settings, bucket: str, path: str, expires_in: int = 3600) -> dict[str, str]:
    validate_path(bucket, path)
    gateway = urlsplit(settings.api_public_url)
    private_qa_tunnel = settings.app_env == 'qa' and gateway.scheme == 'http' and gateway.hostname in {'127.0.0.1', 'localhost', '::1'}
    if gateway.scheme != 'https' and not private_qa_tunnel:
        raise HTTPException(status_code=503, detail="Public HTTPS media gateway is not configured.")
    if bucket == 'avatars':
        return {'url': f"{settings.api_public_url.rstrip('/')}/storage/avatar?{urlencode({'path': path})}"}
    expiry = int(time.time()) + min(max(expires_in, 60), 3600)
    params = {"bucket": bucket, "path": path, "expiry": expiry, "signature": media_signature(settings, bucket, path, expiry)}
    return {"url": f"{settings.api_public_url.rstrip('/')}/storage/object?{urlencode(params)}"}


def read_object(settings: Settings, bucket: str, path: str, expiry: int, supplied: str):
    validate_path(bucket, path)
    if expiry < time.time() or expiry > time.time() + 3600 or not hmac.compare_digest(supplied, media_signature(settings, bucket, path, expiry)):
        raise HTTPException(status_code=403, detail="Media link is invalid or expired.")
    try:
        return storage_client(settings).get_object(Bucket=bucket, Key=path)
    except ClientError as error:
        raise HTTPException(status_code=404, detail="Media not found.") from error


def read_public_avatar(settings: Settings, path: str):
    validate_path('avatars', path)
    try:
        return storage_client(settings).get_object(Bucket='avatars', Key=path)
    except ClientError as error:
        raise HTTPException(status_code=404, detail='Avatar not found.') from error
