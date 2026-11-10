-- Founding 50 tests: seats claimed on the first real payment, the cap, ending on cancel, entitlements, revoke.
-- Runs inside one transaction and always rolls back.
begin;

-- Start from no founders so seat numbers are predictable (rolled back at the end).
delete from public.founding_members;

-- 0. The migration counts every shop that already pays (or paid) as charged, so none of them can claim a seat.
do $$
begin
  assert not exists (select 1 from public.subscriptions where status in ('active', 'past_due') and first_charged_at is null),
    '0 paying shops are backfilled as charged';
end $$;

-- A shop with its own owner. The business insert trigger gives it the usual Pro trial.
create function pg_temp.f50_shop(n integer) returns uuid language plpgsql as $$
declare
  owner uuid := ('00000000-0000-4000-8000-' || lpad(to_hex(5000 + n), 12, '0'))::uuid;
  biz uuid := ('b5000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values (owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f50-' || n || '@founding.test');
  insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
  values (biz, owner, 'Founding Shop ' || n || ' LLC', '100000000000003', 'Karama, Dubai', '+9715000' || lpad(n::text, 5, '0'));
  return biz;
end $$;

-- A billing event; `seconds` orders events (later = larger).
create function pg_temp.f50_event(event_id text, kind text, biz uuid, sub_id text, status text, seconds integer)
returns text language sql as $$
  select public.apply_billing_event(jsonb_build_object(
    'id', event_id, 'created', now() - interval '2 hours' + make_interval(secs => seconds), 'kind', kind,
    'businessId', biz, 'customerId', 'cus_' || sub_id, 'subscriptionId', sub_id, 'status', status,
    'trialEnd', null, 'currentPeriodEnd', now() + interval '30 days', 'cancelAt', null, 'interval', 'month'));
$$;

-- End a shop's trial so the next charge is a real payment.
create function pg_temp.f50_end_trial(biz uuid) returns void language sql as $$
  update public.subscriptions set trial_ends_at = now() - interval '1 minute' where business_id = biz;
$$;

-- 1. A trial checkout claims nothing; the first paid invoice after the trial claims seat 1.
do $$
declare
  biz uuid := pg_temp.f50_shop(1);
  m public.founding_members;
  r text;
begin
  r := pg_temp.f50_event('evt_f50_1_checkout', 'checkout_completed', biz, 'sub_f50_1', 'trialing', 1);
  assert r = 'applied', '1 checkout ' || r;
  assert not exists (select 1 from public.founding_members where business_id = biz), '1 trial checkout claims no seat';

  perform pg_temp.f50_end_trial(biz);
  r := pg_temp.f50_event('evt_f50_1_paid', 'invoice_paid', biz, 'sub_f50_1', 'active', 2);
  assert r = 'applied', '1 invoice ' || r;
  select * into m from public.founding_members where business_id = biz;
  assert m.seat_no = 1, '1 seat 1, got ' || coalesce(m.seat_no::text, 'none');
  assert m.ends_at = m.claimed_at + interval '12 months', '1 twelve months';
  assert m.billing_event_id = 'evt_f50_1_paid', '1 event id';
  assert m.ended_at is null and m.end_reason is null, '1 open';
  assert (select count(*) from public.audit_events where business_id = biz and action = 'founding.claim'
          and entity_id = m.id and summary->>'seatNo' = '1') = 1, '1 audit row';

  -- 1b. A redelivery is a duplicate and claims nothing more.
  r := pg_temp.f50_event('evt_f50_1_paid', 'invoice_paid', biz, 'sub_f50_1', 'active', 2);
  assert r = 'duplicate', '1b duplicate ' || r;
  -- 1c. Next month's payment claims nothing more.
  r := pg_temp.f50_event('evt_f50_1_paid_2', 'invoice_paid', biz, 'sub_f50_1', 'active', 3);
  assert r = 'applied', '1c ' || r;
  assert (select count(*) from public.founding_members where business_id = biz) = 1, '1c still one row';
  assert (select count(*) from public.audit_events where business_id = biz and action = 'founding.claim') = 1, '1c one audit row';
