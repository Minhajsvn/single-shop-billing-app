-- Stage 1F: every active member reads their shop's tills, so a cashier can pick this browser's till
-- and the till choice / paused-till screens work for them. Writes stay owner only
-- ("owners manage their devices"); has_role ranks roles, so managers and owners pass too.
-- Branch names (joined by the snapshot) are already readable by members ("members read branches").
create policy "members read devices" on public.devices for select using (public.has_role(business_id, 'cashier'));
