import unittest
from copy import deepcopy
from unittest.mock import AsyncMock, Mock, patch

from fastapi import HTTPException
from starlette.requests import Request

from app.config import Settings
from app.onboarding import decide_identity, submit_kyc


class Transaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False


class OnboardingConnection:
    def __init__(self, doc_types):
        self.profile = {"id": "creator", "age_verified": True, "verified": False, "kyc_status": "pending"}
        self.documents = [{"doc_type": doc_type, "status": "approved"} for doc_type in doc_types]

    def transaction(self):
        return Transaction()

    async def close(self):
        return None

    async def fetchrow(self, sql, *args):
        if sql.startswith("SELECT * FROM profiles"):
            return deepcopy(self.profile)
        if sql.startswith("UPDATE profiles SET kyc_status='submitted'"):
            self.profile.update(kyc_status="submitted", verified=False)
            return deepcopy(self.profile)
        if sql.startswith("UPDATE profiles SET kyc_status=$2"):
            self.profile.update(kyc_status=args[1], verified=args[2])
            return deepcopy(self.profile)
        raise AssertionError(f"Unexpected query: {sql}")

    async def fetch(self, sql, *_args):
        if "FROM kyc_documents" in sql:
            return deepcopy(self.documents)
        raise AssertionError(f"Unexpected query: {sql}")

    async def execute(self, *_args):
        if _args and _args[0].startswith("UPDATE profiles SET kyc_status='submitted'"):
            self.profile.update(kyc_status="submitted", verified=False)
        return "UPDATE 1"


def settings():
    return Settings(_env_file=None)


def request():
    return Request({"type": "http", "method": "POST", "path": "/kyc/submit", "headers": []})


class KycEvidenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_submission_requires_proof_of_address(self):
        conn = OnboardingConnection(["passport", "selfie"])
        with patch("app.onboarding.require_user", new=AsyncMock(return_value={"id": "creator"})), \
                patch("app.onboarding.connect", new=AsyncMock(return_value=conn)):
            with self.assertRaises(HTTPException) as error:
                await submit_kyc(request(), settings())
        self.assertEqual(error.exception.status_code, 409)
        self.assertIn("proof-of-address", error.exception.detail)
        self.assertEqual(conn.profile["kyc_status"], "pending")

    async def test_submission_accepts_complete_document_set(self):
        conn = OnboardingConnection(["passport", "selfie", "proof_of_address"])
        with patch("app.onboarding.require_user", new=AsyncMock(return_value={"id": "creator"})), \
                patch("app.onboarding.connect", new=AsyncMock(return_value=conn)):
            result = await submit_kyc(request(), settings())
        self.assertTrue(result["submitted"])
        self.assertEqual(conn.profile["kyc_status"], "submitted")

    async def test_creator_cannot_be_approved_without_approved_proof_of_address(self):
        conn = OnboardingConnection(["passport", "selfie"])
        with patch("app.onboarding.connect", new=AsyncMock(return_value=conn)):
            with self.assertRaises(HTTPException) as error:
                await decide_identity(settings(), "creator", "approved")
        self.assertEqual(error.exception.status_code, 409)
        self.assertFalse(conn.profile["verified"])

    async def test_creator_can_be_approved_after_all_evidence_is_reviewed(self):
        conn = OnboardingConnection(["passport", "selfie", "proof_of_address"])
        with patch("app.onboarding.connect", new=AsyncMock(return_value=conn)):
            result = await decide_identity(settings(), "creator", "approved")
        self.assertTrue(result["profile"]["verified"])
        self.assertEqual(result["profile"]["kyc_status"], "approved")


if __name__ == "__main__":
    unittest.main()
