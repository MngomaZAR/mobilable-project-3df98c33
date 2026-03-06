-- Harden chat access so users only see/send messages in conversations they participate in.
begin;

-- Conversations: readable only if user is a participant or creator.
drop policy if exists conversations_select_authenticated on public.conversations;
create policy conversations_select_participant_or_creator on public.conversations
  for select using (
    auth.uid() is not null
    and (
      auth.uid() = created_by
      or exists (
        select 1
        from public.conversation_participants cp
        where cp.conversation_id = conversations.id
          and cp.user_id = auth.uid()
      )
    )
  );

-- Keep insert constrained to creator.
drop policy if exists conversations_insert_creator on public.conversations;
create policy conversations_insert_creator on public.conversations
  for insert with check (auth.uid() = created_by);

-- Update/delete only by creator.
drop policy if exists conversations_update_creator on public.conversations;
create policy conversations_update_creator on public.conversations
  for update using (auth.uid() = created_by);

drop policy if exists conversations_delete_creator on public.conversations;
create policy conversations_delete_creator on public.conversations
  for delete using (auth.uid() = created_by);

-- Messages: scoped to participant membership.
drop policy if exists messages_select_authenticated on public.messages;
create policy messages_select_participant on public.messages
  for select using (
    exists (
      select 1
      from public.conversation_participants cp
      where cp.conversation_id = messages.chat_id
        and cp.user_id = auth.uid()
    )
  );

drop policy if exists messages_insert_self on public.messages;
create policy messages_insert_self_participant on public.messages
  for insert with check (
    auth.uid() = sender_id
    and exists (
      select 1
      from public.conversation_participants cp
      where cp.conversation_id = messages.chat_id
        and cp.user_id = auth.uid()
    )
  );

drop policy if exists messages_delete_self on public.messages;
create policy messages_delete_self_participant on public.messages
  for delete using (
    auth.uid() = sender_id
    and exists (
      select 1
      from public.conversation_participants cp
      where cp.conversation_id = messages.chat_id
        and cp.user_id = auth.uid()
    )
  );

-- Participants table: users can only view/manage rows tied to themselves.
alter table public.conversation_participants enable row level security;

drop policy if exists participants_select_own on public.conversation_participants;
create policy participants_select_own on public.conversation_participants
  for select using (auth.uid() = user_id or auth.role() = 'service_role');

drop policy if exists participants_insert_by_self_or_admin on public.conversation_participants;
create policy participants_insert_by_self_or_admin on public.conversation_participants
  for insert with check (auth.uid() = user_id or auth.role() = 'service_role');

drop policy if exists participants_delete_own on public.conversation_participants;
create policy participants_delete_own on public.conversation_participants
  for delete using (auth.uid() = user_id or auth.role() = 'service_role');

commit;

