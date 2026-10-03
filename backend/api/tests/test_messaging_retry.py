"""Focused command tests with a transactional fake, not live Postgres/media proof."""

import asyncio
import copy
import json
import unittest
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from fastapi import HTTPException

from app.config import Settings
from app.messaging import chat_messages, start_conversation
from app.social import create_comment, toggle_post_like


class MessageStore:
    def __init__(self):
        self.conversations = {"chat-a": {"id": "chat-a", "title": "Chat", "direct_key": "alice:bob"}}
        self.members = {"chat-a": {"alice", "bob"}}
        self.profiles = {"alice", "bob", "outsider"}
        self.blocks = set()
        self.messages = {}
        self.reactions = []
        self.last_read = {}
        self.comments = {}
        self.comment_counter_updates = 0
        self.jobs = {}
        self.metadata_updates = []
        self.locks = {}
        self.connections = []
        self.post = {"id": "post-a", "author_id": "bob", "moderation_status": "approved", "is_locked": False, "comment_count": 0}
        self.likes = set()

    async def connect(self, settings):
        connection = MessageConnection(self)
        self.connections.append(connection)
        return connection

    def unread(self, user_id):
        return sum(
            row["sender_id"] != user_id and row["read_at"] is None and row["deleted_at"] is None
            for row in self.messages.values() if user_id in self.members.get(row["conversation_id"], set())
        )


