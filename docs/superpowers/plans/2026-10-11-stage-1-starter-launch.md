# Stage 1: Starter Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Shop Ledger sellable as a UAE "Starter" subscription. This sub-plan (1A) lays the data and entitlement foundations that every later Stage 1 sub-plan and every future tier depends on.

**Architecture:**
- Tenancy moves from "one owner per business" to `business_members` with roles, and from an implicit single shop to explicit `branches`.
- Plan features and limits are defined once in TypeScript (`lib/billing/plans.ts`) and generated into a `plan_catalog` table.
- A single Postgres resolver (`business_entitlements`) and limit triggers enforce plans, so nothing in the browser can bypass them.
- Country and tax rules move from hard-coded UAE values into `lib/fiscal/countries.ts` and per-country database constraints.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase Postgres (RLS, plpgsql), Node 24 built-in test runner (`node --test`), `postgres` (postgres.js) for SQL tests.

**Spec:** `docs/superpowers/specs/2026-10-11-saas-plans-and-improvements-design.md`

## Global Constraints

- Money is stored as integer minor units. Existing `*_fils` column names are kept and mean "minor units".
- Every business table enforces row-level security. Server secrets never enter the browser bundle.
- Completed invoices and credit notes are immutable. No billing state may block, alter or delete an issued fiscal document.
- Legally required capability (tax invoices, e-invoicing, invoice retention and export) is never gated by plan.
- Only the UAE (`AE`) is enabled in Stage 1. KSA (`SA`) exists in code and schema but is `enabled: false`.
- Plan limits: Starter 1 branch / 1 till / 2 members / 1,000 products; Pro 1 / 2 / 5 / unlimited; Business 3 / 6 / 20 / unlimited; Enterprise unlimited. `null` = unlimited.
- Trial: 14 days on Pro with no card. Grace period after a failed payment: 7 days.
- Lifecycle: `active` → full; `trialing` before `trial_ends_at` → full; `past_due` before `grace_ends_at` → full; anything else → `read_only`.
- Before importing any code, read the relevant guide in `node_modules/next/dist/docs/` (see `AGENTS.md`). This version of Next.js has breaking changes.
- Code and tests run with `node --experimental-strip-types`. Any `.ts` module imported by a test must use relative imports **with the `.ts` extension**, not `@/` aliases.

## Review Focus

1. **Existing shops after migration.** Every existing business must get an owner member, a main branch, `branch_id` on all historical rows, and a trial subscription. Existing sync RPCs, which insert rows without `branch_id`, must keep working. Covered in Task 3 (default branch) and Task 5 (backfill).
2. **Downgrade while over a limit.** Existing tills, branches, members and products stay. Only new inserts and re-activations are blocked. Covered in Task 5.
3. **Cross-tenant spoofing.** A user must not attach a row to another business's branch, or read another business's entitlements. Covered in Task 3 (composite FK) and Task 5 (`forbidden`).
4. **Trial expiry boundary.** At exactly `trial_ends_at` the shop is read-only, never "one more free second". Covered in Task 5.
5. **Changing country after invoicing.** Country, currency and timezone cannot change once a sale exists, but can change before. Covered in Task 4.

---

## Stage 1 roadmap (sub-plans)

Stage 1 is too large for one executable plan, so it is split into sub-plans, each producing working, tested software. **This document contains sub-plan 1A in full.** Each later sub-plan is written once the one before it is merged, because it builds on the real interfaces it produced.

| # | Sub-plan | Depends on | Delivers |
|---|---|---|---|
| **1A** | **Foundations** (this document) | – | Country/tax layer, plan catalogue, members/branches, entitlements and limits in Postgres, SQL test harness |
| 1B | Server-first data | 1A | Repository layer over Supabase replacing `lib/demo-store.ts`, IndexedDB read cache and existing outbox, `GET /api/v1/entitlements`, signed offline entitlement snapshot, labelled sample shop for trials only |
| 1C | Checkout fixes | 1B | Payment step with cash received and change due, receipt side panel (no reload), stale-register warning, hold and resume, basic discounts, same-barcode increment, unknown-barcode "add product" |
| 1D | Catalogue | 1B | Product editing, CSV import/export, barcode label printing, tax category on products |
| 1E | Navigation and polish | 1B | Phone nav with "More", sidebar user menu with branch and till, compact summary strip, sync status text, search and pagination on Sales and Customers, toasts and dialogs, skeletons, Settings tabs |
| 1F | Billing | 1A, 1B | Stripe Checkout, Customer Portal, webhook with duplicate-event handling, `useEntitlement` and `<FeatureGate>`, lifecycle banners, read-only mode at register open, Billing tab |
| 1G | Signup and onboarding | 1F | Self-serve signup → country (UAE) → business details → onboarding checklist |
| 1H | Internal admin console | 1F | `/admin` restricted to platform staff: tenants, trial extension, overrides |

**Order:** 1A → 1B → (1C, 1D, 1E in parallel) → 1F → 1G → 1H.

**Stage 1 exit criteria (from the spec):**
- the PRD acceptance journeys pass against Supabase
- the Stripe test-mode lifecycle (trial → active → past_due → read-only → reactivate) passes end to end
- no demo store remains in production code paths

---

## Sub-plan 1A: Foundations

### Prerequisites (do before Task 1, with the owner's confirmation)

- [ ] **P1:** The working tree has uncommitted work: the sync API under `app/api/` and the migrations `202609130006`–`202609140009`. Ask the owner to commit or stash it. Do not commit it yourself unless asked. Then create the branch `stage-1a-foundations` from `main`.
- [ ] **P2:** Ask the owner for a **non-production** Supabase project to use for SQL tests, and its direct Postgres connection string. Store it as `SUPABASE_TEST_DB_URL` in `.env.local`; it is git-ignored and must not be pasted into chat. Migrations are pushed to that project only. **Get explicit owner approval before each `supabase db push`.**

### File structure

| File | Responsibility |
|---|---|
| `lib/fiscal/countries.ts` (create) | Country profiles, tax-ID validation, VAT rate lookup, VAT-inclusive split, money formatting. No imports. |
| `lib/domain.ts` (modify) | `calculateVatInclusive` and `formatAED` delegate to `lib/fiscal/countries.ts` |
| `lib/billing/plans.ts` (create) | Plan catalogue: feature keys, limits, prices, trial and grace constants. No imports. |
| `scripts/plan-catalog-sql.mjs` (create) | Generates the `plan_catalog` seed migration from `plans.ts` |
| `scripts/run-sql-tests.mjs` (create) | Runs `supabase/tests/*.sql` against `SUPABASE_TEST_DB_URL` |
| `supabase/migrations/202610110010_members_branches.sql` (create) | Members, `has_role`, branches, `branch_id` columns, business bootstrap |
| `supabase/migrations/202610110011_fiscal_country.sql` (create) | Country, currency, tax-ID check, country lock, tax category, line VAT rate |
| `supabase/migrations/202610110012_plan_catalog_table.sql` (create) | `plan_catalog` table |
| `supabase/migrations/202610110013_plan_catalog.sql` (generated) | Plan rows |
| `supabase/migrations/202610110014_billing_entitlements.sql` (create) | Subscriptions, overrides, Stripe events, resolver, limit triggers, backfill |
| `supabase/tests/foundation_test.sql` (create) | SQL tests for everything above, inside one rolled-back transaction |
| `tests/fiscal-countries.test.mjs`, `tests/plans.test.mjs` (create) | Unit tests |
| `tsconfig.json`, `package.json` (modify) | `allowImportingTsExtensions`; `test:sql` and `plans:sql` scripts; `postgres` dev dependency |

