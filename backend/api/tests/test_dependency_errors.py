import json
import unittest

import asyncpg
from starlette.requests import Request

from app.main import handle_database_error


def request_with_id(value: str = "qa-signup-123") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/auth/sign-up",
            "headers": [(b"x-request-id", value.encode())],
            "query_string": b"",
            "server": ("qa.invalid", 443),
            "scheme": "https",
            "client": ("127.0.0.1", 1234),
        }
    )


class DependencyErrorTests(unittest.IsolatedAsyncioTestCase):
    async def test_database_failure_is_a_retryable_sanitized_response(self):
        request = request_with_id()
        request.state.request_id = "qa-signup-123"

        response = await handle_database_error(request, asyncpg.PostgresError("password=must-not-leak"))

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["x-request-id"], "qa-signup-123")
        self.assertEqual(response.headers["retry-after"], "5")
        payload = json.loads(response.body)
        self.assertEqual(payload["detail"], "Service temporarily unavailable. Please try again.")
        self.assertNotIn("password", json.dumps(payload))

    async def test_invalid_request_id_is_replaced(self):
        request = request_with_id("bad id")
        request.state.request_id = "generated-id"

        response = await handle_database_error(request, asyncpg.PostgresError("database unavailable"))

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["x-request-id"], "generated-id")

