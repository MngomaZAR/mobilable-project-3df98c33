-- Pin function name resolution to trusted schemas.
--
-- Keep public in the path because the existing functions reference legacy
-- public tables/types and some call other public helpers. Do not add a caller
-- controlled schema to a SECURITY DEFINER function's search_path.

begin;

alter function public.auto_award_hat() set search_path = public, extensions, auth, pg_catalog;
alter function public.auto_create_booking_contract() set search_path = public, extensions, auth, pg_catalog;
alter function public.auto_create_booking_conversation() set search_path = public, extensions, auth, pg_catalog;
alter function public.auto_create_media_delivery() set search_path = public, extensions, auth, pg_catalog;
alter function public.auto_follow_on_booking() set search_path = public, extensions, auth, pg_catalog;
alter function public.auto_release_escrow_on_upload() set search_path = public, extensions, auth, pg_catalog;
alter function public.auto_tip_payment() set search_path = public, extensions, auth, pg_catalog;
alter function public.calculate_booking_pricing() set search_path = public, extensions, auth, pg_catalog;
alter function public.can_access_post(uuid, uuid) set search_path = public, extensions, auth, pg_catalog;
alter function public.check_age_verification() set search_path = public, extensions, auth, pg_catalog;
alter function public.cleanup_expired_stories() set search_path = public, extensions, auth, pg_catalog;
alter function public.credits_adjust_for_user(uuid, integer, text, text, uuid) set search_path = public, extensions, auth, pg_catalog;
alter function public.dispatch_accept_offer(uuid, uuid, uuid, text) set search_path = public, extensions, auth, pg_catalog;
alter function public.dispatch_expire_open_requests() set search_path = public, extensions, auth, pg_catalog;
alter function public.enforce_subscription_expiry() set search_path = public, extensions, auth, pg_catalog;
alter function public.has_active_subscription(uuid, uuid) set search_path = public, extensions, auth, pg_catalog;
alter function public.notify_booking_event() set search_path = public, extensions, auth, pg_catalog;
alter function public.notify_new_message() set search_path = public, extensions, auth, pg_catalog;
alter function public.notify_payment_completed() set search_path = public, extensions, auth, pg_catalog;
alter function public.refresh_availability_heatmap_hourly(integer) set search_path = public, extensions, auth, pg_catalog;
alter function public.refresh_recommendation_weights(integer) set search_path = public, extensions, auth, pg_catalog;
alter function public.set_updated_at() set search_path = public, extensions, auth, pg_catalog;
alter function public.settle_pending_video_call_sessions(integer) set search_path = public, extensions, auth, pg_catalog;
alter function public.settle_video_call_session(uuid) set search_path = public, extensions, auth, pg_catalog;
alter function public.sync_kyc_document_aliases() set search_path = public, extensions, auth, pg_catalog;
alter function public.sync_notification_event_aliases() set search_path = public, extensions, auth, pg_catalog;
alter function public.touch_updated_at() set search_path = public, extensions, auth, pg_catalog;

commit;