end $$;

-- 2. A checkout after the trial ran out is charged at once and claims a seat.
do $$
declare
  biz uuid := pg_temp.f50_shop(2);
begin
  perform pg_temp.f50_end_trial(biz);
  assert pg_temp.f50_event('evt_f50_2_checkout', 'checkout_completed', biz, 'sub_f50_2', 'active', 1) = 'applied', '2 applied';
  assert (select seat_no from public.founding_members where business_id = biz) = 2, '2 seat 2';
end $$;

-- 3. Past due keeps the benefit; cancel ends it; coming back never claims again.
do $$
declare
  biz uuid := 'b5000000-0000-4000-8000-000000000001';
  m public.founding_members;
begin
  assert pg_temp.f50_event('evt_f50_1_failed', 'payment_failed', biz, 'sub_f50_1', 'past_due', 10) = 'applied', '3 failed';
  assert (select ended_at is null from public.founding_members where business_id = biz), '3 past due keeps it';

  assert pg_temp.f50_event('evt_f50_1_deleted', 'subscription_deleted', biz, 'sub_f50_1', 'canceled', 11) = 'applied', '3 deleted';
  select * into m from public.founding_members where business_id = biz;
  assert m.end_reason = 'canceled', '3 canceled';
  assert m.ended_at = now() - interval '2 hours' + interval '11 seconds', '3 ended at event time';

  assert pg_temp.f50_event('evt_f50_1_back', 'checkout_completed', biz, 'sub_f50_1b', 'active', 12) = 'applied', '3 back';
  assert pg_temp.f50_event('evt_f50_1b_paid', 'invoice_paid', biz, 'sub_f50_1b', 'active', 13) = 'applied', '3 back paid';
  assert (select count(*) from public.founding_members where business_id = biz) = 1, '3 no second row';
  assert (select end_reason from public.founding_members where business_id = biz) = 'canceled', '3 still ended';
end $$;

-- 4. The cap holds: with room for 2 more, 3 shops pay and the third gets nothing.
do $$
declare
  taken integer := (select count(*) from public.founding_members where end_reason is distinct from 'revoked');
  biz uuid;
  i integer;
begin
  update public.founding_offer set seat_cap = taken + 2;
  for i in 3..5 loop
    biz := pg_temp.f50_shop(i);
    perform pg_temp.f50_end_trial(biz);
    assert pg_temp.f50_event('evt_f50_' || i || '_paid', 'checkout_completed', biz, 'sub_f50_' || i, 'active', 1) = 'applied', '4 applied ' || i;
  end loop;
  assert (select count(*) from public.founding_members where end_reason is distinct from 'revoked') = taken + 2, '4 cap reached';
  assert exists (select 1 from public.founding_members where business_id = 'b5000000-0000-4000-8000-000000000004'), '4 shop 4 got one';
  assert not exists (select 1 from public.founding_members where business_id = 'b5000000-0000-4000-8000-000000000005'), '4 shop 5 got none';
  assert public.claim_founding_seat('b5000000-0000-4000-8000-000000000005', 'evt_manual') is null, '4 claim returns null when full';
  assert (select array_agg(seat_no order by seat_no) from public.founding_members) = array[1, 2, 3, 4], '4 seats 1..4';
end $$;

-- 5. Entitlements: a founder gets Pro features and limits on Starter billing.
do $$
declare
  founder_biz constant uuid := 'b5000000-0000-4000-8000-000000000002';
  plain_biz constant uuid := 'b5000000-0000-4000-8000-000000000005';
  ended_biz constant uuid := 'b5000000-0000-4000-8000-000000000001';
  e jsonb;
  m public.founding_members;
