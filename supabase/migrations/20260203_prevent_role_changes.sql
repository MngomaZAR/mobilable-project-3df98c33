-- Prevent non-admins from changing a user's role in profiles
create or replace function public.prevent_role_change()
returns trigger language plpgsql as $$
begin
  -- Only run on updates
  if (tg_op = 'UPDATE') then
    -- If the role field is being changed
    if (OLD.role is distinct from NEW.role) then
      -- Allow change only if the acting user is an admin
      if not exists (
        select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
      ) then
        raise exception 'Only an administrator may change user roles.';
      end if;
    end if;
  end if;
  return NEW;
end;
$$;

-- Attach trigger to profiles table if not already present
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'profiles_prevent_role_change') then
    create trigger profiles_prevent_role_change
      before update on public.profiles
      for each row
      execute function public.prevent_role_change();
  end if;
end $$;