---

### Task 1: Country and tax layer

**Files:**
- Create: `lib/fiscal/countries.ts`
- Modify: `lib/domain.ts` (`formatAED`, `calculateVatInclusive`)
- Modify: `tsconfig.json` (add `"allowImportingTsExtensions": true` under `compilerOptions`)
- Test: `tests/fiscal-countries.test.mjs`

**Interfaces:**
- Produces:
  - `type CountryCode = "AE" | "SA"`
  - `type CurrencyCode = "AED" | "SAR"`
  - `type TaxCategory = "standard" | "zero" | "exempt"`
  - `type CountryProfile`
  - `COUNTRY_PROFILES: Record<CountryCode, CountryProfile>`
  - `getCountryProfile(code: string): CountryProfile`
  - `enabledCountries(): CountryProfile[]`
  - `isValidTaxId(country: CountryCode, value: string): boolean`
  - `vatRateFor(country: CountryCode, category: TaxCategory): number` (basis points)
  - `splitVatInclusive(grossFils: number, rateBp: number): { netFils: number; vatFils: number; grossFils: number }`
  - `formatMoney(minor: number, currency: CurrencyCode): string`
  - `calculateVatInclusive(grossFils: number, rateBp?: number)` keeps its old signature, defaulting to 500.

- [ ] **Step 1: Write the failing test** in `tests/fiscal-countries.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  COUNTRY_PROFILES,
  enabledCountries,
  formatMoney,
  getCountryProfile,
  isValidTaxId,
  splitVatInclusive,
  vatRateFor,
} from "../lib/fiscal/countries.ts";
import { calculateVatInclusive, formatAED } from "../lib/domain.ts";

test("only the UAE is enabled in Stage 1", () => {
  assert.deepEqual(enabledCountries().map((profile) => profile.code), ["AE"]);
  assert.equal(COUNTRY_PROFILES.SA.enabled, false);
});

test("country profiles carry currency, timezone and VAT rate", () => {
  assert.equal(getCountryProfile("AE").currency, "AED");
  assert.equal(getCountryProfile("AE").timezone, "Asia/Dubai");
  assert.equal(getCountryProfile("SA").standardVatRateBp, 1500);
  assert.throws(() => getCountryProfile("XX"), /Unsupported country/);
});

test("tax IDs are validated per country", () => {
  assert.equal(isValidTaxId("AE", "100123456700003"), true);
  assert.equal(isValidTaxId("AE", "10012345670000"), false);
  assert.equal(isValidTaxId("SA", "300000000000003"), true);
  assert.equal(isValidTaxId("SA", "100000000000003"), false);
});

test("zero-rated and exempt items carry no VAT", () => {
  assert.equal(vatRateFor("AE", "standard"), 500);
  assert.equal(vatRateFor("AE", "zero"), 0);
  assert.equal(vatRateFor("SA", "exempt"), 0);
});

test("VAT-inclusive split preserves every minor unit at any rate", () => {
  assert.deepEqual(splitVatInclusive(2850, 500), { netFils: 2714, vatFils: 136, grossFils: 2850 });
  assert.deepEqual(splitVatInclusive(11500, 1500), { netFils: 10000, vatFils: 1500, grossFils: 11500 });
  assert.deepEqual(splitVatInclusive(999, 0), { netFils: 999, vatFils: 0, grossFils: 999 });
  assert.throws(() => splitVatInclusive(10.5, 500), RangeError);
  assert.throws(() => splitVatInclusive(-1, 500), RangeError);
});

test("legacy helpers keep their UAE behaviour", () => {
  assert.deepEqual(calculateVatInclusive(5700), { netFils: 5429, vatFils: 271, grossFils: 5700 });
  assert.deepEqual(calculateVatInclusive(11500, 1500), { netFils: 10000, vatFils: 1500, grossFils: 11500 });
  assert.match(formatAED(2850), /AED\s?28\.50/);
  assert.match(formatMoney(4200, "SAR"), /42\.00/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test tests/fiscal-countries.test.mjs`
Expected: FAIL with `Cannot find module` for `lib/fiscal/countries.ts`.

- [ ] **Step 3: Create `lib/fiscal/countries.ts`**

```ts
export type CountryCode = "AE" | "SA";
export type CurrencyCode = "AED" | "SAR";
export type TaxCategory = "standard" | "zero" | "exempt";

export type CountryProfile = {
  code: CountryCode;
  name: string;
  enabled: boolean;
  currency: CurrencyCode;
  minorUnitExponent: number;
  timezone: string;
  locale: string;
  standardVatRateBp: number;
  taxIdLabel: string;
  taxIdPattern: RegExp;
  invoiceTitle: { en: string; ar: string };
  simplifiedInvoiceTitle: { en: string; ar: string };
};

export const COUNTRY_PROFILES: Record<CountryCode, CountryProfile> = {
  AE: {
    code: "AE",
    name: "United Arab Emirates",
    enabled: true,
    currency: "AED",
    minorUnitExponent: 2,
    timezone: "Asia/Dubai",
    locale: "en-AE",
    standardVatRateBp: 500,
    taxIdLabel: "TRN",
    taxIdPattern: /^[0-9]{15}$/,
    invoiceTitle: { en: "Tax Invoice", ar: "فاتورة ضريبية" },
    simplifiedInvoiceTitle: { en: "Simplified Tax Invoice", ar: "فاتورة ضريبية مبسطة" },
  },
  SA: {
    code: "SA",
    name: "Saudi Arabia",
    enabled: false,
    currency: "SAR",
    minorUnitExponent: 2,
    timezone: "Asia/Riyadh",
    locale: "en-SA",
    standardVatRateBp: 1500,
    taxIdLabel: "VAT number",
    taxIdPattern: /^3[0-9]{13}3$/,
    invoiceTitle: { en: "Tax Invoice", ar: "فاتورة ضريبية" },
    simplifiedInvoiceTitle: { en: "Simplified Tax Invoice", ar: "فاتورة ضريبية مبسطة" },
  },
};

const CURRENCY_EXPONENT: Record<CurrencyCode, number> = { AED: 2, SAR: 2 };

export function getCountryProfile(code: string): CountryProfile {
  const profile = COUNTRY_PROFILES[code as CountryCode];
  if (!profile) throw new Error(`Unsupported country: ${code}`);
  return profile;
}

export function enabledCountries(): CountryProfile[] {
  return Object.values(COUNTRY_PROFILES).filter((profile) => profile.enabled);
}

export function isValidTaxId(country: CountryCode, value: string): boolean {
  return getCountryProfile(country).taxIdPattern.test(value);
}

export function vatRateFor(country: CountryCode, category: TaxCategory): number {
  return category === "standard" ? getCountryProfile(country).standardVatRateBp : 0;
}

export function splitVatInclusive(grossFils: number, rateBp: number) {
  if (!Number.isInteger(grossFils) || grossFils < 0) throw new RangeError("Gross amount must be a non-negative integer of minor units.");
  if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10000) throw new RangeError("VAT rate must be 0–10000 basis points.");
  const netFils = Math.round((grossFils * 10000) / (10000 + rateBp));
  return { netFils, vatFils: grossFils - netFils, grossFils };
}

export function formatMoney(minor: number, currency: CurrencyCode): string {
  const exponent = CURRENCY_EXPONENT[currency];
  const locale = currency === "SAR" ? "en-SA" : "en-AE";
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: exponent, maximumFractionDigits: exponent }).format(minor / 10 ** exponent);
}
```

