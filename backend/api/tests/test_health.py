import unittest

from app.config import Settings
from app.main import health


class HealthRevisionTests(unittest.IsolatedAsyncioTestCase):
    async def test_health_exposes_the_deployed_revision(self):
        revision = "a" * 40
        response = await health(Settings(_env_file=None, APP_ENV="qa", APP_VERSION=revision))
        self.assertEqual(response.status, "ok")
        self.assertEqual(response.environment, "qa")
        self.assertEqual(response.commit_sha, revision)
