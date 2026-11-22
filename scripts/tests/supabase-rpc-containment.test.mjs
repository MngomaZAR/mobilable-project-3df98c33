import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(
  import.meta.dirname,
  "../../supabase/migrations/20261122090000_security_rpc_containment.sql",
);
const sql = fs.readFileSync(migrationPath, "utf8");
const searchPathSql = fs.readFileSync(
  path.resolve(
    import.meta.dirname,
    "../../supabase/migrations/20261122091000_harden_function_search_paths.sql",
  ),
  "utf8",
);

const signatures = [
  "auto_award_hat()",
  "auto_create_booking_contract()",
  "auto_create_booking_conversation()",
  "auto_create_media_delivery()",
  "auto_follow_on_booking()",
  "auto_release_escrow_on_upload()",
  "auto_tip_payment()",
  "can_access_post(uuid, uuid)",
  "cleanup_expired_stories()",
  "credits_adjust(integer, text, text, uuid)",
  "credits_adjust_for_user(uuid, integer, text, text, uuid)",
  "credits_redeem_code(text)",
  "dispatch_accept_offer(uuid, uuid, uuid, text)",
  "dispatch_expire_open_requests()",
  "enforce_subscription_expiry()",
  "enqueue_booking_confirmed_event()",
  "enqueue_new_message_event()",
  "ensure_booking_conversation_and_contracts()",
  "handle_new_user()",
  "handle_payment_completed_earnings()",
  "handle_tip_earnings()",
  "has_active_subscription(uuid, uuid)",
  "is_conversation_member(uuid)",
  "notify_booking_event()",
  "notify_new_message()",
  "notify_payment_completed()",
  "refresh_availability_heatmap_hourly(integer)",
  "refresh_recommendation_weights(integer)",
  "settle_pending_video_call_sessions(integer)",
  "settle_video_call_session(uuid)",
  "sync_photographer_rating_from_reviews()",
  "sync_role_tables()",
  "toggle_post_like(uuid, uuid)",
];

test("every exposed security-definer RPC is contained", () => {
  for (const signature of signatures) {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const revoke = new RegExp(
      `revoke execute on function public\\.${escaped} from public, anon, authenticated;`,
      "i",
    );
    assert.match(sql, revoke, `missing containment for ${signature}`);
  }
});

test("the containment migration does not grant RPC access back to client roles", () => {
  assert.doesNotMatch(sql, /grant\\s+execute[\\s\\S]*\\b(?:anon|authenticated)\\b/i);
});

test("the hardened function migration pins every altered function to trusted schemas", () => {
  const alteredFunctions = searchPathSql.match(/alter function public\.[^;]+/gi) ?? [];
  assert.equal(alteredFunctions.length, 27);
  for (const statement of alteredFunctions) {
    assert.match(statement, /set search_path = public, extensions, auth, pg_catalog/i);
  }
});