- [ ] **Step 4: Make `lib/domain.ts` delegate.** Add this at the top of the file:

```ts
import { formatMoney, splitVatInclusive } from "./fiscal/countries.ts";
```

Replace the existing `formatAED` and `calculateVatInclusive` with:

```ts
export function formatAED(fils: number) {
  return formatMoney(fils, "AED");
}

export function calculateVatInclusive(grossFils: number, rateBp = 500) {
  return splitVatInclusive(grossFils, rateBp);
}
```

Add `"allowImportingTsExtensions": true,` to `compilerOptions` in `tsconfig.json`. It's valid because `noEmit` is already `true`.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test && npm run typecheck && npm run build`
Expected:
- all tests in `tests/fiscal.test.mjs` and `tests/fiscal-countries.test.mjs` PASS
- `tsc` reports no errors
- `next build` succeeds, which confirms the bundler accepts the `.ts`-extension import in `lib/domain.ts`

- [ ] **Step 6: Commit**

```bash
git add lib/fiscal/countries.ts lib/domain.ts tsconfig.json tests/fiscal-countries.test.mjs
git commit -m "feat(fiscal): add country profiles and rate-aware VAT split"
```

---

### Task 2: Plan catalogue and SQL seed generator

**Files:**
- Create: `lib/billing/plans.ts`
- Create: `scripts/plan-catalog-sql.mjs`
- Create (generated): `supabase/migrations/202610110013_plan_catalog.sql`
- Modify: `package.json` (add a `plans:sql` script)
- Test: `tests/plans.test.mjs`

**Interfaces:**
- Produces:
  - `type FeatureKey`
  - `type PlanId = "starter" | "pro" | "business" | "enterprise"`
  - `type PlanLimits = { branches: number | null; tills: number | null; members: number | null; products: number | null }`
  - `type Plan`
  - `PLANS: Record<PlanId, Plan>`
  - `TRIAL_PLAN: PlanId`, `TRIAL_DAYS = 14`, `GRACE_DAYS = 7`
  - `ADDON_PRICES`
  - `planHasFeature(planId: PlanId, feature: FeatureKey): boolean`
  - `planCatalogSql(plans?): string` (exported from `scripts/plan-catalog-sql.mjs`)

- [ ] **Step 1: Write the failing test** in `tests/plans.test.mjs`

```js
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
  const latest = readFileSync(`supabase/migrations/${files.at(-1)}`, "utf8");
  assert.equal(latest, planCatalogSql(PLANS));
});

test("the database trial bootstrap uses the same plan and length", () => {
  const sql = readFileSync("supabase/migrations/202610110014_billing_entitlements.sql", "utf8");
  const match = sql.match(/values \(new\.id, '(\w+)', 'trialing', now\(\) \+ interval '(\d+) days'\)/);
  assert.ok(match, "bootstrap_business must insert the trial subscription");
  assert.equal(match[1], TRIAL_PLAN);
  assert.equal(Number(match[2]), TRIAL_DAYS);
});
```

The last test depends on Task 5's migration. It is expected to fail until Task 5 is done; Task 5 Step 6 re-runs it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test tests/plans.test.mjs`
Expected: FAIL with `Cannot find module` for `lib/billing/plans.ts`.

- [ ] **Step 3: Create `lib/billing/plans.ts`**

```ts
export type FeatureKey =
  | "staff_roles"
  | "weighed_items"
  | "serial_tracking"
  | "split_payment"
  | "promotions"
  | "purchasing"
  | "categories_margin"
  | "advanced_reports"
  | "digital_receipts"
  | "repairs"
  | "customer_credit"
  | "loyalty"
  | "multi_branch"
  | "accounting_export"
  | "api_access"
  | "audit_log"
  | "sso";

export type PlanId = "starter" | "pro" | "business" | "enterprise";

export type PlanLimits = { branches: number | null; tills: number | null; members: number | null; products: number | null };

export type Plan = {
  id: PlanId;
  name: string;
  selfServe: boolean;
  monthlyPriceMinor: { AED: number; SAR: number } | null;
  features: FeatureKey[];
  limits: PlanLimits;
};

const PRO_FEATURES: FeatureKey[] = [
  "staff_roles",
  "weighed_items",
  "serial_tracking",
  "split_payment",
  "promotions",
  "purchasing",
  "categories_margin",
  "advanced_reports",
  "digital_receipts",
];

const BUSINESS_FEATURES: FeatureKey[] = [
  ...PRO_FEATURES,
  "repairs",
  "customer_credit",
  "loyalty",
  "multi_branch",
  "accounting_export",
  "api_access",
  "audit_log",
];

export const PLANS: Record<PlanId, Plan> = {
  starter: { id: "starter", name: "Starter", selfServe: true, monthlyPriceMinor: { AED: 7900, SAR: 7900 }, features: [], limits: { branches: 1, tills: 1, members: 2, products: 1000 } },
  pro: { id: "pro", name: "Pro", selfServe: true, monthlyPriceMinor: { AED: 17900, SAR: 17900 }, features: PRO_FEATURES, limits: { branches: 1, tills: 2, members: 5, products: null } },
  business: { id: "business", name: "Business", selfServe: true, monthlyPriceMinor: { AED: 34900, SAR: 34900 }, features: BUSINESS_FEATURES, limits: { branches: 3, tills: 6, members: 20, products: null } },
  enterprise: { id: "enterprise", name: "Enterprise", selfServe: false, monthlyPriceMinor: null, features: [...BUSINESS_FEATURES, "sso"], limits: { branches: null, tills: null, members: null, products: null } },
};

export const ADDON_PRICES = {
  till: { AED: 4900, SAR: 4900 },
  branch: { AED: 12900, SAR: 12900 },
} as const;

export const TRIAL_PLAN: PlanId = "pro";
export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 7;

export function planHasFeature(planId: PlanId, feature: FeatureKey): boolean {
  return PLANS[planId].features.includes(feature);
}
```

