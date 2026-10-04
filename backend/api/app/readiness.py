from .config import Settings
from .auth_security import recovery_configured
from .financial_operations import FinancialConfig, capabilities as financial_capabilities
from .service_acceptance import capabilities as service_capabilities
from .service_acceptance import canary_user, secure_endpoint
from datetime import UTC, datetime, timedelta


def release_capabilities(settings: Settings, financial: dict | None = None, services: dict | None = None) -> dict:
    financial = financial or {}
    services = services or {}
    # Configuration is not evidence of gateway settlement or device acceptance.
    capabilities = {
        "road_routing_configured": bool(settings.osrm_base_url),
        "object_storage_configured": bool(settings.minio_endpoint and settings.minio_access_key and settings.minio_secret_key),
        "payment_checkout_configured": bool(settings.payfast_merchant_id and settings.payfast_merchant_key and settings.payfast_passphrase and settings.api_public_url.startswith("https://")),
        "payment_checkout_enabled": settings.payfast_checkout_enabled,
        "admin_access_configured": bool(settings.admin_user_ids.strip()),
        "payment_refund_execution": financial.get('refund_execution') is True,
        "bank_payout_execution": financial.get('creator_payout_execution') is True,
        "account_recovery_email": recovery_configured(settings),
        "video_call_service": services.get('video_call_service') is True,
        "instant_dispatch_service": services.get('instant_dispatch_service') is True,
    }


    return {
        "environment": settings.app_env,
        "version": settings.app_version,
        "required_capabilities_available": all(capabilities.values()),
        "capabilities": capabilities,
        "blockers": [name for name, available in capabilities.items() if not available],
        "external_evidence_required": [
            "Real gateway payment, refund and bank settlement",
            "Physical iPhone and Android acceptance tests",
            "Push and video media delivery on real devices",
            "All-screen accessibility and moderation acceptance",
        ],
    }


async def checked_release_capabilities(settings: Settings) -> dict:
    config = FinancialConfig.from_env()
    financial = {}
    services = {}
    if settings.postgres_url:
        try:
            financial = await financial_capabilities(settings, config)
        except Exception:
            # A failed acceptance read must never make a money movement available.
            financial = {}
        try:
            services = await service_capabilities(settings)
        except Exception:
            services = {}
    financial['refund_execution'] = financial.get('refund_execution') is True and not settings.payfast_sandbox
    financial['creator_payout_execution'] = financial.get('creator_payout_execution') is True and config.stitch_mode == 'live'
    return release_capabilities(settings, financial, services)


async def account_service_access(settings: Settings, user_id: str) -> dict:
    readiness = await checked_release_capabilities(settings)
    public = readiness['capabilities']
    test_access = canary_user(settings, user_id)
    video_configured = False
    try:
        secure_endpoint(settings.livekit_url, 'wss')
        video_configured = bool(settings.livekit_api_key and settings.livekit_api_secret)
    except ValueError:
        pass
    expires = datetime.now(UTC) + timedelta(seconds=60)
    if test_access:
        expires = min(expires, settings.service_acceptance_expires_at)
    return {
        'user_id': user_id, 'version': settings.app_version,
        'expires_at': expires.isoformat(), 'controlled_test': test_access,
        'permissions': {
            'checkout': bool(public['payment_checkout_configured'] and (
                test_access or (public['payment_checkout_enabled'] and public['payment_refund_execution'] and public['bank_payout_execution']))),
            'payouts': public['bank_payout_execution'],
            'video': public['video_call_service'] or (test_access and video_configured),
            'dispatch': public['instant_dispatch_service'] or (test_access and bool(settings.osrm_base_url)),
        },
        'payment_limit_zar': str(settings.payfast_acceptance_max_amount) if test_access else None,
    }
