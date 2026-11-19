-- Additive migration for recoverable daily inventory corrections and atomic locking.
-- Review and run manually in the Supabase SQL editor after inventory-schema.sql. Not run by the app.

create table if not exists public.inventory_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  scope text not null check (scope in ('sales_only', 'whole_day')),
  created_at timestamptz not null default now(),
  restored_at timestamptz,
  import_snapshot jsonb,
  entries_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(entries_snapshot) = 'array'),
  client_request_id text check (client_request_id is null or length(trim(client_request_id)) between 1 and 128),
  unique (user_id, client_request_id),
  check (import_snapshot is null or jsonb_typeof(import_snapshot) = 'object'),
  check (
    (scope = 'sales_only' and import_snapshot is not null and jsonb_array_length(entries_snapshot) = 0)
    or
    (scope = 'whole_day' and (import_snapshot is not null or jsonb_array_length(entries_snapshot) > 0))
  )
);

create index if not exists inventory_corrections_user_day_idx
  on public.inventory_corrections (user_id, day desc, created_at desc);

alter table public.inventory_corrections enable row level security;

drop policy if exists inventory_corrections_read on public.inventory_corrections;
create policy inventory_corrections_read on public.inventory_corrections
  for select to authenticated using (user_id = auth.uid());

-- Restrict direct client writes on inventory_entries so movement saves, day clears,
-- restores, and POS imports serialize on the same server advisory lock and CAS checks.
drop policy if exists inventory_entries_owner on public.inventory_entries;
drop policy if exists inventory_entries_read on public.inventory_entries;
create policy inventory_entries_read on public.inventory_entries
  for select to authenticated using (user_id = auth.uid());

revoke all on table public.inventory_corrections from anon, public;
grant select on table public.inventory_corrections to authenticated;

create or replace function public.inventory_save_entry(
  p_item_id uuid,
  p_day date,
  p_purchase numeric,
  p_damage numeric,
  p_expected_exists boolean default null,
  p_expected_purchase numeric default 0,
  p_expected_damage numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  v_row public.inventory_entries%rowtype;
  v_exists boolean;
  v_cur_purchase numeric;
  v_cur_damage numeric;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;
  if p_item_id is null or p_day is null then
    raise exception 'Item and date are required';
  end if;
  if p_purchase is null or p_purchase < 0 or p_purchase > 1000000000
     or p_damage is null or p_damage < 0 or p_damage > 1000000000 then
    raise exception 'Purchase and damage must be between 0 and 1000000000';
  end if;
  if not exists (
    select 1 from public.inventory_items
    where user_id = uid and id = p_item_id and start_date <= p_day
  ) then
    raise exception 'Stock item not found or starts after this date';
  end if;

  -- Lock strictly per (user_id, day) matching inventory_save_import, clear, and restore.
  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':' || p_day::text, 0));

  select * into v_row
  from public.inventory_entries
  where user_id = uid and item_id = p_item_id and day = p_day;

  v_exists := found;
  v_cur_purchase := case when v_exists then v_row.purchase else 0 end;
  v_cur_damage := case when v_exists then v_row.damage else 0 end;

  if (p_expected_exists is not null and v_exists is distinct from p_expected_exists)
     or v_cur_purchase is distinct from coalesce(p_expected_purchase, 0)
     or v_cur_damage is distinct from coalesce(p_expected_damage, 0) then
    return jsonb_build_object(
      'status', 'conflict',
      'exists', v_exists,
      'purchase', v_cur_purchase,
      'damage', v_cur_damage
    );
  end if;

  insert into public.inventory_entries(user_id, item_id, day, purchase, damage)
  values (uid, p_item_id, p_day, p_purchase, p_damage)
  on conflict (user_id, item_id, day) do update
    set purchase = excluded.purchase,
        damage = excluded.damage;

  return jsonb_build_object(
    'status', 'saved',
    'exists', true,
    'purchase', p_purchase,
    'damage', p_damage
  );
end $$;