- [ ] **Step 4: Create `scripts/plan-catalog-sql.mjs`**

```js
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PLANS } from "../lib/billing/plans.ts";

function sqlLimit(value) {
  return value === null ? "null" : String(value);
}

function sqlFeatures(features) {
  return features.length ? `array[${features.map((feature) => `'${feature}'`).join(", ")}]::text[]` : "array[]::text[]";
}

export function planCatalogSql(plans = PLANS) {
  const rows = Object.values(plans).map(
    (plan) => `  ('${plan.id}', ${sqlFeatures(plan.features)}, ${sqlLimit(plan.limits.branches)}, ${sqlLimit(plan.limits.tills)}, ${sqlLimit(plan.limits.members)}, ${sqlLimit(plan.limits.products)})`,
  );
  return [
    "-- Generated by `npm run plans:sql` from lib/billing/plans.ts. Do not edit by hand.",
    "insert into public.plan_catalog (id, features, max_branches, max_tills, max_members, max_products) values",
    rows.join(",\n"),
    "on conflict (id) do update set features = excluded.features, max_branches = excluded.max_branches, max_tills = excluded.max_tills, max_members = excluded.max_members, max_products = excluded.max_products;",
    "",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flag = process.argv.indexOf("--write");
  const timestamp = flag === -1 ? undefined : process.argv[flag + 1];
  if (!timestamp || !/^[0-9]{12}$/.test(timestamp)) {
    process.stdout.write(planCatalogSql());
  } else {
    const target = `supabase/migrations/${timestamp}_plan_catalog.sql`;
    writeFileSync(target, planCatalogSql());
    console.log(`Wrote ${target}`);
  }
}
```

Add this to `package.json` `scripts`:

```json
"plans:sql": "node --experimental-strip-types scripts/plan-catalog-sql.mjs"
```

- [ ] **Step 5: Generate the seed migration**

Run: `npm run plans:sql -- --write 202610110013`
Expected: `Wrote supabase/migrations/202610110013_plan_catalog.sql`. The file has 4 value rows; `starter` has `array[]::text[], 1, 1, 2, 1000`.

- [ ] **Step 6: Run the tests**

Run: `node --experimental-strip-types --test tests/plans.test.mjs`
Expected: 4 PASS, and 1 FAIL in "the database trial bootstrap…" with `ENOENT … 202610110014_billing_entitlements.sql`. That is expected until Task 5.

- [ ] **Step 7: Commit**

```bash
git add lib/billing/plans.ts scripts/plan-catalog-sql.mjs supabase/migrations/202610110013_plan_catalog.sql package.json tests/plans.test.mjs
git commit -m "feat(billing): add plan catalogue and generated plan_catalog seed"
```

---

### Task 3: Members, roles and branches (migration + SQL test harness)

**Files:**
- Create: `scripts/run-sql-tests.mjs`
- Create: `supabase/migrations/202610110010_members_branches.sql`
- Create: `supabase/tests/foundation_test.sql` (sections 1–4; Tasks 4 and 5 append more)
- Modify: `package.json` (add a `test:sql` script and the `postgres` dev dependency)

**Interfaces:**
- Consumes: existing `public.businesses`, `public.devices`, `public.owns_business(uuid)`
- Produces:
  - type `public.member_role` (`cashier < manager < owner`)
  - table `public.business_members`
  - function `public.has_role(uuid, public.member_role) → boolean`
  - table `public.branches`, with `is_main` and `status in ('active','inactive')`
  - `branch_id` on `devices`, `register_sessions`, `sales`, `stock_movements`, `cash_movements` and `credit_notes`, filled in automatically when omitted
  - trigger function `public.bootstrap_business()`
  - `owns_business(x)` now means `has_role(x, 'owner')`. This deliberately keeps existing policy behaviour; per-role policies come in Stage 2.

- [ ] **Step 1: Install the SQL test client and add the runner**

Run: `npm install --save-dev postgres@3.4.5`

Create `scripts/run-sql-tests.mjs`:

```js
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.SUPABASE_TEST_DB_URL;
if (!url) {
  console.error("SUPABASE_TEST_DB_URL is not set. Use a NON-PRODUCTION Supabase project.");
  process.exit(2);
}

const directory = "supabase/tests";
const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(directory).filter((name) => name.endsWith(".sql")).sort().map((name) => join(directory, name));
const sql = postgres(url, { max: 1, onnotice: () => {} });
let failed = 0;

for (const file of files) {
  try {
    await sql.unsafe(readFileSync(file, "utf8"));
    console.log(`PASS ${file}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${file}\n  ${error.message}${error.detail ? `\n  detail: ${error.detail}` : ""}`);
    await sql.unsafe("rollback").catch(() => {});
  }
}

await sql.end();
process.exit(failed ? 1 : 0);
```

Add this to `package.json` `scripts`:

```json
"test:sql": "node --env-file=.env.local scripts/run-sql-tests.mjs"
```

- [ ] **Step 2: Write the failing SQL test.** Create `supabase/tests/foundation_test.sql`. Every test file starts with `begin;` and ends with `rollback;`, so nothing persists.

```sql
-- Foundation tests. Runs inside one transaction and always rolls back.
begin;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@test.local'),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@test.local'),
  ('00000000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-c@test.local');

-- 1. Bootstrap: creating a business creates its owner membership and main branch.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
values ('b0000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a', 'Shop A LLC', '100000000000003', 'Al Barsha, Dubai', '+971500000001');

do $$ begin
  assert (select count(*) from public.business_members where business_id = 'b0000000-0000-4000-8000-00000000000a' and role = 'owner' and status = 'active') = 1, 'owner membership created';
  assert (select count(*) from public.branches where business_id = 'b0000000-0000-4000-8000-00000000000a' and is_main) = 1, 'main branch created';
  assert public.has_role('b0000000-0000-4000-8000-00000000000a', 'cashier'), 'owner satisfies cashier';
  assert public.owns_business('b0000000-0000-4000-8000-00000000000a'), 'owns_business still true for owner';
end $$;

-- 2. Default branch: rows inserted without branch_id get the main branch.
insert into public.devices (id, business_id, name) values ('d0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000a', 'Till 1');
do $$ begin
  assert (select d.branch_id = b.id from public.devices d join public.branches b on b.business_id = d.business_id and b.is_main where d.id = 'd0000000-0000-4000-8000-00000000000a'), 'device assigned to main branch';
end $$;

-- 3. Tenant isolation: owner B sees nothing of business A.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
values ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000b', 'Shop B LLC', '100000000000004', 'Deira, Dubai', '+971500000002');
do $$ begin
  assert (select count(*) from public.businesses where id = 'b0000000-0000-4000-8000-00000000000a') = 0, 'B cannot read A business';
  assert (select count(*) from public.branches where business_id = 'b0000000-0000-4000-8000-00000000000a') = 0, 'B cannot read A branches';
  assert (select count(*) from public.business_members where business_id = 'b0000000-0000-4000-8000-00000000000a') = 0, 'B cannot read A members';
  assert (select count(*) from public.devices where business_id = 'b0000000-0000-4000-8000-00000000000a') = 0, 'B cannot read A devices';
  assert not public.has_role('b0000000-0000-4000-8000-00000000000a', 'cashier'), 'B has no role in A';
end $$;

-- 4. Cross-tenant spoof: B cannot attach a device to A's branch.
reset role;
select set_config('test.a_branch', (select id::text from public.branches where business_id = 'b0000000-0000-4000-8000-00000000000a' and is_main), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
do $$ begin
  begin
    insert into public.devices (business_id, branch_id, name) values ('b0000000-0000-4000-8000-00000000000b', current_setting('test.a_branch')::uuid, 'Spoofed till');
    assert false, 'device on another tenant branch must be rejected';
  exception when foreign_key_violation then
    null;
  end;
end $$;
reset role;

rollback;
```