begin
  select * into m from public.founding_members where business_id = founder_biz;
  e := public.entitlements_internal(founder_biz);
  assert e->>'planId' = 'starter', '5 plan stays starter';
  assert e->'features' = to_jsonb(array(select unnest(features) as f from public.plan_catalog where id = 'pro' order by f)), '5 pro features ' || (e->'features')::text;
  assert (e->'limits'->>'tills')::int = 2 and (e->'limits'->>'members')::int = 5 and e->'limits'->'products' = 'null'::jsonb, '5 pro limits ' || (e->'limits')::text;
  assert (e->'founder'->>'seatNo')::int = 2 and (e->'founder'->>'endsAt')::timestamptz = m.ends_at, '5 founder key ' || coalesce((e->'founder')::text, 'missing');

  e := public.entitlements_internal(plain_biz);
  assert e->'features' = '[]'::jsonb and (e->'limits'->>'tills')::int = 1 and e->'founder' = 'null'::jsonb, '5 non-founder is starter ' || e::text;

  e := public.entitlements_internal(founder_biz, m.ends_at + interval '1 second');
  assert e->'features' = '[]'::jsonb and (e->'limits'->>'tills')::int = 1 and e->'founder' = 'null'::jsonb, '5 expired founder is starter';

  e := public.entitlements_internal(ended_biz);
  assert e->'founder' = 'null'::jsonb and e->'features' = '[]'::jsonb, '5 cancelled founder is starter';

  update public.subscriptions set addon_tills = 1 where business_id = founder_biz;
  assert (public.entitlements_internal(founder_biz)->'limits'->>'tills')::int = 3, '5 add-on stacks on founder';
  update public.subscriptions set addon_tills = 0 where business_id = founder_biz;

  insert into public.plan_grants (business_id, plan_id, granted_by, note)
  values (founder_biz, 'business', (select owner_id from public.businesses where id = founder_biz), 'test grant');
  e := public.entitlements_internal(founder_biz);
  assert e->>'planId' = 'business' and e->'founder' = 'null'::jsonb, '5 grant hides founder ' || e::text;
  delete from public.plan_grants where business_id = founder_biz;

  assert public.entitlements_internal('b5000000-0000-4000-8000-0000000000ff')->'founder' = 'null'::jsonb, '5 no subscription has founder null';
end $$;

-- 6. The public flag flips at the cap; anon may call it but cannot read the tables.
do $$
begin
  assert not public.founding_offer_open(), '6 full';
  update public.founding_offer set seat_cap = seat_cap + 1;
  assert public.founding_offer_open(), '6 open again';
end $$;
set local role anon;
do $$
begin
  assert public.founding_offer_open(), '6 anon calls it';
  begin
    perform 1 from public.founding_members;
    assert false, '6 anon read founding_members';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.founding_offer;
    assert false, '6 anon read founding_offer';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
update public.founding_offer set seat_cap = seat_cap - 1;

-- 7. Staff revoke: frees the seat for the next payer; refused twice or for a non-founder; never reclaimed.
do $$
declare
  staff constant uuid := '00000000-0000-4000-8000-000000001389'; -- owner of shop 1, standing in for platform staff
  revoked_biz constant uuid := 'b5000000-0000-4000-8000-000000000002';
  m public.founding_members;
  biz uuid;
