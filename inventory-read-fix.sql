-- Inventory read fix. Run manually in the Supabase SQL editor after review. Not run by the app.
-- Symptom this fixes: POS sales save without any error, but the Sale column stays 0 and the
-- Corrections tab reports "No imported sales" for a day that was imported.
-- Cause: inventory_save_import is security definer, so it can write even when the authenticated
-- role cannot read inventory_imports back. Reading needs both a grant and a select policy.

grant select on public.inventory_imports to authenticated;
grant select, insert, update, delete on public.inventory_entries to authenticated;
grant select, insert, update, delete on public.inventory_items to authenticated;
grant select, insert, update, delete on public.inventory_mappings to authenticated;
grant select on public.inventory_corrections to authenticated;

alter table public.inventory_imports enable row level security;

drop policy if exists inventory_imports_read on public.inventory_imports;
create policy inventory_imports_read on public.inventory_imports
  for select to authenticated using (user_id = auth.uid());

-- Keep the write path on the validated, advisory-locked function only.
revoke insert, update, delete on public.inventory_imports from authenticated;

-- Verify (should return one row per imported day for the signed-in user):
-- select day, fingerprint, jsonb_object_keys(sales) as item_id, sales from public.inventory_imports
--  where user_id = auth.uid() order by day desc limit 20;