- [ ] **Step 3: Run it to verify it fails**

The owner must approve pushing to the **test** project first.

Run: `npm run test:sql`
Expected: `FAIL supabase/tests/foundation_test.sql` with `relation "public.business_members" does not exist` (or `column "branch_id" … does not exist`).

- [ ] **Step 4: Write `supabase/migrations/202610110010_members_branches.sql`**

```sql
-- Stage 1A: team members with roles, and explicit branches.

create type public.member_role as enum ('cashier', 'manager', 'owner');
create type public.member_status as enum ('active', 'disabled');

create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role public.member_role not null,
  status public.member_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create index business_members_user_idx on public.business_members (user_id) where status = 'active';

create function public.role_rank(target_role public.member_role)
returns integer language sql immutable
as $$ select case target_role when 'owner' then 3 when 'manager' then 2 else 1 end $$;

create function public.has_role(target_business_id uuid, min_role public.member_role)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = target_business_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and public.role_rank(m.role) >= public.role_rank(min_role)
  )
$$;

-- Existing policies and RPCs call owns_business(); keep their meaning (owner only) until Stage 2 adds per-role policies.
create or replace function public.owns_business(target_business_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select public.has_role(target_business_id, 'owner') $$;

insert into public.business_members (business_id, user_id, role)
select id, owner_id, 'owner' from public.businesses
on conflict (business_id, user_id) do nothing;

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 80),
  address text not null default '',
  invoice_prefix text not null check (invoice_prefix ~ '^[A-Z0-9-]{1,8}$'),
  receipt_footer text not null default '',
  is_main boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  unique (business_id, name),
  unique (id, business_id)
);

create unique index one_main_branch_per_business on public.branches (business_id) where is_main;

insert into public.branches (business_id, name, address, invoice_prefix, receipt_footer, is_main)
select id, 'Main branch', address, invoice_prefix, receipt_footer, true from public.businesses;

-- Rows that omit branch_id inherit it from their device, then their register session, then the main branch.
create function public.assign_default_branch()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  row_data jsonb := to_jsonb(new);
begin
  if new.branch_id is null and row_data->>'device_id' is not null then
    new.branch_id := (select d.branch_id from public.devices d where d.id = (row_data->>'device_id')::uuid);
  end if;
  if new.branch_id is null and row_data->>'register_session_id' is not null then
    new.branch_id := (select r.branch_id from public.register_sessions r where r.id = (row_data->>'register_session_id')::uuid);
  end if;
  if new.branch_id is null then
    new.branch_id := (select b.id from public.branches b where b.business_id = new.business_id and b.is_main);
  end if;
  return new;
end
$$;

do $$
declare
  target text;
begin
  foreach target in array array['devices', 'register_sessions', 'sales', 'stock_movements', 'cash_movements', 'credit_notes'] loop
    execute format('alter table public.%I add column branch_id uuid', target);
    execute format('update public.%I t set branch_id = b.id from public.branches b where b.business_id = t.business_id and b.is_main', target);
    execute format('alter table public.%I alter column branch_id set not null', target);
    execute format('alter table public.%I add constraint %I foreign key (branch_id, business_id) references public.branches (id, business_id) on delete restrict', target, target || '_branch_fk');
    execute format('create index %I on public.%I (branch_id)', target || '_branch_idx', target);
    execute format('create trigger assign_default_branch before insert on public.%I for each row execute function public.assign_default_branch()', target);
  end loop;
end
$$;

-- New businesses get their owner membership and main branch atomically.
create function public.bootstrap_business()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.business_members (business_id, user_id, role) values (new.id, new.owner_id, 'owner');
  insert into public.branches (business_id, name, address, invoice_prefix, receipt_footer, is_main)
  values (new.id, 'Main branch', new.address, new.invoice_prefix, new.receipt_footer, true);
  return new;
end
$$;

create trigger bootstrap_business after insert on public.businesses for each row execute function public.bootstrap_business();

drop policy "owners manage their business" on public.businesses;
create policy "members read their business" on public.businesses for select using (owner_id = auth.uid() or public.has_role(id, 'cashier'));
create policy "users create their own business" on public.businesses for insert with check (owner_id = auth.uid());
create policy "owners update their business" on public.businesses for update using (public.has_role(id, 'owner')) with check (public.has_role(id, 'owner'));

alter table public.business_members enable row level security;
create policy "members read their team" on public.business_members for select using (public.has_role(business_id, 'cashier'));

alter table public.branches enable row level security;
create policy "members read branches" on public.branches for select using (public.has_role(business_id, 'cashier'));
create policy "owners create branches" on public.branches for insert with check (public.has_role(business_id, 'owner'));
create policy "owners update branches" on public.branches for update using (public.has_role(business_id, 'owner')) with check (public.has_role(business_id, 'owner'));
```

- [ ] **Step 5: Apply to the test project and run the tests**

With the owner's approval, run: `supabase db push` (linked to the **test** project), then `npm run test:sql`.
Expected: `PASS supabase/tests/foundation_test.sql`.

