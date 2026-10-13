-- Sync RPCs call pgcrypto digest(), which Supabase installs in schema "extensions"; add it to their search_path.
alter function public.apply_customer_sync(uuid, uuid, uuid, jsonb) set search_path = public, extensions, pg_temp;
alter function public.apply_sale_sync(uuid, uuid, uuid, jsonb) set search_path = public, extensions, pg_temp;
alter function public.apply_register_sync(uuid, uuid, uuid, jsonb) set search_path = public, extensions, pg_temp;
alter function public.apply_credit_note_sync(uuid, uuid, uuid, jsonb) set search_path = public, extensions, pg_temp;
alter function public.apply_stock_sync(uuid, uuid, uuid, jsonb) set search_path = public, extensions, pg_temp;
