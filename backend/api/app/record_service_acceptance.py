"""Review genuine device reports on Oracle; dry-run by default, no public route."""
import argparse
import asyncio
import hashlib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .config import get_settings
from .database import connect, close_pools
from .service_acceptance import ServiceEvidence, proof_digest


def verify_reports(evidence, reports):
    for device in evidence.devices:
        path = Path(reports[device.platform]).resolve(strict=True)
        if (not path.is_relative_to(Path('/var/backups/papzii/acceptance')) or not path.is_file()
                or path.stat().st_uid != 0 or path.stat().st_mode & 0o077):
            raise ValueError('Native reports must be private files in the Oracle acceptance archive.')
        with path.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if digest != device.report_sha256:
            raise ValueError('The retained native report does not match its reviewed digest.')


async def register(settings, evidence, evidence_id, reviewer_id, *, apply=False):
    if settings.app_env != 'production' or evidence.revision != settings.app_version:
        raise ValueError('Acceptance must identify the running production candidate.')
    endpoint = settings.livekit_url if evidence.capability == 'video_call_service' else settings.api_public_url
    if endpoint.rstrip('/') != evidence.endpoint.rstrip('/'):
        raise ValueError('Evidence belongs to another service endpoint.')
    if reviewer_id not in {value.strip() for value in settings.admin_user_ids.split(',') if value.strip()}:
        raise ValueError('A server-authorized reviewer is required.')
    now = datetime.now(UTC)
    if not all(now - timedelta(days=7) <= device.tested_at <= now for device in evidence.devices):
        raise ValueError('Native reports must be recent and cannot be future-dated.')
    conn = await connect(settings)
    try:
        async with conn.transaction():
            reviewer = await conn.fetchrow('SELECT email_verified,metadata FROM api_users WHERE id=$1 FOR SHARE', reviewer_id)
            metadata = json.loads(reviewer['metadata']) if reviewer and isinstance(reviewer['metadata'], str) else (reviewer or {}).get('metadata', {})
            if not reviewer or not reviewer['email_verified'] or not isinstance(metadata, dict) or metadata.get('deletion_status'):
                raise ValueError('The reviewer must be an active verified account.')
            if evidence.capability == 'video_call_service':
                exists = await conn.fetchval("SELECT EXISTS(SELECT 1 FROM booking_video_rooms WHERE id=$1 AND status='ended' AND connected_at IS NOT NULL AND ended_at IS NOT NULL AND source_revision=$2)", evidence.resource_id, evidence.revision)
            else:
                exists = await conn.fetchval('''SELECT EXISTS(SELECT 1 FROM dispatch_requests d
                    JOIN bookings b ON b.id=d.booking_id JOIN payments p ON p.booking_id=b.id
                    WHERE d.id=$1 AND d.status='accepted' AND d.source_revision=$3 AND b.status='completed' AND b.payment_status='paid'
                    AND b.assignment_state='accepted' AND d.assignment_profile_id IN (b.photographer_id,b.model_id)
                    AND p.status='completed' AND p.provider_mode='live' AND p.merchant_id=$2
                    AND p.amount=b.quote_amount AND p.provider_payment_id IS NOT NULL)''', evidence.resource_id, settings.payfast_merchant_id, evidence.revision)
            if not exists:
                raise ValueError('The production room/paid dispatch journey does not corroborate this report.')
            proof = evidence.model_dump(mode='json')
            digest = proof_digest(proof)
            if apply:
                # No upsert: an immutable acceptance ID can only be explicitly revoked.
                await conn.execute('''INSERT INTO service_release_acceptance
                    (id,capability,revision,endpoint,proof,proof_sha256,reviewed_by,accepted_at,expires_at)
                    VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)''',
                    evidence_id, evidence.capability, evidence.revision, evidence.endpoint.rstrip('/'),
                    json.dumps(proof), digest, reviewer_id, now, now + timedelta(days=30))
            return {'recorded': apply, 'capability': evidence.capability, 'revision': evidence.revision,
                    'proof_sha256': digest, 'configuration_activated': False}
    finally:
        await conn.close()


async def main(args):
    settings = get_settings()
    raw = Path(args.evidence).read_bytes()
    if len(raw) > 65536 or settings.app_version != args.expected_revision:
        raise ValueError('Unexpected evidence size or runtime revision.')
    evidence = ServiceEvidence.model_validate_json(raw)
    verify_reports(evidence, {'ios': args.ios_report, 'android': args.android_report})
    try:
        print(json.dumps(await register(settings, evidence, args.id, args.reviewer_id, apply=args.apply)))
    finally:
        await close_pools()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--ios-report', required=True)
    parser.add_argument('--android-report', required=True)
    parser.add_argument('--id', required=True)
    parser.add_argument('--reviewer-id', required=True)
    parser.add_argument('--expected-revision', required=True)
    parser.add_argument('--apply', action='store_true')
    try:
        asyncio.run(main(parser.parse_args()))
    except Exception as error:
        print(json.dumps({'recorded': False, 'error_type': type(error).__name__, 'configuration_activated': False}))
        raise SystemExit(1)
