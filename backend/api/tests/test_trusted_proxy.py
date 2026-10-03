import unittest

import httpx
from pydantic import ValidationError
from starlette.responses import JSONResponse
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.config import Settings


class TrustedProxyConfigurationTests(unittest.TestCase):
    def test_explicit_ip_list_is_normalized(self):
        settings = Settings(FORWARDED_ALLOW_IPS="10.0.1.7, ::1", _env_file=None)
        self.assertEqual(settings.forwarded_allow_ips, "10.0.1.7,::1")

    def test_bounded_network_is_supported(self):
        settings = Settings(FORWARDED_ALLOW_IPS="10.0.1.0/24", _env_file=None)
        self.assertEqual(settings.forwarded_allow_ips, "10.0.1.0/24")

    def test_empty_list_disables_forwarding_trust(self):
        self.assertEqual(Settings(FORWARDED_ALLOW_IPS="", _env_file=None).forwarded_allow_ips, "")

    def test_wildcard_world_network_and_bad_entries_are_rejected(self):
        for value in ("*", "0.0.0.0/0", "::/0", "10.0.1.7,*", "10.0.1.7,", "proxy.example.com"):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                Settings(FORWARDED_ALLOW_IPS=value, _env_file=None)


async def echo_client(scope, receive, send):
    await JSONResponse({"client": scope["client"][0], "scheme": scope["scheme"]})(scope, receive, send)


class TrustedProxyMiddlewareTests(unittest.IsolatedAsyncioTestCase):
    async def request(self, peer, forwarded, proxies="10.0.1.7,10.0.1.8"):
        settings = Settings(FORWARDED_ALLOW_IPS=proxies, _env_file=None)
        app = ProxyHeadersMiddleware(echo_client, trusted_hosts=settings.forwarded_allow_ips)
        transport = httpx.ASGITransport(app=app, client=(peer, 12345))
        async with httpx.AsyncClient(transport=transport, base_url="http://api.test") as client:
            response = await client.get("/", headers={"X-Forwarded-For": forwarded, "X-Forwarded-Proto": "https"})
        return response.json()

    async def test_external_client_cannot_forge_forwarding_headers(self):
        self.assertEqual(await self.request("198.51.100.20", "203.0.113.99"),
                         {"client": "198.51.100.20", "scheme": "http"})

    async def test_trusted_proxy_preserves_actual_client_and_tls_scheme(self):
        self.assertEqual(await self.request("10.0.1.7", "198.51.100.20"),
                         {"client": "198.51.100.20", "scheme": "https"})

    async def test_trusted_chain_resolves_rightmost_untrusted_address(self):
        result = await self.request("10.0.1.7", "203.0.113.99,198.51.100.20,10.0.1.8")
        self.assertEqual(result["client"], "198.51.100.20")

    async def test_untrusted_container_cannot_impersonate_another_caller(self):
        self.assertEqual((await self.request("10.0.1.9", "198.51.100.20"))["client"], "10.0.1.9")


if __name__ == "__main__":
    unittest.main()
