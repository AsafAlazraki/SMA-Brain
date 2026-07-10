-- S1: auth & roles — auto-create a profile for every new auth user.
-- Role comes from raw_app_meta_data.role, which only the service role can set
-- (users can edit their own user_metadata, so it must never carry the role).
-- plpgsql + security definer: runs as the migration owner so the auth-admin
-- role that fires the trigger doesn't need grants on public.profiles.

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, role, display_name)
  values (
    new.id,
    case when new.raw_app_meta_data->>'role' in ('admin','staff')
         then new.raw_app_meta_data->>'role' else 'staff' end,
    coalesce(
      nullif(new.raw_user_meta_data->>'display_name', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    )
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Tighten learning-queue provenance: staff proposals must be attributed to their
-- own account (0001's policy let any authenticated user write any created_by).
-- Server-side capture paths use the service role and are unaffected.
drop policy "queue: staff propose" on learning_queue;
create policy "queue: staff propose" on learning_queue for insert
  with check (auth.uid() is not null and created_by = auth.uid());

-- Backfill profiles for any users created before this trigger existed.
insert into public.profiles (user_id, role, display_name)
select
  u.id,
  case when u.raw_app_meta_data->>'role' in ('admin','staff')
       then u.raw_app_meta_data->>'role' else 'staff' end,
  coalesce(
    nullif(u.raw_user_meta_data->>'display_name', ''),
    split_part(coalesce(u.email, ''), '@', 1)
  )
from auth.users u
left join public.profiles p on p.user_id = u.id
where p.user_id is null;