- [ ] **Step 6: Confirm the existing app still works**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/run-sql-tests.mjs supabase/migrations/202610110010_members_branches.sql supabase/tests/foundation_test.sql package.json package-lock.json
git commit -m "feat(db): add business members, roles and branches"
```

---

### Task 4: Country, currency and tax columns

**Files:**
- Create: `supabase/migrations/202610110011_fiscal_country.sql`
- Modify: `supabase/tests/foundation_test.sql` (append section 5 before the final `rollback;`)

**Interfaces:**
- Consumes: `public.businesses` (`timezone`, `trn`), `public.sales`, `public.products`, `public.sale_items`, `public.credit_note_items`
- Produces:
  - `businesses.country` (`'AE' | 'SA'`, default `'AE'`) and `businesses.currency` (`'AED' | 'SAR'`)
  - `public.valid_tax_id(text, text) → boolean`, mirroring `isValidTaxId` from Task 1
  - error message `country_locked`
  - type `public.tax_category` and `products.tax_category`
  - `sale_items.vat_rate_bp` and `credit_note_items.vat_rate_bp` (default 500)

- [ ] **Step 1: Append the failing test** to `supabase/tests/foundation_test.sql`, before the final `rollback;`

```sql
-- 5. Country rules: valid tax IDs, consistent country profile, country locked after first invoice.
do $$ begin
  begin
    insert into public.businesses (owner_id, legal_name, trn, address, phone)
    values ('00000000-0000-4000-8000-00000000000c', 'Bad TRN', '12345', 'Dubai', '+971500000009');
    assert false, 'invalid UAE TRN must be rejected';
  exception when check_violation then
    null;
  end;
  begin
    update public.businesses set country = 'SA' where id = 'b0000000-0000-4000-8000-00000000000b';
    assert false, 'SA with AED and a UAE TRN must be rejected';
  exception when check_violation then
    null;
  end;
  assert (select tax_category::text from public.products limit 0) is null, 'tax_category column exists';
end $$;

-- B has no sales yet, so B may still switch country.
update public.businesses set country = 'SA', currency = 'SAR', timezone = 'Asia/Riyadh', trn = '300000000000003' where id = 'b0000000-0000-4000-8000-00000000000b';
update public.businesses set country = 'AE', currency = 'AED', timezone = 'Asia/Dubai', trn = '100000000000004' where id = 'b0000000-0000-4000-8000-00000000000b';

-- A issues an invoice (inserted as the migration owner, as the sync RPCs do), then cannot switch.
insert into public.register_sessions (id, business_id, device_id, business_date, opening_cash_fils, opened_by)
values ('e0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-00000000000a', current_date, 0, '00000000-0000-4000-8000-00000000000a');
insert into public.sales (id, business_id, device_id, register_session_id, invoice_number, operation_id, payment_method, supply_date, supplier_snapshot, net_fils, vat_fils, gross_fils, created_by)
values ('5a000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-00000000000a', 'T-0001', gen_random_uuid(), 'cash', current_date, '{}'::jsonb, 100, 5, 105, '00000000-0000-4000-8000-00000000000a');

do $$ begin
  assert (select s.branch_id = d.branch_id from public.sales s join public.devices d on d.id = s.device_id where s.id = '5a000000-0000-4000-8000-00000000000a'), 'sale inherits device branch';
  begin
    update public.businesses set country = 'SA', currency = 'SAR', timezone = 'Asia/Riyadh', trn = '300000000000003' where id = 'b0000000-0000-4000-8000-00000000000a';
    assert false, 'country must be locked after the first invoice';
  exception when others then
    assert sqlerrm = 'country_locked', format('expected country_locked, got %s', sqlerrm);
  end;
end $$;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:sql`
Expected: FAIL with `column "country" of relation "businesses" does not exist`.

- [ ] **Step 3: Write `supabase/migrations/202610110011_fiscal_country.sql`**

```sql
-- Stage 1A: country, currency and per-country tax rules. Only AE is enabled in the app; SA is schema-ready.

create function public.valid_tax_id(country_code text, tax_id text)
returns boolean language sql immutable
as $$
  select case country_code
    when 'AE' then tax_id ~ '^[0-9]{15}$'
    when 'SA' then tax_id ~ '^3[0-9]{13}3$'
    else false
  end
$$;

alter table public.businesses
  add column country text not null default 'AE',
  add column currency text not null default 'AED';

alter table public.businesses drop constraint if exists businesses_timezone_check;
alter table public.businesses drop constraint if exists businesses_trn_check;

alter table public.businesses
  add constraint businesses_country_profile check (
    (country = 'AE' and currency = 'AED' and timezone = 'Asia/Dubai')
    or (country = 'SA' and currency = 'SAR' and timezone = 'Asia/Riyadh')
  ),
  add constraint businesses_tax_id_valid check (public.valid_tax_id(country, trn));

create function public.lock_business_country()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if (new.country, new.currency, new.timezone) is distinct from (old.country, old.currency, old.timezone)
     and exists (select 1 from public.sales s where s.business_id = old.id) then
    raise exception using errcode = 'P0001', message = 'country_locked',
      detail = 'Country, currency and timezone cannot change after the first invoice.';
  end if;
  return new;
end
$$;

create trigger lock_business_country before update on public.businesses for each row execute function public.lock_business_country();

create type public.tax_category as enum ('standard', 'zero', 'exempt');
alter table public.products add column tax_category public.tax_category not null default 'standard';

alter table public.sale_items add column vat_rate_bp integer not null default 500 check (vat_rate_bp between 0 and 10000);
alter table public.credit_note_items add column vat_rate_bp integer not null default 500 check (vat_rate_bp between 0 and 10000);
```

- [ ] **Step 4: Apply and run the tests**

With the owner's approval, run: `supabase db push`, then `npm run test:sql`.
Expected: `PASS supabase/tests/foundation_test.sql`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202610110011_fiscal_country.sql supabase/tests/foundation_test.sql
git commit -m "feat(db): add country, currency, tax-ID rules and tax categories"
```

---

### Task 5: Subscriptions, entitlements and plan limits

**Files:**
- Create: `supabase/migrations/202610110012_plan_catalog_table.sql`
- Create: `supabase/migrations/202610110014_billing_entitlements.sql`
- Modify: `supabase/tests/foundation_test.sql` (append sections 6–9 before the final `rollback;`)

The migration filenames sort so that `012` (table) runs before `013` (generated rows, from Task 2) and `014` (everything that references plans).

**Interfaces:**
- Consumes: `public.has_role`, `public.bootstrap_business` (replaced here), the generated rows in `202610110013_plan_catalog.sql`
- Produces:
  - tables `public.plan_catalog`, `public.subscriptions`, `public.entitlement_overrides` and `public.stripe_events`
  - type `public.subscription_status` (`trialing | active | past_due | canceled`)
  - `public.entitlements_internal(uuid, timestamptz default now()) → jsonb`, for service role and triggers only
  - `public.business_entitlements(uuid) → jsonb`, for members only (otherwise error `forbidden`). Its result is:
    ```
    { planId, status, access: "full" | "read_only", trialEndsAt, graceEndsAt,
      features: string[], limits: { branches, tills, members, products } }   // null = unlimited
    ```
  - error message `plan_limit_reached`, with `detail` set to the limit key
  - a bootstrap that now also creates a Pro trial

