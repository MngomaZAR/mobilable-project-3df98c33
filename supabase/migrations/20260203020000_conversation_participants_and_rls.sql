-- Secure conversations/messages with participants and optional booking linkage
begin;

alter table public.conversations
  add column if not exists booking_id uuid references public.bookings(id) on delete set null;

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text,
  last_read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table public.conversation_participants enable row level security;

drop policy if exists conversation_participants_select_self on public.conversation_participants;
drop policy if exists conversation_participants_insert_creator on public.conversation_participants;
drop policy if exists conversation_participants_update_self on public.conversation_participants;

-- Participants can see their own rows
create policy conversation_participants_select_self on public.conversation_participants
  for select using (auth.uid() = user_id);

-- Creator can add participants (including other users)
create policy conversation_participants_insert_creator on public.conversation_participants
  for insert with check (
    auth.uid() = user_id
    or exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and c.created_by = auth.uid()
    )
  );

create policy conversation_participants_update_self on public.conversation_participants
  for update using (auth.uid() = user_id);

-- Tighten conversations visibility to participants
drop policy if exists conversations_select_authenticated on public.conversations;
drop policy if exists conversations_select_participants on public.conversations;
create policy conversations_select_participants on public.conversations
  for select using (
    exists (
      select 1 from public.conversation_participants p
      where p.conversation_id = id
        and p.user_id = auth.uid()
    )
  );

-- Keep insert/update/delete to creator
drop policy if exists conversations_insert_creator on public.conversations;
drop policy if exists conversations_update_creator on public.conversations;
drop policy if exists conversations_delete_creator on public.conversations;
create policy conversations_insert_creator on public.conversations
  for insert with check (auth.uid() = created_by or created_by is null);
create policy conversations_update_creator on public.conversations
  for update using (auth.uid() = created_by);
create policy conversations_delete_creator on public.conversations
  for delete using (auth.uid() = created_by);

-- Messages readable only by participants, insertable only by participants
drop policy if exists messages_select_authenticated on public.messages;
drop policy if exists messages_insert_self on public.messages;
drop policy if exists messages_delete_self on public.messages;
drop policy if exists messages_select_participants on public.messages;
drop policy if exists messages_insert_participants on public.messages;
drop policy if exists messages_delete_self on public.messages;

create policy messages_select_participants on public.messages
  for select using (
    exists (
      select 1 from public.conversation_participants p
      where p.conversation_id = messages.chat_id
        and p.user_id = auth.uid()
    )
  );

create policy messages_insert_participants on public.messages
  for insert with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.conversation_participants p
      where p.conversation_id = messages.chat_id
        and p.user_id = auth.uid()
    )
  );

create policy messages_delete_self on public.messages
  for delete using (auth.uid() = sender_id);

commit;