begin
  assert not public.founding_offer_open(), '7 full before';
  perform public.admin_revoke_founding_seat(revoked_biz, staff, '  fraud check  ');
  select * into m from public.founding_members where business_id = revoked_biz;
  assert m.end_reason = 'revoked' and m.ended_at is not null and m.revoked_by = staff and m.revoke_note = 'fraud check', '7 revoked row';
  assert (select count(*) from public.audit_events where business_id = revoked_biz and action = 'admin.revoke_founding_seat'
          and actor_id = staff and summary->>'note' = 'fraud check') = 1, '7 audit row';
  assert public.founding_offer_open(), '7 open after revoke';
  assert public.entitlements_internal(revoked_biz)->'founder' = 'null'::jsonb, '7 revoked shop has no founder';

  begin
    perform public.admin_revoke_founding_seat(revoked_biz, staff, 'again');
    assert false, '7 second revoke allowed';
  exception when sqlstate 'P0001' then assert sqlerrm = 'not_a_founder', '7 second revoke code ' || sqlerrm;
  end;
  begin
    perform public.admin_revoke_founding_seat('b5000000-0000-4000-8000-000000000005', staff, 'not one');
    assert false, '7 non-founder revoke allowed';
  exception when sqlstate 'P0001' then assert sqlerrm = 'not_a_founder', '7 non-founder code ' || sqlerrm;
  end;
  begin
    perform public.admin_revoke_founding_seat('b5000000-0000-4000-8000-0000000000ff', staff, 'gone');
    assert false, '7 missing shop allowed';
  exception when sqlstate 'P0001' then assert sqlerrm = 'shop_not_found', '7 missing shop code ' || sqlerrm;
  end;
  begin
    perform public.admin_revoke_founding_seat('b5000000-0000-4000-8000-000000000003', staff, '   ');
    assert false, '7 empty note allowed';
  exception when sqlstate 'P0001' then assert sqlerrm = 'note_required', '7 note code ' || sqlerrm;
  end;

  -- The revoked shop pays again: no new record.
  assert pg_temp.f50_event('evt_f50_2_paid_again', 'invoice_paid', revoked_biz, 'sub_f50_2', 'active', 20) = 'applied', '7 paid again';
  assert (select count(*) from public.founding_members where business_id = revoked_biz) = 1, '7 never reclaimed';

  -- The next new payer takes the freed seat 2.
  biz := pg_temp.f50_shop(6);
  perform pg_temp.f50_end_trial(biz);
  assert pg_temp.f50_event('evt_f50_6_paid', 'checkout_completed', biz, 'sub_f50_6', 'active', 1) = 'applied', '7 shop 6';
  assert (select seat_no from public.founding_members where business_id = biz) = 2, '7 shop 6 gets seat 2';

  -- Revoking a cancelled founder is allowed and frees its seat.
  perform public.admin_revoke_founding_seat('b5000000-0000-4000-8000-000000000001', staff, 'cleanup');
  assert public.founding_offer_open(), '7 cancelled seat freed';
end $$;

-- 8. Only the first charge claims: a shop that paid while the offer was full does not take a freed seat at renewal.
do $$
declare
  late_payer constant uuid := 'b5000000-0000-4000-8000-000000000005';
begin
  assert public.founding_offer_open(), '8 a seat is free';
  assert (select first_charged_at is not null from public.subscriptions where business_id = late_payer), '8 first charge stamped while full';
  assert pg_temp.f50_event('evt_f50_5_renewal', 'invoice_paid', late_payer, 'sub_f50_5', 'active', 30) = 'applied', '8 renewal';
  assert not exists (select 1 from public.founding_members where business_id = late_payer), '8 renewal claims nothing';
end $$;

-- 9. A trial-card checkout that arrives after the trial ended makes the shop active but is no charge: no seat until
--    the first charge succeeds.
do $$
declare
  biz uuid := pg_temp.f50_shop(7);
begin
  perform pg_temp.f50_end_trial(biz);
  assert pg_temp.f50_event('evt_f50_7_card', 'checkout_completed', biz, 'sub_f50_7', 'trialing', 1) = 'applied', '9 late card';
  assert (select status = 'active' from public.subscriptions where business_id = biz), '9 shop active';
  assert not exists (select 1 from public.founding_members where business_id = biz), '9 no seat without a charge';
  assert (select first_charged_at is null from public.subscriptions where business_id = biz), '9 not charged yet';
  assert pg_temp.f50_event('evt_f50_7_charged', 'invoice_paid', biz, 'sub_f50_7', 'active', 2) = 'applied', '9 charged';
  assert exists (select 1 from public.founding_members where business_id = biz), '9 first charge claims';
end $$;

rollback;
