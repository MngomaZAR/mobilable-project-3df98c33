-- Storage bucket + policies for post images
begin;

insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do nothing;

drop policy if exists post_images_select_public on storage.objects;
drop policy if exists post_images_insert_auth on storage.objects;

create policy post_images_select_public on storage.objects
  for select using (bucket_id = 'post-images');

create policy post_images_insert_auth on storage.objects
  for insert with check (bucket_id = 'post-images' and auth.role() = 'authenticated');

commit;