create or replace function public.inventory_clear_day(
  p_day date,
  p_scope text,
  p_expected_fingerprint text default null,
  p_expected_entries jsonb default '[]'::jsonb,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  v_existing_corr public.inventory_corrections%rowtype;
  v_import public.inventory_imports%rowtype;
  v_has_import boolean := false;
  v_import_snap jsonb := null;
  v_entries_snap jsonb := '[]'::jsonb;
  v_entries_mismatch boolean := false;
  v_expected_total int := 0;
  v_expected_distinct int := 0;
  v_corr_id uuid;
  v_created_at timestamptz;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;
  if p_day is null or p_scope not in ('sales_only', 'whole_day') then
    raise exception 'Invalid clear request';
  end if;
  if p_expected_entries is null or jsonb_typeof(p_expected_entries) <> 'array' then
    raise exception 'Expected entries list must be a JSON array';
  end if;
  if p_request_id is not null and length(trim(p_request_id)) not between 1 and 128 then
    raise exception 'Invalid request id';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':' || p_day::text, 0));

  if p_request_id is not null then
    select * into v_existing_corr
    from public.inventory_corrections
    where user_id = uid and client_request_id = p_request_id;
    if found then
      if v_existing_corr.day <> p_day or v_existing_corr.scope <> p_scope then
        raise exception 'Request ID already used for a different day or scope';
      end if;
      return jsonb_build_object(
        'status', 'duplicate_request',
        'correction_id', v_existing_corr.id,
        'day', v_existing_corr.day,
        'scope', v_existing_corr.scope,
        'created_at', v_existing_corr.created_at,
        'import_count', case when v_existing_corr.import_snapshot is not null then 1 else 0 end,
        'entry_count', jsonb_array_length(v_existing_corr.entries_snapshot)
      );
    end if;
  end if;

  select * into v_import
  from public.inventory_imports
  where user_id = uid and day = p_day;
  v_has_import := found;

  if (case when v_has_import then v_import.fingerprint else null end) is distinct from p_expected_fingerprint then
    return jsonb_build_object(
      'status', 'conflict',
      'reason', 'Imported sales on the server changed since this page loaded. Refresh and review before clearing.'
    );
  end if;

  if p_scope = 'sales_only' then
    if not v_has_import then
      return jsonb_build_object(
        'status', 'empty',
        'reason', 'No imported sales exist for this date.'
      );
    end if;
    v_import_snap := jsonb_build_object('fingerprint', v_import.fingerprint, 'sales', v_import.sales);
    v_entries_snap := '[]'::jsonb;
  else
    select count(*), count(distinct (x->>'item_id')::uuid)
    into v_expected_total, v_expected_distinct
    from jsonb_array_elements(p_expected_entries) x;

    if v_expected_total <> v_expected_distinct then
      raise exception 'Duplicate item_id in expected entries';
    end if;

    with cur as (
      select item_id, purchase, damage
      from public.inventory_entries
      where user_id = uid and day = p_day
    ),
    exp as (
      select (x->>'item_id')::uuid as item_id,
             (x->>'purchase')::numeric as purchase,
             (x->>'damage')::numeric as damage
      from jsonb_array_elements(p_expected_entries) x
    )
    select exists (
      select 1
      from cur
      full outer join exp using (item_id)
      where cur.item_id is null
         or exp.item_id is null
         or exp.purchase is null
         or exp.damage is null
         or cur.purchase is distinct from exp.purchase
         or cur.damage is distinct from exp.damage
    )
    into v_entries_mismatch;

    if v_entries_mismatch then
      return jsonb_build_object(
        'status', 'conflict',
        'reason', 'Stock movements on the server changed since this page loaded. Refresh and review before clearing.'
      );
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'item_id', e.item_id::text,
          'purchase', e.purchase,
          'damage', e.damage
        )
        order by e.item_id::text
      ),
      '[]'::jsonb
    )
    into v_entries_snap
    from public.inventory_entries e
    where e.user_id = uid and e.day = p_day;

    if not v_has_import and jsonb_array_length(v_entries_snap) = 0 then
      return jsonb_build_object(
        'status', 'empty',
        'reason', 'No saved stock movements or imported sales exist for this date.'
      );
    end if;

    if v_has_import then
      v_import_snap := jsonb_build_object('fingerprint', v_import.fingerprint, 'sales', v_import.sales);
    end if;
  end if;

  -- Record recoverable snapshot first, then delete scoped rows atomically.
  insert into public.inventory_corrections(
    user_id, day, scope, import_snapshot, entries_snapshot, client_request_id
  )
  values (
    uid, p_day, p_scope, v_import_snap, v_entries_snap, p_request_id
  )
  returning id, created_at into v_corr_id, v_created_at;

  if v_has_import then
    delete from public.inventory_imports where user_id = uid and day = p_day;
  end if;
  if p_scope = 'whole_day' then
    delete from public.inventory_entries where user_id = uid and day = p_day;
  end if;

  return jsonb_build_object(
    'status', 'cleared',
    'correction_id', v_corr_id,
    'day', p_day,
    'scope', p_scope,
    'created_at', v_created_at,
    'import_count', case when v_import_snap is not null then 1 else 0 end,
    'entry_count', jsonb_array_length(v_entries_snap)
  );
end $$;

