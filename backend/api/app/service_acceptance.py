"""Fail-closed service activation with reviewed, revision-bound native evidence."""
import hashlib
import hmac
import json
import re
from datetime import UTC, datetime, timedelta
from typing import Literal
from urllib.parse import urlsplit

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator

from .config import Settings
from .database import connect


CASES = {
    'video_call_service': {'two_way_media', 'permissions_denied', 'reconnect', 'room_termination', 'unauthorized_access', 'push_delivery'},
    'instant_dispatch_service': {'photographer_match', 'model_match', 'concurrent_accept', 'offer_expiry', 'stale_location', 'push_delivery', 'road_navigation', 'paid_booking'},
}


class NativeDeviceEvidence(BaseModel):
    model_config = ConfigDict(extra='forbid')
    platform: Literal['ios', 'android']
    physical_device: StrictBool
    device_model: str = Field(min_length=2, max_length=120)
    os_version: str = Field(min_length=1, max_length=80)
    build_id: str = Field(min_length=8, max_length=120)
    source_revision: str = Field(pattern=r'^[0-9a-f]{40}$')
    tested_at: datetime
    report_reference: str = Field(min_length=8, max_length=500)
    report_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    cases: dict[str, StrictBool]


class ServiceEvidence(BaseModel):
    model_config = ConfigDict(extra='forbid')
    capability: Literal['video_call_service', 'instant_dispatch_service']
    revision: str = Field(pattern=r'^[0-9a-f]{40}$')
    endpoint: str = Field(min_length=8, max_length=500)
    # A completed room or paid dispatch booking corroborates human media/device reports.
    resource_id: str = Field(min_length=1, max_length=120)
    devices: list[NativeDeviceEvidence] = Field(min_length=2, max_length=2)

    @model_validator(mode='after')
    def complete_native_reports(self):
        secure_endpoint(self.endpoint, 'wss' if self.capability == 'video_call_service' else 'https')
        if {device.platform for device in self.devices} != {'ios', 'android'}:
            raise ValueError('One physical iPhone and one physical Android report are required.')
        for device in self.devices:
            if not device.physical_device or device.source_revision != self.revision:
                raise ValueError('Physical-device reports must identify this exact candidate.')
            if device.tested_at.utcoffset() is None:
                raise ValueError('Device timestamps must include their timezone.')
            if set(device.cases) != CASES[self.capability] or not all(device.cases.values()):
                raise ValueError('Every required native case must pass on both platforms.')
        return self


def secure_endpoint(value: str, scheme: str) -> str:
    url = urlsplit(value)
    if (url.scheme != scheme or not url.hostname or url.username or url.password or url.query or url.fragment
            or url.hostname in {'localhost', '127.0.0.1', '::1', '0.0.0.0'}):
        raise ValueError('A hosted secure service endpoint without credentials is required.')
    return value.rstrip('/')


def proof_digest(proof: dict) -> str:
    return hashlib.sha256(json.dumps(proof, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()).hexdigest()


def canary_active(settings: Settings, now: datetime | None = None) -> bool:
    now = now or datetime.now(UTC)
    expiry = getattr(settings, 'service_acceptance_expires_at', None)
    return bool(expiry and expiry.utcoffset() is not None and now < expiry <= now + timedelta(hours=24)
                and getattr(settings, 'service_acceptance_user_ids', '').strip())


def canary_user(settings: Settings, user_id: str) -> bool:
    allowed = {value.strip() for value in getattr(settings, 'service_acceptance_user_ids', '').split(',') if value.strip()}
    return bool(user_id and canary_active(settings) and user_id in allowed)


def configured(settings: Settings, capability: str) -> bool:
    try:
        if capability == 'video_call_service':
            secure_endpoint(settings.livekit_url, 'wss')
            return bool(settings.livekit_enabled and settings.livekit_api_key and settings.livekit_api_secret)
        secure_endpoint(settings.api_public_url, 'https')
        return bool(settings.instant_dispatch_enabled and settings.osrm_base_url)
    except ValueError:
        return False


def valid_record(settings: Settings, capability: str, row, now: datetime | None = None) -> bool:
    now = now or datetime.now(UTC)
    if not row or not configured(settings, capability) or not re.fullmatch(r'[0-9a-f]{40}', settings.app_version):
        return False
    endpoint = settings.livekit_url if capability == 'video_call_service' else settings.api_public_url
    admins = {value.strip() for value in settings.admin_user_ids.split(',') if value.strip()}
    try:
        if (row['capability'] != capability or row['revision'] != settings.app_version
                or row['endpoint'].rstrip('/') != endpoint.rstrip('/') or row['reviewed_by'] not in admins
                or row['revoked_at'] is not None or not row['accepted_at'] <= now < row['expires_at']
                or row['expires_at'] > row['accepted_at'] + timedelta(days=30)):
            return False
        proof = json.loads(row['proof']) if isinstance(row['proof'], str) else row['proof']
        if not hmac.compare_digest(proof_digest(proof), row['proof_sha256']):
            return False
        evidence = ServiceEvidence.model_validate(proof)
        return bool(evidence.capability == capability and evidence.revision == settings.app_version
                    and evidence.endpoint.rstrip('/') == endpoint.rstrip('/')
                    and all(row['accepted_at'] - timedelta(days=7) <= device.tested_at <= row['accepted_at'] for device in evidence.devices))
    except (ValueError, KeyError, TypeError):
        return False


async def capabilities(settings: Settings, *, connection=None) -> dict[str, bool]:
    result = {key: False for key in CASES}
    if not settings.postgres_url or not (settings.video_acceptance_id or settings.dispatch_acceptance_id):
        return result
    conn = connection if connection is not None else await connect(settings)
    try:
        for capability, evidence_id in (('video_call_service', settings.video_acceptance_id),
                                        ('instant_dispatch_service', settings.dispatch_acceptance_id)):
            if evidence_id and configured(settings, capability):
                row = await conn.fetchrow('''SELECT a.* FROM service_release_acceptance a
                    JOIN api_users u ON u.id=a.reviewed_by WHERE a.id=$1 AND u.email_verified
                    AND coalesce(u.metadata->>'deletion_status','')='' ''', evidence_id)
                result[capability] = valid_record(settings, capability, row)
        return result
    finally:
        if connection is None:
            await conn.close()


async def require_access(settings: Settings, capability: str, user_ids: set[str], *, connection=None) -> bool:
    """Return False for isolated canary access, True for accepted public access."""
    if settings.app_env != 'production':
        return True
    if user_ids and all(canary_user(settings, user_id) for user_id in user_ids):
        return False
    try:
        if (await capabilities(settings, connection=connection)).get(capability) is True:
            return True
    except Exception:
        pass
    raise HTTPException(503, 'This service is paused pending production acceptance. No new operation was started.')
