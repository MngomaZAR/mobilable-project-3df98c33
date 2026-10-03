import os
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import AsyncMock, patch
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from app.admin_moderation import ContentDecision, handle_content_review, list_pending_content, review_content, router
from app.config import Settings, get_settings


def settings():
    return Settings(_env_file=None, DATABASE_URL="postgresql://unused", ADMIN_USER_IDS="admin")


def command(table="posts", decision="approved", **extra):
    return ContentDecision(table=table, id="item", decision=decision, reason="Reviewed against policy", **extra)


class Transaction:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        self.before = deepcopy((self.conn.tables, self.conn.audit))

    async def __aexit__(self, error, value, trace):
        if error:
            self.conn.tables, self.conn.audit = self.before


class MemoryConnection:
    def __init__(self):
        self.tables = {
            "posts": {"item": {"id": "item", "author_id": "creator", "is_locked": False, "moderation_status": "pending", "caption": "Pending caption", "media_url": "post-images::users/creator/test.jpg", "image_url": None, "media_type": "image", "created_at": "2026-10-03T10:00:00Z"},
                      "parent": {"id": "parent", "author_id": "creator", "is_locked": False, "moderation_status": "approved"}},
            "stories": {"item": {"id": "item", "author_id": "creator", "moderation_status": "pending", "active": True, "created_at": "2026-10-03T10:00:00Z"}},
            "post_comments": {"item": {"id": "item", "post_id": "parent", "moderation_status": "pending", "created_at": "2026-10-03T10:00:00Z"}},
            "reviews": {"item": {"id": "item", "booking_id": "parent", "client_id": "client", "reviewer_id": "client", "reviewee_id": "creator", "photographer_id": "creator", "moderation_status": "pending", "status": "pending", "created_at": "2026-10-03T10:00:00Z"}},
            "bookings": {"parent": {"id": "parent", "client_id": "client", "photographer_id": "creator", "model_id": None, "status": "completed", "payment_status": "paid"}},
        }
        self.audit = []
        self.calls = []
        self.fail_audit = False
        self.closed = False

    def transaction(self, **options):
        return Transaction(self)

    async def close(self):
        self.closed = True

    async def fetchrow(self, sql, *args):
        self.calls.append(sql)
        table = sql.split(" FROM ")[1].split()[0]
        return deepcopy(self.tables[table].get(args[0]))

    async def fetch(self, sql, *args):
        table = sql.split(" FROM ")[1].split()[0]
        rows = self.tables[table].values()
        if args:
            rows = [row for row in rows if row.get("post_id") == args[0] and row["moderation_status"] != "rejected"]
        else:
            rows = [row for row in rows if row["moderation_status"] in {None, "pending"}]
        return deepcopy(list(rows))

    async def fetchval(self, sql, *args):
        if "count(*)" in sql:
            return len(await self.fetch(sql))
        return self.tables["stories"][args[0]]["active"]

    async def execute(self, sql, *args):
        self.calls.append(sql)
        if sql.startswith("INSERT INTO content_moderation_events"):
            if self.fail_audit:
                raise RuntimeError("Injected audit failure")
            self.audit.append(args)
            return "INSERT 0 1"
        table = sql.split()[1]
        row = self.tables[table].get(args[0])
        if not row:
            return "UPDATE 0"
        if "SET status=" in sql:
            row["status"] = args[1]
        else:
            row["moderation_status"] = args[1] if len(args) > 1 else "rejected"
        return "UPDATE 1"


