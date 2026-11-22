-- Contain legacy Supabase RPC access until every direct client path is audited.
--
-- The release app uses the FastAPI API provider. These functions remain
-- available to the server role and database triggers, but must not be exposed
-- as anonymous or ordinary-user PostgREST RPCs. In particular, wallet,
-- dispatch and video-settlement functions can change money-like state.

begin;

revoke execute on function public.auto_award_hat() from public, anon, authenticated;
revoke execute on function public.auto_create_booking_contract() from public, anon, authenticated;
revoke execute on function public.auto_create_booking_conversation() from public, anon, authenticated;
revoke execute on function public.auto_create_media_delivery() from public, anon, authenticated;
revoke execute on function public.auto_follow_on_booking() from public, anon, authenticated;
revoke execute on function public.auto_release_escrow_on_upload() from public, anon, authenticated;
revoke execute on function public.auto_tip_payment() from public, anon, authenticated;
revoke execute on function public.can_access_post(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.cleanup_expired_stories() from public, anon, authenticated;
revoke execute on function public.credits_adjust(integer, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.credits_adjust_for_user(uuid, integer, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.credits_redeem_code(text) from public, anon, authenticated;
revoke execute on function public.dispatch_accept_offer(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.dispatch_expire_open_requests() from public, anon, authenticated;
revoke execute on function public.enforce_subscription_expiry() from public, anon, authenticated;
revoke execute on function public.enqueue_booking_confirmed_event() from public, anon, authenticated;
revoke execute on function public.enqueue_new_message_event() from public, anon, authenticated;
revoke execute on function public.ensure_booking_conversation_and_contracts() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_payment_completed_earnings() from public, anon, authenticated;
revoke execute on function public.handle_tip_earnings() from public, anon, authenticated;
revoke execute on function public.has_active_subscription(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.is_conversation_member(uuid) from public, anon, authenticated;
revoke execute on function public.notify_booking_event() from public, anon, authenticated;
revoke execute on function public.notify_new_message() from public, anon, authenticated;
revoke execute on function public.notify_payment_completed() from public, anon, authenticated;
revoke execute on function public.refresh_availability_heatmap_hourly(integer) from public, anon, authenticated;
revoke execute on function public.refresh_recommendation_weights(integer) from public, anon, authenticated;
revoke execute on function public.settle_pending_video_call_sessions(integer) from public, anon, authenticated;
revoke execute on function public.settle_video_call_session(uuid) from public, anon, authenticated;
revoke execute on function public.sync_photographer_rating_from_reviews() from public, anon, authenticated;
revoke execute on function public.sync_role_tables() from public, anon, authenticated;
revoke execute on function public.toggle_post_like(uuid, uuid) from public, anon, authenticated;

commit;
