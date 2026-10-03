from .config import Settings
from .auth_security import recovery_configured


def release_capabilities(settings: Settings) -> dict:
    # Configuration is not evidence of gateway settlement or device acceptance.
    capabilities = {
        "road_routing_configured": bool(settings.osrm_base_url),
        "object_storage_configured": bool(settings.minio_endpoint and settings.minio_access_key and settings.minio_secret_key),
        "payment_checkout_configured": bool(settings.payfast_merchant_id and settings.payfast_merchant_key and settings.payfast_passphrase),
        "admin_access_configured": bool(settings.admin_user_ids.strip()),
        "payment_refund_execution": False,
        "bank_payout_execution": False,
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
