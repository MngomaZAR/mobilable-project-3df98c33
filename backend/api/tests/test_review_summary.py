import os
import unittest
import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from urllib.parse import urlsplit

import asyncpg
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.reviews import published_review_summary, router


def settings():
    return Settings(_env_file=None, DATABASE_URL="postgresql://unused")


class ReviewSummaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_full_summary_is_numeric_and_does_not_return_private_rows(self):
        conn = SimpleNamespace(fetchrow=AsyncMock(side_effect=[{"id": "creator"}, {"count": 256, "average": Decimal("4.7")}]), close=AsyncMock())
        with patch("app.reviews.connect", new=AsyncMock(return_value=conn)):
            self.assertEqual(await published_review_summary(settings(), "creator"), {"count": 256, "average": 4.7})
        conn.close.assert_awaited_once()

    async def test_no_reviews_is_not_a_five_star_rating(self):
        conn = SimpleNamespace(fetchrow=AsyncMock(side_effect=[{"id": "creator"}, {"count": 0, "average": None}]), close=AsyncMock())
        with patch("app.reviews.connect", new=AsyncMock(return_value=conn)):
            self.assertEqual(await published_review_summary(settings(), "creator"), {"count": 0, "average": None})

    async def test_missing_creator_is_404_and_connection_closes(self):
        conn = SimpleNamespace(fetchrow=AsyncMock(return_value=None), close=AsyncMock())
        with patch("app.reviews.connect", new=AsyncMock(return_value=conn)), self.assertRaises(HTTPException) as error:
            await published_review_summary(settings(), "missing")
        self.assertEqual(error.exception.status_code, 404)
        conn.close.assert_awaited_once()

    async def test_database_failure_is_not_empty_reputation(self):
        conn = SimpleNamespace(fetchrow=AsyncMock(side_effect=RuntimeError("database unavailable")), close=AsyncMock())
        with patch("app.reviews.connect", new=AsyncMock(return_value=conn)), self.assertRaises(RuntimeError):
            await published_review_summary(settings(), "creator")
        conn.close.assert_awaited_once()


class ReviewSummaryRouteTests(unittest.TestCase):
    def test_published_summary_is_public_and_has_only_aggregate_fields(self):
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_settings] = settings
        with TestClient(app) as client, patch("app.reviews.published_review_summary", new=AsyncMock(return_value={"count": 0, "average": None})):
            response = client.get("/reviews/summary/creator")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"count": 0, "average": None})


@unittest.skipUnless(os.getenv("DATABASE_URL"), "Requires isolated QA PostgreSQL; CI supplies it")
class ReviewSummaryPostgresTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_postgres_filters_and_aggregates_more_than_one_page(self):
        url = os.environ["DATABASE_URL"]
        if "_qa_" not in urlsplit(url).path:
            raise RuntimeError("Refusing review fixtures outside an explicitly named QA database")
        conn = await asyncpg.connect(url)
        transaction = conn.transaction()
        await transaction.start()
        prefix = "review-summary-" + uuid.uuid4().hex
        creator, model, client, other = [prefix + suffix for suffix in ("-photo", "-model", "-client", "-other")]
        try:
            for actor, role in [(creator, "photographer"), (model, "model"), (client, "client"), (other, "client")]:
                await conn.execute("INSERT INTO profiles(id,role) VALUES($1,$2)", actor, role)

            async def review(index, target=creator, rating=4, moderation="approved", payment="paid", status="completed", reviewer=None, reviewee=None):
                booking_id = prefix + "-booking-" + str(index)
                await conn.execute(
                    "INSERT INTO bookings(id,client_id,photographer_id,model_id,status,payment_status) VALUES($1,$2,$3,$4,$5,$6)",
                    booking_id, client, target if target == creator else None, target if target == model else None, status, payment,
                )
                await conn.execute(
                    "INSERT INTO reviews(id,booking_id,client_id,photographer_id,reviewer_id,reviewee_id,rating,moderation_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
                    prefix + "-review-" + str(index), booking_id, client, target, reviewer, reviewee, rating, moderation,
                )

            for index in range(60):
                await review(index, rating=4 if index < 30 else 5)
            await review(60, moderation="pending")
            await review(61, moderation="rejected")
            await review(62, payment="unpaid")
            await review(63, status="accepted")
            await review(64, reviewer=other)
            await review(65, reviewee=model)
            await review(66, target=model, rating=3)
            # Keep the fixture transaction open while exercising the actual production SQL.
            proxy = SimpleNamespace(fetchrow=conn.fetchrow, close=AsyncMock())
            with patch("app.reviews.connect", new=AsyncMock(return_value=proxy)):
                self.assertEqual(await published_review_summary(settings(), creator), {"count": 60, "average": 4.5})
                self.assertEqual(await published_review_summary(settings(), model), {"count": 1, "average": 3.0})
                await conn.execute("UPDATE profiles SET deletion_status='completed' WHERE id=$1", model)
                with self.assertRaises(HTTPException) as error:
                    await published_review_summary(settings(), model)
                self.assertEqual(error.exception.status_code, 404)
        finally:
            await transaction.rollback()
            await conn.close()


if __name__ == "__main__":
    unittest.main()