class ModerationTests(unittest.IsolatedAsyncioTestCase):
    async def run_command(self, conn, value=None, actor=None):
        with patch("app.admin_moderation.connect", new=AsyncMock(return_value=conn)):
            return await review_content(settings(), actor or {"id": "admin"}, value or command())

    async def test_approvals_and_rejections_use_actual_tables_and_audit_actor_reason(self):
        for table in ["posts", "stories", "post_comments", "reviews"]:
            for decision in ["approved", "rejected"]:
                with self.subTest(table=table, decision=decision):
                    conn = MemoryConnection()
                    result = await self.run_command(conn, command(table, decision))
                    self.assertEqual(conn.tables[table]["item"]["moderation_status"], decision)
                    self.assertEqual(conn.audit[0][1:4], ("admin", table, "item"))
                    self.assertEqual(conn.audit[0][5:7], (decision, "Reviewed against policy"))
                    self.assertEqual(result["audit_event_id"], conn.audit[0][0])
                    self.assertTrue(conn.closed)
                    if table == "reviews":
                        self.assertEqual(conn.tables[table]["item"]["status"], decision)

    async def test_user_metadata_and_profile_role_cannot_grant_admin_access(self):
        conn = MemoryConnection()
        for actor in [None, {"id": "client", "role": "admin", "user_metadata": {"role": "admin"}}]:
            with patch("app.admin_moderation.connect", new=AsyncMock()) as connect, self.assertRaises(HTTPException) as error:
                await list_pending_content(settings(), actor)
            self.assertEqual(error.exception.status_code, 401 if actor is None else 403)
            connect.assert_not_called()
        with self.assertRaises(HTTPException):
            await self.run_command(conn, actor={"id": "client", "role": "admin"})
        self.assertEqual(conn.audit, [])

    async def test_pending_queue_keeps_tables_separate_and_excludes_decided_content(self):
        conn = MemoryConnection()
        conn.tables["stories"]["item"]["moderation_status"] = None
        with patch("app.admin_moderation.connect", new=AsyncMock(return_value=conn)):
            result = await list_pending_content(settings(), {"id": "admin"})
        self.assertEqual(result["counts"], dict.fromkeys(["posts", "stories", "post_comments", "reviews"], 1))
        self.assertEqual([row["id"] for row in result["content"]["posts"]], ["item"])

    async def test_comments_require_approved_public_parent_and_parent_lock_first(self):
        for missing, status, locked in [(True, "approved", False), (False, "pending", False), (False, "rejected", False), (False, "approved", True)]:
            conn = MemoryConnection()
            if missing:
                del conn.tables["posts"]["parent"]
            else:
                conn.tables["posts"]["parent"].update(moderation_status=status, is_locked=locked)
            with self.assertRaises(HTTPException) as error:
                await self.run_command(conn, command("post_comments"))
            self.assertEqual(error.exception.status_code, 409)
            self.assertEqual(conn.audit, [])
        conn = MemoryConnection()
        await self.run_command(conn, command("post_comments"))
        locks = [sql for sql in conn.calls if "FOR UPDATE" in sql]
        self.assertIn("FROM posts", locks[0])
        self.assertIn("FROM post_comments", locks[1])

    async def test_reviews_require_completed_paid_matching_parent(self):
        for changes in [{"status": "accepted"}, {"payment_status": "unpaid"}, {"client_id": "outsider"}, {"photographer_id": "outsider"}]:
            conn = MemoryConnection()
            conn.tables["bookings"]["parent"].update(changes)
            with self.assertRaises(HTTPException) as error:
                await self.run_command(conn, command("reviews"))
            self.assertEqual(error.exception.status_code, 409)
            self.assertEqual(conn.audit, [])
        conn = MemoryConnection()
        conn.tables["reviews"]["item"]["reviewer_id"] = "outsider"
        with self.assertRaises(HTTPException):
            await self.run_command(conn, command("reviews"))

    async def test_expired_story_cannot_be_approved_but_can_be_rejected(self):
        conn = MemoryConnection()
        conn.tables["stories"]["item"]["active"] = False
        with self.assertRaises(HTTPException):
            await self.run_command(conn, command("stories"))
        await self.run_command(conn, command("stories", "rejected"))

    async def test_post_rejection_cascades_audited_comments_and_never_unlocks_private_post(self):
        conn = MemoryConnection()
        conn.tables["posts"]["item"]["is_locked"] = True
        conn.tables["post_comments"]["item"].update(post_id="item", moderation_status="approved")
        result = await self.run_command(conn, command(decision="rejected"))
        self.assertTrue(conn.tables["posts"]["item"]["is_locked"])
        self.assertEqual(conn.tables["post_comments"]["item"]["moderation_status"], "rejected")
        self.assertEqual(result["rejected_comments"], 1)
        self.assertEqual(conn.audit[1][7], result["audit_event_id"])
        conn = MemoryConnection()
        conn.tables["posts"]["item"]["is_locked"] = True
        await self.run_command(conn)
        self.assertTrue(conn.tables["posts"]["item"]["is_locked"])

    async def test_audit_failure_rolls_back_content_and_review_status(self):
        conn = MemoryConnection()
        before = deepcopy(conn.tables)
        conn.fail_audit = True
        with self.assertRaises(RuntimeError):
            await self.run_command(conn, command("reviews"))
        self.assertEqual(conn.tables, before)
        self.assertEqual(conn.audit, [])

    async def test_stale_decision_and_missing_target_do_not_write(self):
        conn = MemoryConnection()
        await self.run_command(conn)
        with self.assertRaises(HTTPException) as error:
            await self.run_command(conn, command(decision="rejected"))
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(len(conn.audit), 1)
        del conn.tables["posts"]["item"]
        with self.assertRaises(HTTPException) as error:
            await self.run_command(conn)
        self.assertEqual(error.exception.status_code, 404)

    async def test_callable_delegate_validates_reasons_and_supported_schema_names(self):
        for payload in [{"table": "comments", "id": "item", "decision": "approved", "reason": "ok reason"}, {"table": "posts", "id": "item", "decision": "approved", "reason": " "}]:
            with self.assertRaises(HTTPException) as error:
                await handle_content_review(settings(), {"id": "admin"}, payload)
            self.assertEqual(error.exception.status_code, 400)


