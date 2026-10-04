"""Read-only verification of a public API revision, schema and capabilities.

A healthy old API is not a completed rollout. This does not verify worker image
identity, native devices, merchant settlement or store approval.
"""
import argparse
import ipaddress
import json
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


REQUIRED_CAPABILITIES = {
    "road_routing_configured", "object_storage_configured",
    "payment_checkout_configured", "payment_checkout_enabled",
    "admin_access_configured", "payment_refund_execution",
    "bank_payout_execution", "account_recovery_email",
    "video_call_service", "instant_dispatch_service",
}
MAX_RESPONSE_BYTES = 512 * 1024


class VerificationFailure(Exception):
    def __init__(self, stage, reason, *, retryable=True, blockers=None):
        super().__init__(reason)
        self.stage, self.retryable = stage, retryable
        self.blockers = blockers or []


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def public_url(value):
    parsed = urlsplit(value)
    host = parsed.hostname or ""
    if (parsed.scheme != "https" or not host or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.port not in (None, 443)):
        raise ValueError("Use a public HTTPS URL without credentials, query or fragment.")
    if host.lower() == "localhost" or host.lower().endswith((".localhost", ".local")):
        raise ValueError("Loopback or local hosts are not production endpoints.")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if not address.is_global:
            raise ValueError("Use a public, non-private endpoint.")
    return parsed


def release_endpoints(health_url, contract_url=None):
    health = public_url(health_url)
    path = health.path.rstrip("/")
    if not path.endswith("/health"):
        raise ValueError("The health endpoint must end with /health.")
    base = path[:-len("/health")]
    endpoints = {name: urlunsplit(health._replace(path=base + suffix)) for name, suffix in (
        ("health", "/health"), ("version", "/version"),
        ("contract", "/health/contract"), ("readiness", "/health/readiness"),
    )}
    if contract_url:
        contract = public_url(contract_url)
        if (contract.hostname, contract.port or 443) != (health.hostname, health.port or 443):
            raise ValueError("The schema contract must come from the same API origin.")
        endpoints["contract"] = contract_url
    return endpoints


def validate_revision(revision):
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Select the full 40-character source commit, not a tag or short SHA.")


def get_json(url):
    request = Request(url, headers={"Accept": "application/json", "Cache-Control": "no-cache"})
    try:
        with build_opener(NoRedirects()).open(request, timeout=8) as response:
            if response.status != 200 or response.headers.get_content_type() != "application/json":
                raise ValueError("Expected HTTP 200 JSON.")
            body = response.read(MAX_RESPONSE_BYTES + 1)
            if len(body) > MAX_RESPONSE_BYTES:
                raise ValueError("Response exceeds the verification size limit.")
            document = json.loads(body)
            if not isinstance(document, dict):
                raise ValueError("Expected a JSON object.")
            return document
    except HTTPError as error:
        raise ValueError(f"HTTP {error.code}") from None
    except (URLError, TimeoutError, OSError, UnicodeError, json.JSONDecodeError):
        raise ValueError("Endpoint unavailable or invalid JSON.") from None


def verify_once(endpoints, revision):
    def read(stage):
        try:
            return get_json(endpoints[stage])
        except ValueError as error:
            raise VerificationFailure(stage, str(error)) from None

    health = read("health")
    if health.get("status") != "ok" or health.get("environment") != "production":
        raise VerificationFailure("health", "The production API is not healthy.")
    version = read("version")
    if version.get("version") != revision or version.get("environment") != "production":
        raise VerificationFailure("version", "The serving API does not match the intended production commit.")
    if read("contract").get("ok") is not True:
        raise VerificationFailure("contract", "The live schema contract has not passed.")
    readiness = read("readiness")
    if readiness.get("version") != revision or readiness.get("environment") != "production":
        raise VerificationFailure("readiness", "The readiness response does not match the intended production commit.")
    capabilities = readiness.get("capabilities")
    if not isinstance(capabilities, dict):
        raise VerificationFailure("readiness", "The readiness capability contract is missing.", retryable=False)
    blockers = sorted(name for name in REQUIRED_CAPABILITIES if capabilities.get(name) is not True)
    if (readiness.get("required_capabilities_available") is not True or blockers
            or not capabilities or any(value is not True for value in capabilities.values())
            or readiness.get("blockers") != []):
        raise VerificationFailure("readiness", "The exact API revision is not public-release ready.",
                                  retryable=False, blockers=blockers)
    return {"api_verified": True, "revision": revision,
            "scope": "Production API revision, schema and published capabilities only",
            "acceptance_still_required": ["Worker image identity", "Native device tests",
                                          "Independent merchant settlement", "Public store approval"]}


def verify_release(endpoints, revision, *, attempts=18, interval=10):
    if not 1 <= attempts <= 18 or not 0 <= interval <= 10:
        raise ValueError("Verification is bounded to 18 attempts and ten-second intervals.")
    validate_revision(revision)
    for attempt in range(attempts):
        try:
            return verify_once(endpoints, revision)
        except VerificationFailure as error:
            if not error.retryable or attempt == attempts - 1:
                raise
            time.sleep(interval)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--health-url", required=True)
    parser.add_argument("--contract-url")
    parser.add_argument("--revision", required=True)
    parser.add_argument("--attempts", type=int, default=18)
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    try:
        validate_revision(args.revision)
        endpoints = release_endpoints(args.health_url, args.contract_url)
        if args.validate_only:
            print(json.dumps({"configuration_valid": True, "revision": args.revision,
                              "deployed": False}))
            return 0
        result = verify_release(endpoints, args.revision, attempts=args.attempts)
    except VerificationFailure as error:
        print(json.dumps({"api_verified": False, "stage": error.stage,
                          "reason": str(error), "blockers": error.blockers}))
        return 1
    except ValueError as error:
        print(json.dumps({"configuration_valid": False, "reason": str(error)}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