- [ ] **Step 1: Append the failing tests** to `supabase/tests/foundation_test.sql`, before the final `rollback;`. At this point the session is `reset role` (the migration owner), as left by section 5.

```sql
-- 6. Every business has a subscription; new ones start a 14-day Pro trial.
do $$ begin
  assert (select plan_id from public.subscriptions where business_id = 'b0000000-0000-4000-8000-00000000000a') = 'pro', 'trial is on pro';
  assert (select status::text from public.subscriptions where business_id = 'b0000000-0000-4000-8000-00000000000a') = 'trialing', 'trialing';
  assert (select trial_ends_at between now() + interval '13 days 23 hours' and now() + interval '14 days 1 hour' from public.subscriptions where business_id = 'b0000000-0000-4000-8000-00000000000a'), 'trial is 14 days';
  assert not exists (select 1 from public.businesses b left join public.subscriptions s on s.business_id = b.id where s.business_id is null), 'every business has a subscription';
end $$;

-- 7. Limits: Pro trial allows 2 tills; a third is refused.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
insert into public.devices (id, business_id, name) values ('d0000000-0000-4000-8000-0000000000a2', 'b0000000-0000-4000-8000-00000000000a', 'Till 2');
do $$ begin
  begin
    insert into public.devices (business_id, name) values ('b0000000-0000-4000-8000-00000000000a', 'Till 3');
    assert false, 'third till should exceed the Pro trial limit';
  exception when others then
    assert sqlerrm = 'plan_limit_reached', format('expected plan_limit_reached, got %s', sqlerrm);
  end;
end $$;
reset role;

-- 8. Downgrade over the limit keeps existing tills but blocks new ones and re-activation; an add-on lifts it.
update public.subscriptions set plan_id = 'starter', status = 'active' where business_id = 'b0000000-0000-4000-8000-00000000000a';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.devices where business_id = 'b0000000-0000-4000-8000-00000000000a' and status = 'active') = 2, 'existing tills survive downgrade';
  update public.devices set status = 'revoked' where id = 'd0000000-0000-4000-8000-0000000000a2';
  begin
    update public.devices set status = 'active' where id = 'd0000000-0000-4000-8000-0000000000a2';
    assert false, 're-activating beyond the Starter limit must fail';
  exception when others then
    assert sqlerrm = 'plan_limit_reached', format('expected plan_limit_reached, got %s', sqlerrm);
  end;
end $$;
reset role;
update public.subscriptions set addon_tills = 1 where business_id = 'b0000000-0000-4000-8000-00000000000a';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
update public.devices set status = 'active' where id = 'd0000000-0000-4000-8000-0000000000a2';

-- 9. Entitlement access: members only.
do $$ begin
  assert (public.business_entitlements('b0000000-0000-4000-8000-00000000000a') -> 'limits' ->> 'tills')::int = 2, 'starter 1 till + 1 add-on';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.business_entitlements('b0000000-0000-4000-8000-00000000000a');
    assert false, 'non-members must not read entitlements';
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;

-- 10. Lifecycle, overrides and the trial boundary (resolver evaluated at fixed instants).
do $$
declare
  t timestamptz := '2026-11-01 00:00:00+00';
  a constant uuid := 'b0000000-0000-4000-8000-00000000000a';
begin
  update public.subscriptions set plan_id = 'pro', status = 'trialing', trial_ends_at = t, addon_tills = 0 where business_id = a;
  assert public.entitlements_internal(a, t - interval '1 second') ->> 'access' = 'full', 'trial active before end';
  assert public.entitlements_internal(a, t) ->> 'access' = 'read_only', 'trial ends exactly at trial_ends_at';

  update public.subscriptions set status = 'past_due', grace_ends_at = t where business_id = a;
  assert public.entitlements_internal(a, t - interval '1 day') ->> 'access' = 'full', 'grace period keeps access';
  assert public.entitlements_internal(a, t) ->> 'access' = 'read_only', 'grace expiry is read-only';

  update public.subscriptions set status = 'canceled' where business_id = a;
  assert public.entitlements_internal(a, t - interval '1 day') ->> 'access' = 'read_only', 'canceled is read-only';

  update public.subscriptions set status = 'active', plan_id = 'starter' where business_id = a;
  insert into public.entitlement_overrides (business_id, features, max_tills, note) values (a, array['repairs'], 5, 'pilot deal');
  insert into public.entitlement_overrides (business_id, features, expires_at, note) values (a, array['loyalty'], t - interval '1 day', 'expired promo');
  assert public.entitlements_internal(a, t) -> 'features' ? 'repairs', 'override adds feature';
  assert not (public.entitlements_internal(a, t) -> 'features' ? 'loyalty'), 'expired override ignored';
  assert (public.entitlements_internal(a, t) -> 'limits' ->> 'tills')::int = 5, 'override replaces till limit';

  update public.subscriptions set plan_id = 'enterprise' where business_id = a;
  assert jsonb_typeof(public.entitlements_internal(a, t) -> 'limits' -> 'products') = 'null', 'enterprise products unlimited';
end $$;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:sql`
Expected: FAIL with `relation "public.subscriptions" does not exist`.

- [ ] **Step 3: Write `supabase/migrations/202610110012_plan_catalog_table.sql`**

```sql
-- Plan features and limits. Rows are generated from lib/billing/plans.ts by `npm run plans:sql`. A null limit means unlimited.
create table public.plan_catalog (
  id text primary key check (id ~ '^[a-z]+$'),
  features text[] not null default '{}',
  max_branches integer check (max_branches >= 0),
  max_tills integer check (max_tills >= 0),
  max_members integer check (max_members >= 0),
  max_products integer check (max_products >= 0)
);

alter table public.plan_catalog enable row level security;
create policy "signed-in users read plans" on public.plan_catalog for select to authenticated using (true);
```

- [ ] **Step 4: Write `supabase/migrations/202610110014_billing_entitlements.sql`**