class MessageConnection:
    def __init__(self, store):
        self.store = store
        self.held_locks = []
        self.undo = []
        self.closed = False

    @asynccontextmanager
    async def transaction(self):
        try:
            yield
        except BaseException:
            for undo in reversed(self.undo):
                undo()
            raise
        finally:
            for lock in reversed(self.held_locks):
                lock.release()

    async def close(self):
        self.closed = True

    async def fetch(self, sql, *args):
        await asyncio.sleep(0)
        if "SELECT p.user_id" in sql:
            members = self.store.members.get(args[0], set()) if args[0] in self.store.conversations else set()
            return [{"user_id": member} for member in sorted(members)]
        if "recent ORDER BY created_at" in sql:
            return [copy.deepcopy(row) for row in self.store.messages.values()
                    if row["conversation_id"] == args[0] and row["deleted_at"] is None][-200:]
        raise AssertionError(sql)

    async def fetchval(self, sql, *args):
        await asyncio.sleep(0)
        if "FROM profiles" in sql:
            return args[0] in self.store.profiles
        if "FROM user_blocks" in sql:
            others = [args[1]] if isinstance(args[1], str) else args[1]
            return any((args[0], other) in self.store.blocks or (other, args[0]) in self.store.blocks for other in others)
        if "FROM message_reactions" in sql:
            return any((row["message_id"], row["user_id"], row["emoji"]) == args for row in self.store.reactions)
        if "UPDATE conversation_participants SET last_read_at" in sql:
            before = self.store.last_read.get(args)
            self.store.last_read[args] = datetime.now(UTC)
            self.undo.append(lambda: self.store.last_read.__setitem__(args, before) if before else self.store.last_read.pop(args))
            return self.store.last_read[args]
        raise AssertionError(sql)

    async def fetchrow(self, sql, *args):
        await asyncio.sleep(0)
        if "FROM conversations WHERE direct_key" in sql:
            return next((dict(row) for row in self.store.conversations.values() if row["direct_key"] == args[0]), None)
        if "SELECT id FROM conversations" in sql:
            lock = self.store.locks.setdefault(f"conversation:{args[0]}", asyncio.Lock())
            await lock.acquire()
            self.held_locks.append(lock)
            return copy.deepcopy(self.store.conversations.get(args[0]))
        if "INSERT INTO conversations" in sql:
            row = dict(zip(["id", "title", "direct_key"], args))
            self.store.conversations[row["id"]] = row
            return dict(row)
        if "FROM messages WHERE sender_id" in sql:
            return next((copy.deepcopy(row) for row in self.store.messages.values()
                         if (row["sender_id"], row["client_message_id"]) == args), None)
        if "SELECT id,sender_id,deleted_at" in sql:
            lock = self.store.locks.setdefault(f"message:{args[0]}", asyncio.Lock())
            await lock.acquire()
            self.held_locks.append(lock)
            row = self.store.messages.get(args[0])
            return copy.deepcopy(row) if row and row["conversation_id"] == args[1] else None
        if "SELECT body,created_at" in sql:
            rows = [row for row in self.store.messages.values() if row["conversation_id"] == args[0] and row["deleted_at"] is None]
            return copy.deepcopy(max(rows, key=lambda row: (row["created_at"], row["id"]))) if rows else None
        if "SELECT sender_id,media_url,preview_url" in sql:
            row = self.store.messages.get(args[0])
            if row and row["conversation_id"] == args[1] and not row["deleted_at"] and not row["locked"]:
                return copy.deepcopy(row)
            return None
        if "INSERT INTO messages" in sql:
            columns = ["id", "conversation_id", "sender_id", "text", "message_type", "media_url", "preview_url", "client_message_id", "request_fingerprint"]
            row = dict(zip(columns, args))
            assert not any((old["sender_id"], old["client_message_id"]) == (row["sender_id"], row["client_message_id"])
                           for old in self.store.messages.values()), "Duplicate retry key insert"
            row.update(body=row["text"], chat_id=row["conversation_id"], locked=False, unlocked=True,
                       read_at=None, deleted_at=None, created_at=datetime.now(UTC))
            self.store.messages[row["id"]] = row
            self.undo.append(lambda: self.store.messages.pop(row["id"]))
            return copy.deepcopy(row)
        if "FROM posts" in sql:
            if "FOR UPDATE" in sql:
                lock = self.store.locks.setdefault(f"post:{args[0]}", asyncio.Lock())
                await lock.acquire()
                self.held_locks.append(lock)
            return dict(self.store.post) if args[0] == self.store.post["id"] else None
        if "FROM post_comments WHERE user_id" in sql:
            return next((copy.deepcopy(row) for row in self.store.comments.values()
                         if (row["user_id"], row["idempotency_key"]) == args), None)
        if "INSERT INTO post_comments" in sql:
            row = dict(zip(["id", "post_id", "user_id", "body", "idempotency_key", "request_fingerprint"], args))
            if row["idempotency_key"] is not None:
                assert not any((old["user_id"], old["idempotency_key"]) == (row["user_id"], row["idempotency_key"])
                               for old in self.store.comments.values()), "Duplicate comment retry key insert"
            row.update(author_id=row["user_id"], moderation_status="pending", created_at=datetime.now(UTC))
            self.store.comments[row["id"]] = row
            self.undo.append(lambda: self.store.comments.pop(row["id"]))
            return copy.deepcopy(row)
        if "DELETE FROM post_likes" in sql:
            if args in self.store.likes:
                self.store.likes.remove(args)
                return {"id": "like-a"}
            return None
        raise AssertionError(sql)

    async def execute(self, sql, *args):
        await asyncio.sleep(0)
        if "pg_advisory_xact_lock" in sql:
            lock = self.store.locks.setdefault(args[0], asyncio.Lock())
            await lock.acquire()
            self.held_locks.append(lock)
        elif "UPDATE conversations" in sql:
            before = copy.deepcopy(self.store.conversations[args[0]])
            self.store.conversations[args[0]].update(last_message=args[1], last_message_at=args[2] if len(args) == 3 else datetime.now(UTC))
            self.undo.append(lambda: self.store.conversations[args[0]].update(before))
            self.store.metadata_updates.append(args)
            self.undo.append(lambda: self.store.metadata_updates.remove(args))
        elif "INSERT INTO job_outbox" in sql:
            key = args[2]
            if key not in self.store.jobs:
                self.store.jobs[key] = json.loads(args[1])
                self.undo.append(lambda: self.store.jobs.pop(key))
        elif "INSERT INTO conversation_participants" in sql:
            self.store.members.setdefault(args[1], set()).add(args[2])
        elif "UPDATE messages SET deleted_at" in sql:
            row = self.store.messages[args[0]]
            before = row["deleted_at"]
            row["deleted_at"] = datetime.now(UTC)
            self.undo.append(lambda: row.update(deleted_at=before))
        elif "UPDATE messages SET read_at" in sql:
            for row in self.store.messages.values():
                if row["conversation_id"] == args[0] and row["sender_id"] != args[1] and row["read_at"] is None and row["deleted_at"] is None:
                    row["read_at"] = datetime.now(UTC)
                    self.undo.append(lambda row=row: row.update(read_at=None))
        elif "INSERT INTO message_reactions" in sql:
            row = dict(zip(["id", "message_id", "user_id", "emoji"], args))
            self.store.reactions.append(row)
            self.undo.append(lambda: self.store.reactions.remove(row))
        elif "DELETE FROM message_reactions" in sql:
            removed = [row for row in self.store.reactions if row["message_id"] == args[0]
                       and (len(args) == 1 or (row["user_id"], row["emoji"]) == args[1:])]
            self.store.reactions = [row for row in self.store.reactions if row not in removed]
            self.undo.append(lambda: self.store.reactions.extend(removed))
        elif "INSERT INTO post_likes" in sql:
            self.store.likes.add((args[1], args[2]))
        elif "UPDATE posts SET comment_count" in sql:
            before = self.store.post["comment_count"]
            self.store.post["comment_count"] = sum(row["post_id"] == args[0] for row in self.store.comments.values())
            self.store.comment_counter_updates += 1
            self.undo.append(lambda: self.store.post.update(comment_count=before))
        elif "UPDATE posts" not in sql:
            raise AssertionError(sql)


class MessagingRetryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.settings = Settings(_env_file=None, DATABASE_URL="postgresql://unused",
                                 API_PUBLIC_URL="https://api.example.test", MINIO_SECRET_KEY="test-secret")
        self.store = MessageStore()
        self.user = {"id": "alice"}
        self.payload = {"action": "send", "conversation_id": "chat-a", "client_message_id": "draft-a", "text": "Hello"}
        self.connect_patch = patch("app.messaging.connect", new=self.store.connect)
        self.connect_patch.start()
        self.addCleanup(self.connect_patch.stop)

    async def send(self, **changes):
        return await chat_messages(self.settings, self.user, {**self.payload, **changes})

    async def denied(self, status, user=None, **changes):
        with self.assertRaises(HTTPException) as error:
            await chat_messages(self.settings, user or self.user, {**self.payload, **changes})
        self.assertEqual(error.exception.status_code, status)
        self.assertTrue(self.store.connections[-1].closed)

    async def test_identical_retry_does_not_duplicate_unread_or_side_effects(self):
        original = await self.send()
        replay = await self.send()
        self.assertEqual(original, replay)
        self.assertEqual(original["message"]["client_message_id"], "draft-a")
        self.assertNotIn("request_fingerprint", original["message"])
        self.assertEqual(len(self.store.messages), 1)
        self.assertEqual(self.store.unread("bob"), 1)
        self.assertEqual(len(self.store.jobs), 1)
        self.assertEqual(len(self.store.metadata_updates), 1)

    async def test_concurrent_retries_insert_only_once(self):
        results = await asyncio.wait_for(asyncio.gather(*(self.send() for _ in range(12))), timeout=10)
        self.assertTrue(all(result == results[0] for result in results))
        self.assertEqual(len(self.store.messages), 1)
        self.assertEqual(self.store.unread("bob"), 1)
        self.assertEqual(len(self.store.jobs), 1)
        self.assertEqual(len(self.store.metadata_updates), 1)

    async def test_same_key_different_payload_returns_409(self):
        await self.send()
        self.store.conversations["chat-b"] = {"id": "chat-b"}
        self.store.members["chat-b"] = {"alice", "bob"}
        for change in [{"text": "Different"}, {"media_url": "chat-media::users/alice/photo.jpg"}, {"conversation_id": "chat-b"}]:
            with self.subTest(change=change):
                await self.denied(409, **change)
        self.assertEqual(len(self.store.messages), 1)
        self.assertEqual(len(self.store.jobs), 1)
        self.assertEqual(len(self.store.metadata_updates), 1)

    async def test_concurrent_conflicting_retries_have_one_success(self):
        results = await asyncio.wait_for(asyncio.gather(self.send(), self.send(text="Different"), return_exceptions=True), timeout=10)
        self.assertEqual(sum(isinstance(result, dict) for result in results), 1)
        conflict = next(result for result in results if isinstance(result, HTTPException))
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(self.store.unread("bob"), 1)

    async def test_new_keys_and_other_senders_are_distinct_sends(self):
        await self.send(sender_id="outsider")
        await self.send(client_message_id="draft-b")
        await chat_messages(self.settings, {"id": "bob"}, self.payload)
        self.assertEqual(len(self.store.messages), 3)
        self.assertEqual(self.store.unread("bob"), 2)
        self.assertEqual(self.store.unread("alice"), 1)
        self.assertEqual([row["sender_id"] for row in self.store.messages.values()], ["alice", "alice", "bob"])

    async def test_missing_or_invalid_client_ids_are_rejected(self):
        for key in [None, "", " x ", 12, [], "x" * 121, "bad\x00key"]:
            with self.subTest(key=key):
                await self.denied(400, client_message_id=key)
        self.assertFalse(self.store.messages)

    async def test_membership_is_checked_for_list_send_and_media(self):
        for action in ["list", "send", "media-url"]:
            await self.denied(403, user={"id": "outsider"}, action=action)
        self.store.members["orphan"] = {"alice"}
        await self.denied(403, action="list", conversation_id="orphan")

    async def test_retry_after_membership_removal_is_rejected(self):
        await self.send()
        self.store.members["chat-a"].remove("alice")
        await self.denied(403)
        self.assertEqual(len(self.store.messages), 1)

    async def test_blocks_apply_in_both_directions_to_list_retry_and_media(self):
        await self.send()
        for pair in [("alice", "bob"), ("bob", "alice")]:
            self.store.blocks = {pair}
            for action in ["list", "send", "media-url"]:
                await self.denied(403, action=action)
        self.assertEqual(len(self.store.messages), 1)
        self.assertEqual(len(self.store.jobs), 1)

    async def test_deleted_message_retry_does_not_resurrect_it(self):
        result = await self.send()
        self.store.messages[result["message"]["id"]]["deleted_at"] = datetime.now(UTC)
        replay = await self.send()
        self.assertEqual(replay["message"]["id"], result["message"]["id"])
        self.assertEqual(self.store.unread("bob"), 0)
        self.assertEqual(len(self.store.jobs), 1)
        self.assertEqual((await self.send(action="list"))["messages"], [])

    async def test_message_and_side_effects_roll_back_together(self):
        execute = MessageConnection.execute

        async def fail_outbox(connection, sql, *args):
            if "INSERT INTO job_outbox" in sql:
                raise RuntimeError("outbox unavailable")
            return await execute(connection, sql, *args)

        with patch.object(MessageConnection, "execute", new=fail_outbox):
            with self.assertRaises(RuntimeError):
                await self.send()
        self.assertFalse(self.store.messages)
        self.assertFalse(self.store.metadata_updates)
        await self.send()
        self.assertEqual(self.store.unread("bob"), 1)
        self.assertEqual(len(self.store.jobs), 1)

    async def test_media_and_preview_are_durable_refs_and_replay_payload(self):
        media = "chat-media::users/alice/photo.jpg"
        preview = "chat-media::users/alice/preview.jpg"
        original = await self.send(text="", media_url=media, preview_url=preview)
        self.assertEqual(original, await self.send(text="", media_url=media, preview_url=preview))
        await self.denied(409, text="", media_url=media, preview_url="chat-media::users/alice/other.jpg")
        listed = await self.send(action="list")
        self.assertEqual(listed["messages"][0]["media_url"], media)
        self.assertEqual(listed["messages"][0]["preview_url"], preview)
        self.assertNotIn("request_fingerprint", listed["messages"][0])
        self.assertEqual(self.store.unread("bob"), 1)

    async def test_expiring_urls_foreign_refs_and_unsafe_paths_are_rejected(self):
        for reference, status in [
            ("https://api.example.test/storage/object?expiry=100", 403),
            ("chat-media::users/bob/photo.jpg", 403),
            ("media::users/alice/photo.jpg", 403),
            ("chat-media::users/alice/../bob/photo.jpg", 400),
            ("chat-media::users/alice/photo.jpg?expiry=100", 400),
            ("chat-media::users/alice/", 400),
        ]:
            for field in ["media_url", "preview_url"]:
                with self.subTest(reference=reference, field=field):
                    await self.denied(status, **{"media_url": "chat-media::users/alice/photo.jpg", field: reference})
        self.assertFalse(self.store.messages)

    async def test_attachment_urls_are_fresh_and_authorized_without_persistence(self):
        media = "chat-media::users/alice/photo.jpg"
        preview = "chat-media::users/alice/preview.jpg"
        message = (await self.send(media_url=media, preview_url=preview))["message"]
        request = {"action": "media-url", "conversation_id": "chat-a", "message_id": message["id"]}
        with patch("app.storage.time.time", return_value=1000):
            first = await chat_messages(self.settings, {"id": "bob"}, request)
        with patch("app.storage.time.time", return_value=1060):
            fresh = await chat_messages(self.settings, {"id": "bob"}, request)
            preview_link = await chat_messages(self.settings, {"id": "bob"}, {**request, "field": "preview_url"})
        self.assertNotEqual(first["url"], fresh["url"])
        self.assertTrue(fresh["url"].startswith("https://api.example.test/storage/object?"))
        self.assertEqual(parse_qs(urlparse(preview_link["url"]).query)["path"], ["users/alice/preview.jpg"])
        self.assertEqual(self.store.messages[message["id"]]["media_url"], media)
        self.assertEqual(self.store.messages[message["id"]]["preview_url"], preview)
        self.assertEqual(len(self.store.metadata_updates), 1)

    async def test_missing_deleted_locked_or_wrong_conversation_attachment_is_denied(self):
        message = (await self.send(media_url="chat-media::users/alice/photo.jpg"))["message"]
        await self.denied(404, action="media-url", message_id="missing")
        await self.denied(400, action="media-url", message_id=message["id"], field="body")
        await self.denied(400, action="media-url", message_id=message["id"], field=[])
        await self.denied(404, action="media-url", message_id=message["id"], field="preview_url")
        self.store.conversations["chat-b"] = {"id": "chat-b"}
        self.store.members["chat-b"] = {"alice", "bob"}
        await self.denied(404, action="media-url", message_id=message["id"], conversation_id="chat-b")
        self.store.messages[message["id"]]["locked"] = True
        await self.denied(404, action="media-url", message_id=message["id"])
        self.store.messages[message["id"]].update(locked=False, deleted_at=datetime.now(UTC))
        await self.denied(404, action="media-url", message_id=message["id"])

    async def test_invalid_message_shapes_and_paid_actions_remain_rejected(self):
        for changes in [{"text": ""}, {"text": "x" * 8001}, {"text": []}, {"message_type": "media"}, {"preview_url": "chat-media::users/alice/preview.jpg"}]:
            await self.denied(400, **changes)
        for changes in [{"locked": True}, {"unlock_price": 1}, {"unlock_booking_id": "booking-a"}, {"unlocked": False}, {"action": "unlock"}]:
            await self.denied(409, **changes)
        self.assertFalse(self.store.messages)

    async def test_existing_direct_conversation_requires_actual_pair_membership(self):
        result = await start_conversation(self.settings, self.user, {"participant_id": "bob"})
        self.assertEqual(result["id"], "chat-a")
        for members in [{"bob"}, {"alice"}, {"alice", "bob", "outsider"}]:
            self.store.members["chat-a"] = members
            with self.assertRaises(HTTPException) as error:
                await start_conversation(self.settings, self.user, {"participant_id": "bob"})
            self.assertEqual(error.exception.status_code, 403)

    async def test_start_checks_blocks_and_creates_both_members(self):
        for pair in [("alice", "bob"), ("bob", "alice")]:
            self.store.blocks = {pair}
            with self.assertRaises(HTTPException) as error:
                await start_conversation(self.settings, self.user, {"participant_id": "bob"})
            self.assertEqual(error.exception.status_code, 403)
        self.store.blocks.clear()
        result = await start_conversation(self.settings, self.user, {"participant_id": "outsider"})
        self.assertEqual(self.store.members[result["id"]], {"alice", "outsider"})

    async def test_domain_actions_recheck_membership_blocks_and_message_conversation(self):
        message_id = (await self.send())["message"]["id"]
        for action in ["read", "delete", "react"]:
            arguments = {"action": action, "message_id": message_id, "operation": "add", "emoji": "\U0001f525"}
            await self.denied(403, user={"id": "outsider"}, **arguments)
            for pair in [("alice", "bob"), ("bob", "alice")]:
                self.store.blocks = {pair}
                await self.denied(403, **arguments)
            self.store.blocks.clear()
        self.store.conversations["chat-b"] = {"id": "chat-b"}
        self.store.members["chat-b"] = {"alice", "bob"}
        for action in ["delete", "react"]:
            await self.denied(404, action=action, message_id=message_id, conversation_id="chat-b", operation="add", emoji="\U0001f525")
        self.assertIsNone(self.store.messages[message_id]["deleted_at"])
        self.assertIsNone(self.store.messages[message_id]["read_at"])
        self.assertFalse(self.store.reactions)

    async def test_sender_only_delete_is_idempotent_and_restores_preview(self):
        first = (await self.send())["message"]
        second = (await self.send(text="Second", client_message_id="draft-b"))["message"]
        await self.denied(403, user={"id": "bob"}, action="delete", message_id=second["id"])
        await self.send(action="react", message_id=second["id"], operation="add", emoji="\U0001f525")
        await self.send(action="delete", message_id=second["id"])
        deleted_at = self.store.messages[second["id"]]["deleted_at"]
        updates = len(self.store.metadata_updates)
        await self.send(action="delete", message_id=second["id"])
        self.assertEqual(self.store.messages[second["id"]]["deleted_at"], deleted_at)
        self.assertEqual(len(self.store.metadata_updates), updates)
        self.assertEqual(self.store.conversations["chat-a"]["last_message"], "Hello")
        self.assertFalse(self.store.reactions)
        self.assertEqual([row["id"] for row in (await self.send(action="list"))["messages"]], [first["id"]])
        await self.send(action="delete", message_id=first["id"])
        self.assertEqual(self.store.conversations["chat-a"]["last_message"], "")
        self.assertIsNone(self.store.conversations["chat-a"]["last_message_at"])

    async def test_reactions_add_and_remove_are_idempotent_without_a_unique_index(self):
        message_id = (await self.send())["message"]["id"]
        arguments = {"action": "react", "message_id": message_id, "operation": "add", "emoji": "\U0001f525", "user_id": "outsider"}
        await self.send(**arguments)
        await self.send(**arguments)
        self.assertEqual(len(self.store.reactions), 1)
        self.assertEqual(self.store.reactions[0]["user_id"], "alice")
        await chat_messages(self.settings, {"id": "bob"}, {**self.payload, **arguments})
        await self.send(**{**arguments, "operation": "remove"})
        await self.send(**{**arguments, "operation": "remove"})
        self.assertEqual([row["user_id"] for row in self.store.reactions], ["bob"])

    async def test_concurrent_reaction_adds_insert_once(self):
        message_id = (await self.send())["message"]["id"]
        await asyncio.wait_for(asyncio.gather(*(self.send(action="react", message_id=message_id, operation="add", emoji="\U0001f525") for _ in range(12))), timeout=10)
        self.assertEqual(len(self.store.reactions), 1)

    async def test_legacy_duplicate_reactions_are_not_added_again_and_remove_cleans_all(self):
        message_id = (await self.send())["message"]["id"]
        self.store.reactions = [{"id": str(index), "message_id": message_id, "user_id": "alice", "emoji": "\U0001f525"} for index in range(3)]
        await self.send(action="react", message_id=message_id, operation="add", emoji="\U0001f525")
        self.assertEqual(len(self.store.reactions), 3)
        await self.send(action="react", message_id=message_id, operation="remove", emoji="\U0001f525")
        self.assertFalse(self.store.reactions)

    async def test_deleted_and_missing_messages_cannot_be_reacted_to(self):
        message_id = (await self.send())["message"]["id"]
        await self.send(action="delete", message_id=message_id)
        for target in [message_id, "missing"]:
            await self.denied(404, action="react", message_id=target, operation="add", emoji="\U0001f525")
        for arguments in [{"message_id": None}, {"message_id": []}, {"emoji": []}, {"emoji": "invalid"}, {"operation": "toggle"}]:
            await self.denied(400, **{"action": "react", "message_id": message_id, "operation": "add", "emoji": "\U0001f525", **arguments})

    async def test_read_marks_only_live_incoming_messages_and_preserves_first_read(self):
        incoming = (await self.send())["message"]["id"]
        deleted = (await self.send(client_message_id="draft-b"))["message"]["id"]
        await self.send(action="delete", message_id=deleted)
        own = (await chat_messages(self.settings, {"id": "bob"}, {**self.payload, "client_message_id": "bob-draft"}))["message"]["id"]
        result = await chat_messages(self.settings, {"id": "bob"}, {"conversation_id": "chat-a", "action": "read", "read_at": "forged"})
        read_at = self.store.messages[incoming]["read_at"]
        self.assertTrue(result["success"])
        self.assertIsInstance(result["read_at"], datetime)
        self.assertIsNotNone(read_at)
        self.assertIsNone(self.store.messages[own]["read_at"])
        self.assertIsNone(self.store.messages[deleted]["read_at"])
        await chat_messages(self.settings, {"id": "bob"}, {"conversation_id": "chat-a", "action": "read"})
        self.assertEqual(self.store.messages[incoming]["read_at"], read_at)
        self.assertEqual(self.store.unread("bob"), 0)

    async def test_concurrent_read_and_delete_reaction_commands_complete(self):
        message_id = (await self.send())["message"]["id"]
        await asyncio.wait_for(asyncio.gather(*(chat_messages(self.settings, {"id": user_id}, {"conversation_id": "chat-a", "action": "read"}) for user_id in ["alice", "bob"] * 3)), timeout=10)
        results = await asyncio.wait_for(asyncio.gather(
            self.send(action="delete", message_id=message_id),
            self.send(action="react", message_id=message_id, operation="add", emoji="\U0001f525"), return_exceptions=True,
        ), timeout=10)
        self.assertTrue(any(isinstance(result, dict) for result in results))
        self.assertFalse(self.store.reactions)

    async def test_likes_deny_blocked_hidden_and_locked_posts(self):
        with patch("app.social.connect", new=self.store.connect):
            for pair in [("alice", "bob"), ("bob", "alice")]:
                self.store.blocks = {pair}
                with self.assertRaises(HTTPException) as error:
                    await toggle_post_like(self.settings, self.user, {"p_post_id": "post-a"})
                self.assertEqual(error.exception.status_code, 404)
            self.store.blocks.clear()
            for fields in [{"moderation_status": "pending", "is_locked": False}, {"moderation_status": "approved", "is_locked": True}]:
                self.store.post.update(fields)
                with self.assertRaises(HTTPException) as error:
                    await toggle_post_like(self.settings, self.user, {"p_post_id": "post-a"})
                self.assertEqual(error.exception.status_code, 404)
            self.store.post.update(moderation_status="approved", is_locked=False)
            self.assertTrue((await toggle_post_like(self.settings, self.user, {"p_post_id": "post-a"}))["data"])
            self.assertFalse((await toggle_post_like(self.settings, self.user, {"p_post_id": "post-a"}))["data"])


class CommentCommandTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.settings = Settings(_env_file=None, DATABASE_URL="postgresql://unused")
        self.store = MessageStore()
        self.user = {"id": "alice"}
        self.payload = {"post_id": "post-a", "text": " A comment "}
        connection_patch = patch("app.social.connect", new=self.store.connect)
        connection_patch.start()
        self.addCleanup(connection_patch.stop)

    async def comment(self, **changes):
        return await create_comment(self.settings, self.user, {**self.payload, **changes})

    async def denied(self, status, **changes):
        with self.assertRaises(HTTPException) as error:
            await self.comment(**changes)
        self.assertEqual(error.exception.status_code, status)
        self.assertTrue(all(connection.closed for connection in self.store.connections))

    async def test_comment_forces_owners_parent_and_pending_moderation(self):
        result = await self.comment(user_id="outsider", author_id="outsider", moderation_status="approved", comment_count=500)
        row = result["comment"]
        self.assertEqual(row["user_id"], "alice")
        self.assertEqual(row["author_id"], "alice")
        self.assertEqual(row["post_id"], "post-a")
        self.assertEqual(row["body"], "A comment")
        self.assertEqual(row["moderation_status"], "pending")
        self.assertNotIn("request_fingerprint", row)
        self.assertEqual(self.store.post["comment_count"], 1)

    async def test_comment_text_post_and_retry_key_validation(self):
        for text in [None, [], {}, "", "  ", "x" * 2001, "bad\x00text"]:
            await self.denied(400, text=text)
        for post in [None, "", " ", [], "bad\x00post"]:
            await self.denied(400, post_id=post)
        for key in ["", " key ", [], 12, "x" * 121, "bad\x00key"]:
            await self.denied(400, idempotency_key=key)
        row = (await self.comment(text="x" * 2000))["comment"]
        self.assertEqual(len(row["body"]), 2000)

    async def test_comment_accepts_existing_body_payload(self):
        result = await create_comment(self.settings, self.user, {"post_id": "post-a", "body": " Existing payload "})
        self.assertEqual(result["comment"]["body"], "Existing payload")

    async def test_comments_require_visible_post_or_ownership_and_no_blocks(self):
        await self.denied(404, post_id="missing")
        for status, locked in [("pending", False), ("rejected", False), (None, False), ("approved", True)]:
            self.store.post.update(moderation_status=status, is_locked=locked)
            await self.denied(404)
        self.store.post.update(moderation_status="approved", is_locked=False)
        for pair in [("alice", "bob"), ("bob", "alice")]:
            self.store.blocks = {pair}
            await self.denied(404)
        self.store.blocks.clear()
        self.store.post.update(author_id="alice", moderation_status="pending", is_locked=True)
        await self.comment()
        self.assertEqual(self.store.post["comment_count"], 1)

    async def test_comment_replay_does_not_duplicate_rows_or_counter_updates(self):
        original = await self.comment(idempotency_key="draft-a")
        self.assertEqual(original, await self.comment(idempotency_key="draft-a"))
        await self.denied(409, idempotency_key="draft-a", text="Different")
        self.store.post["id"] = "post-b"
        await self.denied(409, post_id="post-b", idempotency_key="draft-a")
        self.assertEqual(len(self.store.comments), 1)
        self.assertEqual(self.store.comment_counter_updates, 1)

    async def test_comment_retry_rechecks_visibility_and_blocks(self):
        await self.comment(idempotency_key="draft-a")
        self.store.blocks = {("bob", "alice")}
        await self.denied(404, idempotency_key="draft-a")
        self.store.blocks.clear()
        self.store.post["moderation_status"] = "rejected"
        await self.denied(404, idempotency_key="draft-a")
        self.assertEqual(len(self.store.comments), 1)

    async def test_concurrent_comment_retries_and_distinct_sends_update_counter_atomically(self):
        retries = await asyncio.wait_for(asyncio.gather(*(self.comment(idempotency_key="draft-a") for _ in range(10))), timeout=10)
        self.assertTrue(all(result == retries[0] for result in retries))
        self.assertEqual(self.store.post["comment_count"], 1)
        await asyncio.wait_for(asyncio.gather(*(self.comment(idempotency_key=f"draft-{index}") for index in range(10))), timeout=10)
        self.assertEqual(self.store.post["comment_count"], 11)
        self.assertEqual(len(self.store.comments), 11)

    async def test_unkeyed_comments_and_other_authors_are_distinct(self):
        await self.comment()
        await self.comment()
        await self.comment(idempotency_key="draft-a")
        await create_comment(self.settings, {"id": "bob"}, {**self.payload, "idempotency_key": "draft-a"})
        self.assertEqual(len(self.store.comments), 4)
        self.assertEqual(self.store.post["comment_count"], 4)

    async def test_comment_insert_rolls_back_when_counter_write_fails(self):
        execute = MessageConnection.execute

        async def fail_counter(connection, sql, *args):
            if "UPDATE posts SET comment_count" in sql:
                raise RuntimeError("counter unavailable")
            return await execute(connection, sql, *args)

        with patch.object(MessageConnection, "execute", new=fail_counter):
            with self.assertRaises(RuntimeError):
                await self.comment(idempotency_key="draft-a")
        self.assertFalse(self.store.comments)
        self.assertEqual(self.store.post["comment_count"], 0)
        await self.comment(idempotency_key="draft-a")
        self.assertEqual(self.store.post["comment_count"], 1)


if __name__ == "__main__":
    unittest.main()
