-- Stage 1H: the admin functions write audit_events rows (action 'admin.*') with staff notes, staff ids,
-- before/after values and Stripe values. Shop owners keep reading their own shop's audit rows, but never the
-- admin ones; staff read those through the service role, which bypasses RLS.
drop policy "owners read audit events" on public.audit_events;
create policy "owners read audit events" on public.audit_events for select
  using (public.owns_business(business_id) and action not like 'admin.%');
