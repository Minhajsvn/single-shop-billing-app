-- Stage 2B tests: payment methods, payment rows, sync with payments. One transaction, always rolled back.
begin;

-- 1. Methods (Task 1).
do $$ begin
  assert 'transfer' = any(enum_range(null::public.payment_method)::text[]), '1a transfer method';
  assert 'split' = any(enum_range(null::public.payment_method)::text[]), '1b split summary';
end $$;

-- @task2

rollback;