class ModerationHttpTests(unittest.TestCase):
    def setUp(self):
        self.conn = MemoryConnection()
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_settings] = settings
        self.client = TestClient(app)
        self.database = patch("app.admin_moderation.connect", new=AsyncMock(return_value=self.conn))
        self.database.start()
        self.auth = patch("app.builtin_functions.require_user", new=AsyncMock(side_effect=lambda config, token: {"id": token}))
        self.auth.start()
        self.addCleanup(self.database.stop)
        self.addCleanup(self.auth.stop)
        self.addCleanup(self.client.close)

    def test_admin_only_queue_and_decision_protocol(self):
        for path in ["/admin/moderation/content", "/admin/moderation/content/posts/item/preview"]:
            self.assertEqual(self.client.get(path).status_code, 401)
            self.assertEqual(self.client.get(path, headers={"Authorization": "Bearer client"}).status_code, 403)
        payload = command().model_dump()
        self.assertEqual(self.client.post("/admin/moderation/content/review", json=payload, headers={"Authorization": "Bearer client"}).status_code, 403)
        approved = self.client.post("/admin/moderation/content/review", json=payload, headers={"Authorization": "Bearer admin"})
        self.assertEqual(approved.status_code, 200)
        self.assertTrue(approved.json()["audit_event_id"])
        queued = self.client.get("/admin/moderation/content", headers={"Authorization": "Bearer admin"})
        self.assertEqual(queued.status_code, 200)
        self.assertEqual(queued.json()["counts"]["posts"], 0)

    def test_schema_reason_and_decision_validation(self):
        for changes in [{"reason": " "}, {"reason": "x" * 1001}, {"table": "posts; DROP TABLE profiles"}, {"decision": "verified"}, {"admin_id": "spoof"}]:
            response = self.client.post("/admin/moderation/content/review", json={**command().model_dump(), **changes}, headers={"Authorization": "Bearer admin"})
            self.assertEqual(response.status_code, 422)
        self.assertEqual(self.conn.audit, [])

    def test_preview_signs_only_owned_trusted_storage_references(self):
        with patch("app.admin_moderation.signed_url", return_value={"url": "https://qa.invalid/signed-preview"}) as sign:
            response = self.client.get("/admin/moderation/content/posts/item/preview", headers={"Authorization": "Bearer admin"})
            self.assertEqual(response.status_code, 200)
            sign.assert_called_once_with(settings(), "post-images", "users/creator/test.jpg", expires_in=300)
        for reference in ["https://untrusted.invalid/tracker.jpg", "post-images::users/victim/test.jpg", "kyc-documents::users/creator/test.jpg"]:
            self.conn.tables["posts"]["item"]["media_url"] = reference
            with patch("app.admin_moderation.signed_url") as sign:
                self.assertEqual(self.client.get("/admin/moderation/content/posts/item/preview", headers={"Authorization": "Bearer admin"}).status_code, 409)
                sign.assert_not_called()


@unittest.skipUnless(os.getenv("ADMIN_MODERATION_TEST_DATABASE_URL"), "Isolated QA PostgreSQL URL not supplied")
class RealPostgresModerationTests(unittest.IsolatedAsyncioTestCase):
    async def test_migration_audit_rollback_and_parent_protocol_on_real_postgres(self):
        import asyncpg
        import uuid

        url = os.environ["ADMIN_MODERATION_TEST_DATABASE_URL"]
        if "_qa_" not in urlsplit(url).path:
            self.fail("Refusing fixtures outside an explicitly named QA database")
        conn = await asyncpg.connect(url)
        schema = "qa_admin_moderation_" + uuid.uuid4().hex
        try:
            await conn.execute(f'CREATE SCHEMA "{schema}"; SET search_path TO "{schema}"')
            for table in ["posts", "stories", "post_comments", "reviews"]:
                await conn.execute(f"CREATE TABLE {table}(id text PRIMARY KEY,moderation_status text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now())")
            await conn.execute("ALTER TABLE posts ADD is_locked boolean; ALTER TABLE post_comments ADD post_id text")
            migration = Path(__file__).parents[1] / "migrations" / "202610030009_admin_moderation.sql"
            await conn.execute(migration.read_text(encoding="utf-8"))
            await conn.execute("INSERT INTO posts(id,moderation_status,is_locked) VALUES('item','pending',true); INSERT INTO post_comments(id,post_id,moderation_status) VALUES('child','item','approved')")

            class Lease:
                def __getattr__(self, name):
                    return getattr(conn, name)

                async def close(self):
                    pass

            with patch("app.admin_moderation.connect", new=AsyncMock(return_value=Lease())):
                result = await review_content(settings(), {"id": "admin"}, command(decision="rejected"))
                self.assertEqual(result["rejected_comments"], 1)
                self.assertTrue(await conn.fetchval("SELECT is_locked FROM posts WHERE id='item'"))
                self.assertEqual(await conn.fetchval("SELECT count(*) FROM content_moderation_events"), 2)
                with self.assertRaises(asyncpg.PostgresError):
                    await conn.execute("DELETE FROM content_moderation_events")
                with self.assertRaises(HTTPException):
                    await review_content(settings(), {"id": "admin"}, command())
                await conn.execute("UPDATE posts SET moderation_status='pending' WHERE id='item'; DROP TABLE content_moderation_events CASCADE")
                with self.assertRaises(asyncpg.PostgresError):
                    await review_content(settings(), {"id": "admin"}, command())
                self.assertEqual(await conn.fetchval("SELECT moderation_status FROM posts WHERE id='item'"), "pending")
        finally:
            await conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
            await conn.close()


if __name__ == "__main__":
    unittest.main()
