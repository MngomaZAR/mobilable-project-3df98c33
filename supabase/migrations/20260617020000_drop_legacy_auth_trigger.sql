-- Remove a legacy auth bootstrap trigger that is still attached in the live database.
-- The app now uses app_private.handle_new_user() for profile bootstrapping.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user_social();
