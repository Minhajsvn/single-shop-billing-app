import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { GRACE_DAYS, PLANS, TRIAL_DAYS, TRIAL_PLAN, planHasFeature } from "../lib/billing/plans.ts";
import { planCatalogSql } from "../scripts/plan-catalog-sql.mjs";

test("plan limits match the approved matrix", () => {
  assert.deepEqual(PLANS.starter.limits, { branches: 1, tills: 1, members: 2, products: 1000 });
  assert.deepEqual(PLANS.pro.limits, { branches: 1, tills: 2, members: 5, products: null });
  assert.deepEqual(PLANS.business.limits, { branches: 3, tills: 6, members: 20, products: null });
  assert.deepEqual(PLANS.enterprise.limits, { branches: null, tills: null, members: null, products: null });
});

test("higher tiers include every feature of lower tiers", () => {
  const order = ["starter", "pro", "business", "enterprise"];
  for (let index = 1; index < order.length; index += 1) {
    for (const feature of PLANS[order[index - 1]].features) {
      assert.ok(PLANS[order[index]].features.includes(feature), `${order[index]} is missing ${feature}`);
    }
  }
  assert.equal(planHasFeature("starter", "serial_tracking"), false);
  assert.equal(planHasFeature("pro", "serial_tracking"), true);
  assert.equal(planHasFeature("pro", "repairs"), false);
  assert.equal(planHasFeature("business", "repairs"), true);
});

test("trial and grace constants match the spec", () => {
  assert.equal(TRIAL_PLAN, "pro");
  assert.equal(TRIAL_DAYS, 14);
  assert.equal(GRACE_DAYS, 7);
});

test("the latest plan_catalog migration matches lib/billing/plans.ts", () => {
  const files = readdirSync("supabase/migrations").filter((name) => name.endsWith("_plan_catalog.sql")).sort();
  assert.ok(files.length > 0, "run: npm run plans:sql -- --write <yyyymmddhhmm>");
  // Git may check the file out with CRLF on Windows; compare content, not line endings.
  const latest = readFileSync(`supabase/migrations/${files.at(-1)}`, "utf8").replace(/\r\n/g, "\n");
  assert.equal(latest, planCatalogSql(PLANS));
});

test("the database trial bootstrap uses the same plan and length", () => {
  const sql = readFileSync("supabase/migrations/202610110014_billing_entitlements.sql", "utf8");
  const match = sql.match(/values \(new\.id, '(\w+)', 'trialing', now\(\) \+ interval '(\d+) days'\)/);
  assert.ok(match, "bootstrap_business must insert the trial subscription");
  assert.equal(match[1], TRIAL_PLAN);
  assert.equal(Number(match[2]), TRIAL_DAYS);
});
