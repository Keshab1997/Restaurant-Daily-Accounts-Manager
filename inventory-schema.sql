-- Inventory v1. Run manually in the Supabase SQL editor after review. Not run by the app.
create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  start_date date not null,
  initial_opening numeric not null check (initial_opening between 0 and 1000000000),
  unique (user_id, id), unique (user_id, name)
);
create table public.inventory_entries (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null, day date not null,
  purchase numeric not null default 0 check (purchase between 0 and 1000000000),
  damage numeric not null default 0 check (damage between 0 and 1000000000),
  primary key (user_id, item_id, day),
  foreign key (user_id, item_id) references public.inventory_items(user_id, id) on delete cascade
);
create table public.inventory_mappings (
  user_id uuid not null references auth.users(id) on delete cascade,
  dish_key text not null check (length(dish_key) between 1 and 2000),
  item_id uuid, ignored boolean not null default false,
  primary key (user_id, dish_key),
  foreign key (user_id, item_id) references public.inventory_items(user_id, id),
  check ((ignored and item_id is null) or (not ignored and item_id is not null))
);
create table public.inventory_imports (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  sales jsonb not null check (jsonb_typeof(sales) = 'object'),
  primary key (user_id, day)
);
alter table public.inventory_items enable row level security;
alter table public.inventory_entries enable row level security;
alter table public.inventory_mappings enable row level security;
alter table public.inventory_imports enable row level security;
create policy inventory_items_owner on public.inventory_items for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy inventory_entries_owner on public.inventory_entries for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy inventory_mappings_owner on public.inventory_mappings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Imports can be read directly, but written only via the validated, atomic function below.
create policy inventory_imports_read on public.inventory_imports for select to authenticated using (user_id = auth.uid());

create or replace function public.inventory_save_import(p_day date, p_fingerprint text, p_sales jsonb, p_expected text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); current_hash text; k text; v jsonb;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if p_day is null or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' or p_sales is null or jsonb_typeof(p_sales) <> 'object' then
    raise exception 'Invalid import';
  end if;
  for k, v in select key, value from jsonb_each(p_sales) loop
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 0 or (v #>> '{}')::numeric > 1000000000 then raise exception 'Invalid sale quantity'; end if;
    if not exists (select 1 from public.inventory_items where user_id = uid and id::text = k and start_date <= p_day) then raise exception 'Unknown item or import before item start date'; end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':' || p_day::text, 0));
  select fingerprint into current_hash from public.inventory_imports where user_id = uid and day = p_day;
  if current_hash = p_fingerprint then return 'duplicate'; end if;
  if current_hash is distinct from p_expected then raise exception 'Import changed since preview; reload and preview again'; end if;
  insert into public.inventory_imports(user_id, day, fingerprint, sales) values(uid, p_day, p_fingerprint, p_sales)
    on conflict (user_id, day) do update set fingerprint = excluded.fingerprint, sales = excluded.sales;
  return 'saved';
end $$;
revoke all on function public.inventory_save_import(date, text, jsonb, text) from public;
grant execute on function public.inventory_save_import(date, text, jsonb, text) to authenticated;
