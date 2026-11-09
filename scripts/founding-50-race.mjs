// Founding 50 concurrency check, LOCAL Supabase only: 60 shops make their first payment at the same moment and
// exactly the free seats are taken, each with its own seat number. Everything it creates is deleted afterwards.
import postgres from "postgres";

const url = process.env.SUPABASE_TEST_DB_URL;
if (!url || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("SUPABASE_TEST_DB_URL must point at local Supabase (127.0.0.1 or localhost). Refusing to run.");
  process.exit(2);
}

const PAYERS = 60;
const tag = `race${Date.now()}`;
const sql = postgres(url, { max: PAYERS, onnotice: () => {} });
const shops = Array.from({ length: PAYERS }, (_, i) => ({ owner: crypto.randomUUID(), biz: crypto.randomUUID(), sub: `sub_${tag}_${i}` }));
const bizIds = shops.map((s) => s.biz);
let failed = false;

try {
  for (const [i, s] of shops.entries()) {
    await sql`insert into auth.users (id, instance_id, aud, role, email)
      values (${s.owner}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${`${tag}-${i}@founding.test`})`;
    await sql`insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
      values (${s.biz}, ${s.owner}, ${`Race Shop ${i} LLC`}, '100000000000003', 'Karama, Dubai', ${`+97150${String(i).padStart(7, "0")}`})`;
    await sql`update public.subscriptions set trial_ends_at = now() - interval '1 minute',
      billing_subscription_id = ${s.sub}, billing_customer_id = ${`cus_${s.sub}`}, has_payment_method = true
      where business_id = ${s.biz}`;
  }

  const [{ cap }] = await sql`select seat_cap as cap from public.founding_offer`;
  const [{ taken }] = await sql`select count(*)::int as taken from public.founding_members where end_reason is distinct from 'revoked'`;
  const expected = Math.max(0, Math.min(PAYERS, cap - taken));

  const created = new Date().toISOString();
  // allSettled, not all: every payment must finish before the counts and the clean-up run.
  const results = await Promise.allSettled(shops.map((s, i) => sql`select public.apply_billing_event(${sql.json({
    id: `evt_${tag}_${i}`, created, kind: "invoice_paid", businessId: s.biz, customerId: `cus_${s.sub}`,
    subscriptionId: s.sub, status: "active", trialEnd: null, currentPeriodEnd: null, cancelAt: null, interval: "month",
  })}) as result`));
  const errors = results.filter((r) => r.status === "rejected").map((r) => r.reason.message);
  const notApplied = results.filter((r) => r.status === "fulfilled" && r.value[0].result !== "applied").length;

  const rows = await sql`select seat_no from public.founding_members where business_id = any(${bizIds}::uuid[])`;
  const [{ total }] = await sql`select count(*)::int as total from public.founding_members where end_reason is distinct from 'revoked'`;
  const seats = rows.map((r) => r.seat_no);
  const problems = [];
  if (errors.length) problems.push(`${errors.length} payments failed: ${[...new Set(errors)].join(" | ")}`);
  if (notApplied) problems.push(`${notApplied} events not applied`);
  if (rows.length !== expected) problems.push(`${rows.length} seats claimed, expected ${expected}`);
  if (new Set(seats).size !== seats.length) problems.push("duplicate seat numbers");
  if (total > cap) problems.push(`${total} seats taken, cap ${cap}`);
  if (problems.length) {
    failed = true;
    console.error(`FAIL founding race: ${problems.join("; ")}`);
  } else {
    console.log(`PASS founding race: ${rows.length} seats, ${PAYERS} payers (cap ${cap}, ${taken} taken before)`);
  }
} catch (error) {
  failed = true;
  console.error(`FAIL founding race: ${error.message}`);
} finally {
  await cleanUp(sql, bizIds, shops.map((s) => s.owner), tag);
  await sql.end();
}
process.exit(failed ? 1 : 0);

// Deletes what this run made: the rows a new shop gets (business_id references are `on delete restrict`), then the
// shops and their owners. Tables are cleared child-first.
async function cleanUp(db, businessIds, ownerIds, runTag) {
  const tables = ["audit_events", "founding_members", "business_members", "devices", "register_sessions",
    "invoice_number_ranges", "entitlement_overrides", "subscriptions", "branches"];
  for (const table of tables) {
    await db`delete from ${db("public." + table)} where business_id = any(${businessIds}::uuid[])`;
  }
  await db`delete from public.billing_events where id like ${`evt_${runTag}_%`}`;
  await db`delete from public.businesses where id = any(${businessIds}::uuid[])`;
  await db`delete from auth.users where id = any(${ownerIds}::uuid[])`;
}
