-- Stage 1H review fix: a trial end changed in Stripe reaches the shop. Staff are told "Change the trial end in Stripe"
-- for a trial with a card on file (Task 4), but subscription_changed never wrote trial_ends_at, so access kept the old
-- end and the daily billing check flagged trial_end every day. Now a subscription_changed event with status trialing
-- and a trialEnd sets trial_ends_at. Every other rule (stale check, canceled is final, other kinds) is unchanged.
-- The latest body (202610200027) is changed in place; the anchor must appear exactly once.
do $$
declare
  def text;
  anchor constant text := 'cancel_at = v_cancel_at,';
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'apply_billing_event') <> 1 then
    raise exception 'expected exactly one function named apply_billing_event';
  end if;
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'apply_billing_event';
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'expected exactly one subscription_changed cancel_at line in apply_billing_event';
  end if;
  def := replace(def, anchor, anchor || E'\n      trial_ends_at = case when v_status = ''trialing'' and p_event->>''trialEnd'' is not null'
    || E'\n        then (p_event->>''trialEnd'')::timestamptz else trial_ends_at end,');
  execute def;
end
$$;
