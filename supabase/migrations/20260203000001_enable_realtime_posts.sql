-- Enable Realtime for the posts table so the feed updates live
alter publication supabase_realtime add table public.posts;