```sql
-- Stage 1A: subscriptions, manual overrides, Stripe event log, the entitlement resolver and plan limits.

create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'canceled');

create table public.subscriptions (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  plan_id text not null references public.plan_catalog(id),
  status public.subscription_status not null,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  grace_ends_at timestamptz,
  addon_tills integer not null default 0 check (addon_tills >= 0),
  addon_branches integer not null default 0 check (addon_branches >= 0),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;
create policy "owners read their subscription" on public.subscriptions for select using (public.has_role(business_id, 'owner'));

create table public.entitlement_overrides (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  features text[] not null default '{}',
  max_branches integer check (max_branches >= 0),
  max_tills integer check (max_tills >= 0),
  max_members integer check (max_members >= 0),
  max_products integer check (max_products >= 0),
  expires_at timestamptz,
  note text not null check (char_length(note) between 1 and 500),
  created_at timestamptz not null default now()
);

create index entitlement_overrides_business_idx on public.entitlement_overrides (business_id);
alter table public.entitlement_overrides enable row level security;

create table public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;

-- Existing businesses start the same trial new businesses get.
insert into public.subscriptions (business_id, plan_id, status, trial_ends_at)
select id, 'pro', 'trialing', now() + interval '14 days' from public.businesses
on conflict (business_id) do nothing;

create function public.entitlements_internal(target_business_id uuid, at_time timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  sub public.subscriptions;
  plan public.plan_catalog;
  access text;
begin
  select * into sub from public.subscriptions where business_id = target_business_id;
  if not found then
    return jsonb_build_object(
      'planId', null, 'status', null, 'access', 'read_only', 'trialEndsAt', null, 'graceEndsAt', null,
      'features', '[]'::jsonb,
      'limits', jsonb_build_object('branches', 0, 'tills', 0, 'members', 0, 'products', 0)
    );
  end if;

  select * into plan from public.plan_catalog where id = sub.plan_id;

  access := case
    when sub.status = 'active' then 'full'
    when sub.status = 'trialing' and sub.trial_ends_at > at_time then 'full'
    when sub.status = 'past_due' and sub.grace_ends_at > at_time then 'full'
    else 'read_only'
  end;

  return jsonb_build_object(
    'planId', sub.plan_id,
    'status', sub.status,
    'access', access,
    'trialEndsAt', sub.trial_ends_at,
    'graceEndsAt', sub.grace_ends_at,
    'features', to_jsonb(array(
      select distinct feature from (
        select unnest(plan.features) as feature
        union all
        select unnest(o.features) from public.entitlement_overrides o
        where o.business_id = target_business_id and (o.expires_at is null or o.expires_at > at_time)
      ) granted
      order by feature
    )),
    'limits', jsonb_build_object(
      'branches', coalesce((select o.max_branches from public.entitlement_overrides o where o.business_id = target_business_id and o.max_branches is not null and (o.expires_at is null or o.expires_at > at_time) order by o.created_at desc limit 1), plan.max_branches) + sub.addon_branches,
      'tills', coalesce((select o.max_tills from public.entitlement_overrides o where o.business_id = target_business_id and o.max_tills is not null and (o.expires_at is null or o.expires_at > at_time) order by o.created_at desc limit 1), plan.max_tills) + sub.addon_tills,
      'members', coalesce((select o.max_members from public.entitlement_overrides o where o.business_id = target_business_id and o.max_members is not null and (o.expires_at is null or o.expires_at > at_time) order by o.created_at desc limit 1), plan.max_members),
      'products', coalesce((select o.max_products from public.entitlement_overrides o where o.business_id = target_business_id and o.max_products is not null and (o.expires_at is null or o.expires_at > at_time) order by o.created_at desc limit 1), plan.max_products)
    )
  );
end
$$;

revoke execute on function public.entitlements_internal(uuid, timestamptz) from public, anon, authenticated;

create function public.business_entitlements(target_business_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is not null and not public.has_role(target_business_id, 'cashier') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  return public.entitlements_internal(target_business_id, now());
end
$$;

revoke execute on function public.business_entitlements(uuid) from public, anon;
grant execute on function public.business_entitlements(uuid) to authenticated;

-- Blocks inserts and re-activations beyond the plan limit. Existing active rows are never touched.
create function public.enforce_plan_limit()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  limit_key text := tg_argv[0];
  limit_value jsonb;
  used integer;
begin
  if new.status::text <> 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status::text = 'active' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.business_id::text || ':' || limit_key, 0));
  limit_value := public.entitlements_internal(new.business_id) -> 'limits' -> limit_key;
  if limit_value is null or jsonb_typeof(limit_value) = 'null' then
    return new;
  end if;

  execute format('select count(*) from public.%I where business_id = $1 and status::text = ''active''', tg_table_name)
    into used using new.business_id;

  if used >= limit_value::integer then
    raise exception using errcode = 'P0001', message = 'plan_limit_reached', detail = limit_key;
  end if;
  return new;
end
$$;

create trigger devices_plan_limit before insert or update of status on public.devices for each row execute function public.enforce_plan_limit('tills');
create trigger branches_plan_limit before insert or update of status on public.branches for each row execute function public.enforce_plan_limit('branches');
create trigger business_members_plan_limit before insert or update of status on public.business_members for each row execute function public.enforce_plan_limit('members');
create trigger products_plan_limit before insert or update of status on public.products for each row execute function public.enforce_plan_limit('products');

-- The subscription must exist before the member and branch so their limit checks can resolve.
create or replace function public.bootstrap_business()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.subscriptions (business_id, plan_id, status, trial_ends_at)
  values (new.id, 'pro', 'trialing', now() + interval '14 days');
  insert into public.business_members (business_id, user_id, role) values (new.id, new.owner_id, 'owner');
  insert into public.branches (business_id, name, address, invoice_prefix, receipt_footer, is_main)
  values (new.id, 'Main branch', new.address, new.invoice_prefix, new.receipt_footer, true);
  return new;
end
$$;
```

- [ ] **Step 5: Apply and run the SQL tests**

With the owner's approval, run: `supabase db push`, then `npm run test:sql`.
Expected: `PASS supabase/tests/foundation_test.sql`.

- [ ] **Step 6: Run the whole suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all PASS, including "the database trial bootstrap uses the same plan and length" from Task 2.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/202610110012_plan_catalog_table.sql supabase/migrations/202610110014_billing_entitlements.sql supabase/tests/foundation_test.sql
git commit -m "feat(db): add subscriptions, entitlement resolver and plan limits"
```

---

### Task 6: Smoke-check the running app against the migrated test project

**Files:** none changed unless the check finds a regression.

- [ ] **Step 1:** Point `.env.local` at the **test** project and run `npm run dev`. Sign in with a test owner the owner provides or creates in that project. Never use production credentials.
- [ ] **Step 2:** Check each of these:
  - The setup flow (`/setup`) creates a business and a till. In the test project, a `subscriptions` row (`pro`, `trialing`), an owner member and a "Main branch" exist.
  - Settings → Save settings still updates the business (`PATCH /api/v1/business`).
  - Settings → Upload catalog still inserts products, and the inserted products get `tax_category = 'standard'`.
  - A sale synced through `/api/v1/sync` is stored with the device's `branch_id`.
- [ ] **Step 3:** If any check fails, write a failing test that reproduces it (SQL in `foundation_test.sql`, or a unit test), fix it, and commit with `fix(db): …`. Otherwise record "1A smoke check passed" in the PR description.

---

## Sub-plan 1A exit criteria

- `npm test`, `npm run typecheck`, `npm run lint` and `npm run test:sql` all pass.
- Migrations `202610110010`–`202610110014` apply cleanly to a copy of the current schema with existing data.
- Sub-plan 1B can rely on:
  - `business_entitlements(uuid)`
  - `has_role(uuid, member_role)`
  - `branches` and `branch_id`
  - `PLANS` and `FeatureKey`
  - `COUNTRY_PROFILES` and `formatMoney`
