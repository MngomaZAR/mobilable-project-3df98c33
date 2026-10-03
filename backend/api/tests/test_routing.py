import unittest
from unittest.mock import patch

import httpx
from fastapi import HTTPException

from app.config import Settings
from app.routing import road_route


class RoutingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.settings = Settings(_env_file=None, OSRM_BASE_URL='http://router.invalid')
        self.body = {'code': 'Ok', 'waypoints': [{'distance': 20}, {'distance': 30}],
                     'routes': [{'geometry': {'coordinates': [[31.03, -29.85], [31.035, -29.86], [31.04, -29.87]]},
                                 'distance': 3730, 'duration': 450.7, 'legs': []}]}

    async def run_route(self):
        transport = httpx.MockTransport(lambda request: httpx.Response(200, json=self.body))
        client = httpx.AsyncClient(transport=transport)
        with patch('app.routing.httpx.AsyncClient', return_value=client):
            return await road_route(self.settings, -29.85, 31.03, -29.87, 31.04)

    async def test_real_geometry_and_estimates_remain_unchanged(self):
        self.assertEqual((await self.run_route())['distance'], 3.73)

    async def test_missing_and_outside_coordinates_are_not_sent_to_router(self):
        with patch('app.routing.httpx.AsyncClient') as client:
            with self.assertRaises(HTTPException) as result:
                await road_route(self.settings, -29.85, 31.03, 0, 0)
            self.assertEqual(result.exception.status_code, 422)
            client.assert_not_called()

    async def test_far_snapping_is_not_presented_as_navigation_to_selected_pin(self):
        self.body['waypoints'][1]['distance'] = 150000
        with self.assertRaises(HTTPException) as result:
            await self.run_route()
        self.assertEqual(result.exception.status_code, 404)

    async def test_invalid_geometry_fails_without_invented_fallback(self):
        self.body['routes'][0]['geometry']['coordinates'][1] = [0, 0]
        with self.assertRaises(HTTPException) as result:
            await self.run_route()
        self.assertEqual(result.exception.status_code, 503)

    async def test_malformed_estimates_fail_without_server_crash(self):
        self.body['routes'][0]['distance'] = None
        with self.assertRaises(HTTPException) as result:
            await self.run_route()
        self.assertEqual(result.exception.status_code, 503)
