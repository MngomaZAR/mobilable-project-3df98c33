from .config import Settings
from .auth_security import recovery_configured
from .financial_operations import FinancialConfig, capabilities as financial_capabilities


def release_capabilities(settings: Settings, financial: dict | None = None) -> dict:
    financial = financial or {}
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
        "video_call_service": False,
        "instant_dispatch_service": False,
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
    if settings.postgres_url:
        try:
            financial = await financial_capabilities(settings, config)
        except Exception:
            # A failed acceptance read must never make a money movement available.
            financial = {}
    financial['refund_execution'] = financial.get('refund_execution') is True and not settings.payfast_sandbox
    financial['creator_payout_execution'] = financial.get('creator_payout_execution') is True and config.stitch_mode == 'live'
    return release_capabilities(settings, financial)
