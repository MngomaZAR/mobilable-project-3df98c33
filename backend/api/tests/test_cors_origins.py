import unittest

from pydantic import ValidationError

from app.config import Settings


class CorsOriginTests(unittest.TestCase):
    def test_default_is_exact_public_web_origins(self):
        with unittest.mock.patch.dict("os.environ", {}, clear=True):
            origins = Settings(_env_file=None).allowed_cors_origins
        self.assertEqual(origins, ["https://papzii.co.za", "https://www.papzii.co.za"])

    def test_explicit_local_origin_is_allowed_for_development(self):
        settings = Settings(_env_file=None, CORS_ORIGINS="http://localhost:8081, https://papzii.co.za/")
        self.assertEqual(settings.allowed_cors_origins, ["http://localhost:8081", "https://papzii.co.za"])

    def test_wildcard_credentials_path_and_remote_http_are_rejected(self):
        for origin in ("*", "https://*.example.com", "http://example.com", "https://user:pass@example.com", "https://example.com/path"):
            with self.subTest(origin=origin), self.assertRaises(ValidationError):
                Settings(_env_file=None, CORS_ORIGINS=origin)
