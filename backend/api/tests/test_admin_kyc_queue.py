import unittest
from unittest.mock import AsyncMock, patch

from app.builtin_functions import handle_admin_review
from app.config import Settings


class AdminKycQueueTests(unittest.IsolatedAsyncioTestCase):
    async def test_review_queue_only_signs_matching_creator_documents(self):
        settings = Settings(_env_file=None, DATABASE_URL="postgresql://unused", API_PUBLIC_URL="https://api.example.org")
        documents = [
            {"id": "doc-1", "user_id": "creator-1", "storage_path": "kyc-documents::users/creator-1/id.jpg"},
            {"id": "doc-2", "user_id": "creator-1", "storage_path": "kyc-documents::users/other/id.jpg"},
        ]

        async def select_rows(_settings, table, *_args, **_kwargs):
            if table == "profiles":
                return [{"id": "creator-1", "full_name": "Creator One", "role": "photographer"}]
            if table == "kyc_documents":
                return documents
            return []

        with patch("app.builtin_functions.select_rows", new=AsyncMock(side_effect=select_rows)), patch(
            "app.storage.signed_url", return_value={"url": "https://api.example.org/private-preview"}
        ) as sign:
            queue = await handle_admin_review(settings, {"action": "list_pending"}, {"id": "admin"})

        self.assertEqual(sign.call_count, 1)
        self.assertEqual(sign.call_args.args[1:], ("kyc-documents", "users/creator-1/id.jpg"))
        self.assertEqual(sign.call_args.kwargs, {"expires_in": 300})
        self.assertEqual(queue["kyc_documents"][0]["user_name"], "Creator One")
        self.assertEqual(queue["kyc_documents"][0]["signed_url"], "https://api.example.org/private-preview")
        self.assertIsNone(queue["kyc_documents"][1]["signed_url"])