create or replace function public.inventory_restore_correction(p_correction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  v_day date;
  v_corr public.inventory_corrections%rowtype;
  v_conflict_entries int := 0;
  v_invalid_items int := 0;
  v_fp text;
  v_sales jsonb;
  k text;
  v jsonb;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;
  if p_correction_id is null then
    raise exception 'Snapshot ID is required';
  end if;

  select day into v_day
  from public.inventory_corrections
  where id = p_correction_id and user_id = uid;
  if not found then
    raise exception 'Recovery snapshot not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':' || v_day::text, 0));

  select * into v_corr
  from public.inventory_corrections
  where id = p_correction_id and user_id = uid
  for update;
  if not found then
    raise exception 'Recovery snapshot not found';
  end if;

  if v_corr.restored_at is not null then
    return jsonb_build_object(
      'status', 'already_restored',
      'correction_id', v_corr.id,
      'day', v_corr.day,
      'restored_at', v_corr.restored_at
    );
  end if;

  if v_corr.import_snapshot is not null then
    if exists (select 1 from public.inventory_imports where user_id = uid and day = v_corr.day) then
      return jsonb_build_object(
        'status', 'conflict',
        'reason', 'Imported sales already exist for this date; remove them before restoring this snapshot.'
      );
    end if;
    v_fp := v_corr.import_snapshot->>'fingerprint';
    v_sales := v_corr.import_snapshot->'sales';
    if v_fp is null or v_fp !~ '^[0-9a-f]{64}$' or v_sales is null or jsonb_typeof(v_sales) <> 'object' then
      raise exception 'Snapshot import data is invalid';
    end if;
    for k, v in select key, value from jsonb_each(v_sales) loop
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 0 or (v #>> '{}')::numeric > 1000000000 then
        raise exception 'Invalid sale quantity in snapshot';
      end if;
      if not exists (
        select 1 from public.inventory_items
        where user_id = uid and id::text = k and start_date <= v_corr.day
      ) then
        return jsonb_build_object(
          'status', 'conflict',
          'reason', 'A stock item referenced by this sales snapshot is missing or now starts after the snapshot date.'
        );
      end if;
    end loop;
  end if;

  if jsonb_array_length(v_corr.entries_snapshot) > 0 then
    select count(*) into v_conflict_entries
    from jsonb_array_elements(v_corr.entries_snapshot) x
    where exists (
      select 1 from public.inventory_entries e
      where e.user_id = uid
        and e.item_id = (x->>'item_id')::uuid
        and e.day = v_corr.day
    );
    if v_conflict_entries > 0 then
      return jsonb_build_object(
        'status', 'conflict',
        'reason', format('Cannot restore: %s stock movement slot(s) already contain saved entries for this date.', v_conflict_entries)
      );
    end if;

    select count(*) into v_invalid_items
    from jsonb_array_elements(v_corr.entries_snapshot) x
    where not exists (
      select 1 from public.inventory_items i
      where i.user_id = uid
        and i.id = (x->>'item_id')::uuid
        and i.start_date <= v_corr.day
    );
    if v_invalid_items > 0 then
      return jsonb_build_object(
        'status', 'conflict',
        'reason', 'Cannot restore: one or more stock items are missing or now start after the snapshot date.'
      );
    end if;
  end if;

  if v_corr.import_snapshot is not null then
    insert into public.inventory_imports(user_id, day, fingerprint, sales)
    values (uid, v_corr.day, v_fp, v_sales);
  end if;

  if jsonb_array_length(v_corr.entries_snapshot) > 0 then
    insert into public.inventory_entries(user_id, item_id, day, purchase, damage)
    select uid,
           (x->>'item_id')::uuid,
           v_corr.day,
           (x->>'purchase')::numeric,
           (x->>'damage')::numeric
    from jsonb_array_elements(v_corr.entries_snapshot) x;
  end if;

  update public.inventory_corrections
  set restored_at = now()
  where id = v_corr.id and user_id = uid;

  return jsonb_build_object(
    'status', 'restored',
    'correction_id', v_corr.id,
    'day', v_corr.day,
    'scope', v_corr.scope,
    'import_count', case when v_corr.import_snapshot is not null then 1 else 0 end,
    'entry_count', jsonb_array_length(v_corr.entries_snapshot)
  );
end $$;

revoke all on function public.inventory_save_entry(uuid, date, numeric, numeric, boolean, numeric, numeric) from anon, public;
grant execute on function public.inventory_save_entry(uuid, date, numeric, numeric, boolean, numeric, numeric) to authenticated;

revoke all on function public.inventory_clear_day(date, text, text, jsonb, text) from anon, public;
grant execute on function public.inventory_clear_day(date, text, text, jsonb, text) to authenticated;

revoke all on function public.inventory_restore_correction(uuid) from anon, public;
grant execute on function public.inventory_restore_correction(uuid) to authenticated;
