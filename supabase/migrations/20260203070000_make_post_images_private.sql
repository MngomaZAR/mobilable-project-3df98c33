begin;

update storage.buckets
set public = false
where id = 'post-images';

drop policy if exists post_images_select_public on storage.objects;
drop policy if exists post_images_select_auth on storage.objects;
create policy post_images_select_auth
  on storage.objects
  for select
  using (bucket_id = 'post-images' and auth.role() = 'authenticated');

commit;
