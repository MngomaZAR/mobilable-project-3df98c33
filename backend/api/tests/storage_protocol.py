"""Real S3 compatibility checks for an explicitly isolated QA object store."""
import json
import os
import time
from pathlib import Path

import boto3
import httpx
from botocore.client import Config
from botocore.exceptions import ClientError, EndpointConnectionError

from app.config import Settings
from app.storage import storage_client


BUCKET = "qa-storage-protocol-20261003"
KEY = "restart-proof.txt"
BODY = b"PAPZII isolated S3 persistence proof\n"


def run(phase: str) -> None:
    settings = Settings()
    if settings.app_env != "qa" or "_qa_" not in settings.postgres_url.rsplit("/", 1)[-1]:
        raise RuntimeError("Refusing storage fixtures outside an explicitly named QA database")
    client = storage_client(settings)
    for attempt in range(30):
        try:
            client.list_buckets()
            break
        except (ClientError, EndpointConnectionError):
            if attempt == 29:
                raise
            time.sleep(2)
    if phase == "write":
        client.create_bucket(Bucket=BUCKET)
        client.put_object(Bucket=BUCKET, Key=KEY, Body=BODY, ContentType="text/plain")
        print("Synthetic S3 restart fixture written; no customer objects touched.")
        return
    if phase != "verify":
        raise ValueError("Expected write or verify phase")
    checks = []

    def check(name: str, passed: bool) -> None:
        checks.append({"name": name, "passed": passed})
        if not passed:
            raise AssertionError(name)

    obj = client.get_object(Bucket=BUCKET, Key=KEY)
    try:
        check("Object bytes survive container restart", obj["Body"].read() == BODY)
        check("Content type survives container restart", obj["ContentType"] == "text/plain")
    finally:
        obj["Body"].close()
    with httpx.Client(timeout=10, trust_env=False) as http:
        response = http.get(f"{settings.minio_endpoint.rstrip('/')}/{BUCKET}/{KEY}")
        check("Anonymous S3 object access denied", response.status_code == 403)
    invalid = boto3.client(
        "s3", endpoint_url=settings.minio_endpoint, region_name="us-east-1",
        aws_access_key_id=settings.minio_access_key, aws_secret_access_key="invalid-qa-credential",
        config=Config(signature_version="s3v4", retries={"max_attempts": 0}),
    )
    try:
        invalid.get_object(Bucket=BUCKET, Key=KEY)
    except ClientError as error:
        check("Incorrect S3 signature denied", error.response["ResponseMetadata"]["HTTPStatusCode"] == 403)
    else:
        check("Incorrect S3 signature denied", False)
    try:
        client.delete_bucket(Bucket=BUCKET)
    except ClientError as error:
        check("Non-empty bucket deletion denied", error.response["Error"]["Code"] == "BucketNotEmpty")
    else:
        check("Non-empty bucket deletion denied", False)
    client.delete_object(Bucket=BUCKET, Key=KEY)
    try:
        client.head_object(Bucket=BUCKET, Key=KEY)
    except ClientError as error:
        check("Explicit object deletion persists", error.response["ResponseMetadata"]["HTTPStatusCode"] == 404)
    else:
        check("Explicit object deletion persists", False)
    client.delete_bucket(Bucket=BUCKET)
    report = {"scope": "Real isolated S3 backend; synthetic objects only", "checks": checks}
    path = os.getenv("QA_STORAGE_REPORT_PATH")
    if path:
        Path(path).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    import sys
    run(sys.argv[1] if len(sys.argv) > 1 else "verify")
