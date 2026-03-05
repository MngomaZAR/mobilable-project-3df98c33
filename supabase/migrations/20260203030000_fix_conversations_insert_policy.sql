-- Relax conversation insert policy for authenticated users
begin;

drop policy if exists conversations_insert_creator on public.conversations;
drop policy if exists conversations_insert_authenticated on public.conversations;

create policy conversations_insert_authenticated on public.conversations
  for insert with check (auth.uid() is not null);

commit;
