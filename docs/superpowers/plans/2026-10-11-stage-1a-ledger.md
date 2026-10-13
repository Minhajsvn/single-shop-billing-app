# SDD ledger — plan: docs/superpowers/plans/2026-10-11-stage-1-starter-launch.md

Spec: docs/superpowers/specs/2026-10-11-saas-plans-and-improvements-design.md
Branch: stage-1a-foundations (worktree .claude/worktrees/stage-1a-foundations), branched from 4183450
P1: done — owner approved committing WIP: c40f59f (sync RPCs), 4183450 (docs). supabase/.temp and .claude/launch.json left uncommitted.
P2: owner chose LOCAL Supabase (Docker) instead of a remote test project.

## Pre-flight scan

| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1 ↔ T2 | T1 adds allowImportingTsExtensions; T2 scripts/*.mjs import ../lib/billing/plans.ts | Compatible: .mjs under node strip-types needs no tsconfig change |
| T2 ↔ T5 | T2 test 5 regex reads 014 migration bootstrap insert | T5 migration text `values (new.id, 'pro', 'trialing', now() + interval '14 days')` matches regex; T2 step 6 expects that one failure until T5 — acknowledged in plan |
| T2 ↔ T5 | T2 generates 013 seed; T5 creates 012 table | Order 012→013→014 consistent |
| T3 ↔ T4 ↔ T5 | shared supabase/tests/foundation_test.sql, appended in order; role state at each boundary | T3 ends `reset role`; T4 section 5 runs as migration owner; T5 section 6 starts as owner — consistent |
| T3 ↔ T5 | bootstrap_business created in T3, replaced in T5 (subscription first) | Consistent; T3 tests run before limit triggers exist |
| T4 ↔ T5 | T4 section 5 inserts sale on device Till 1; T5 section 7 counts tills (Till 1 + Till 2) | Consistent: Pro trial tills=2 |
| T1 self | tests vs code | formatAED regex `/AED\s?28\.50/` vs Intl en-AE output — consistent with current UI "AED 28.50" |
| T2 self | tests vs code | consistent |
| T3 self | runner uses `node --env-file=.env.local`; worktree has no .env.local | See Ruling R2 |
| T3–T5 self | steps say `supabase db push` with owner approval to a remote test project | See Ruling R1 |
| T6 self | dev server against test project | Runs against local Supabase per R1 |

Ruling: R1 — DB tasks use local Supabase (`supabase init` if config.toml missing, `supabase start`, `supabase db reset` to apply migrations) and SUPABASE_TEST_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres, replacing every "supabase db push to the test project" step — owner chose local Supabase; no remote is touched — if wrong: tests would need re-running against a hosted project, no code change.
Ruling: R2 — worktree gets its own git-ignored .env.local holding local-Supabase values only (never copied from the main checkout) — keeps production keys out of the test path — if wrong: owner re-adds keys manually.
Ruling: R3 — Tasks 3–5 wait for Docker Desktop to be installed by the owner; Tasks 1–2 proceed now — Docker install is a system change outside the worktree — if wrong: none, only ordering.

## Progress
Task 1: complete (commits 4183450..e988907, review clean)
Task 1: minor (deferred): RangeError in splitVatInclusive can now throw from demo-store callers on fractional input (integer prices assumed)
Task 1: minor (deferred): getCountryProfile indexes with prototype keys ("toString") — use Object.hasOwn
Task 1: minor (deferred): minorUnitExponent duplicated in CountryProfile and CURRENCY_EXPONENT
Task 1: minor (deferred): typecheck on a fresh checkout needs .next/types (pre-existing PageProps errors)
Ruling: R4 — subagent commits carry a Co-Authored-By trailer naming the model that actually wrote them (e.g. Haiku 5.5) — accurate attribution — if wrong: trailers can be amended at squash/merge time.
Task 2: complete (commits e988907..a4e6150, review clean)
Task 2: minor (deferred): plans:sql --write with malformed timestamp silently prints to stdout and exits 0 (plan-mandated)
Task 2: minor (deferred): plans.test.mjs uses cwd-relative paths (only valid from repo root)
Task 2: minor (deferred): trial-bootstrap test regex is tied to exact SQL formatting of migration 014
Task 2: note — test 5 fails (ENOENT) until Task 5 by design
Setup: local Supabase (supabase init committed with Task 3; project_id single-shop-billing-app). Images cached. First start failed: 013 seed applied before plan_catalog table exists. Migrations 0001–0009 apply cleanly on a fresh DB.
Ruling: R5 — Task 3 also creates supabase/migrations/202610110012_plan_catalog_table.sql (verbatim from Task 5 Step 3) so every commit from Task 3 on applies cleanly with `supabase db reset`; Task 5 skips its Step 3 — plan defect: Task 2 committed a seed whose table only arrived in Task 5 — if wrong: none functionally, the table definition is unchanged; only which commit adds it moves.
Ruling: R6 — supabase/config.toml and supabase/.gitignore (from `supabase init`) are committed in Task 3 — local stack is the agreed test environment and needs them — if wrong: delete two files.
Ruling: R7 — Task 3 Important (plan-mandated): businesses update policy lets an owner reassign owner_id. Fix with a BEFORE UPDATE trigger on businesses that rejects any owner_id change (message 'owner_id_immutable'), rather than adding owner_id = auth.uid() to the policy (which would break future co-owners in Stage 2) — plus a SQL test; also strip the UTF-8 BOM added to package.json — spec requires RLS-safe tenancy; plan SQL was wrong — if wrong: ownership transfer later needs a dedicated security-definer RPC, which Stage 2 would add anyway.
Task 3: minor (deferred): historical-row backfill and sync-RPC inserts after NOT NULL branch_id not exercised by tests (db reset runs on empty DB)
Task 3: minor (deferred): unused test user C in section 1 fixture (used later by Task 4)
Task 3: minor (deferred): no negative role-ordering test (cashier/manager/disabled vs owner)
Task 3: minor (deferred): owner can unset is_main on main branch → rows without device/session get NULL branch_id → sync RPC inserts fail (guard in Stage 2)
Task 3: minor (deferred): main branch address/prefix/footer copied once and drift from businesses on settings edit — decide source of truth in 1B/1E
Task 3: minor (deferred): run-sql-tests.mjs — raw error when .env.local missing; only a message guards against prod URLs
Task 3: fix round 1/5 (2 addressed, 0 open — owner_id immutable trigger + test 3b; package.json BOM; commits 9a88129..84120b4)
Task 3: complete (commits a4e6150..84120b4, review clean after 1 fix round)
Task 3: minor (deferred): prevent_owner_change also blocks service-role owner_id changes — ownership transfer needs a dedicated RPC (Stage 2)
Task 4: complete (commits 84120b4..c5f11a3, review clean)
Task 4: minor (deferred): race — first sale and a concurrent country change can both commit (sale RPC does not lock business row FOR SHARE)
Task 4: minor (deferred): tax_category not yet wired into vat_rate_bp in sale/credit-note RPCs (credit note should copy original item rate) — must land before categories become editable (1D)
Task 4: minor (deferred): customer TRN checks still hard-code ^[0-9]{15}$, not per-country valid_tax_id
Task 4: minor (deferred): section 5 coverage gaps (profile check alone, single-field lock, non-locked update after sale, vat_rate_bp default/range)
Task 4: minor (deferred): valid_tax_id lacks set search_path / parallel safe (cosmetic)
Task 5: complete (commits c5f11a3..8952a3f, review clean)
Task 5: resolved ⚠️ — read_only access is reported but not enforced by limit triggers; enforcement (block new sales at next register open) belongs to sub-plan 1F per spec §3.2 — not a 1A gap.
Task 5: minor (deferred): business_entitlements fails open when auth.uid() is null (JWT without sub) — make fail-closed
Task 5: minor (deferred): override tie-break nondeterministic within one transaction (created_at = now())
Task 5: minor (deferred): overrides cannot express "unlimited"; add-ons stack on overrides (document)
Task 5: minor (deferred): subscriptions.updated_at never maintained
Task 5: minor (deferred): only tills limit trigger tested; branches/members/products, non-active insert at limit, entitlements_internal grant, backfill path untested; section 9 doesn't assert sqlerrm='forbidden'
Task 6: smoke — setup creates subscription(pro, trialing, 14d) + owner member + Main branch + device on main ✅; Settings save persists ✅; Upload catalog inserts 5 products with tax_category=standard ✅; sale sync REJECTED: "function digest(text, unknown) does not exist".
Task 6: root cause — PRE-EXISTING (not 1A): sync RPCs in 202609130006–202609140009 call digest() with search_path = public, pg_temp; pgcrypto is installed in schema `extensions` on Supabase → every sync op is rejected (likely also on hosted).
Ruling: R9 — fix on this branch via new migration 202610110015_sync_rpc_search_path.sql that ALTERs each sync RPC's search_path to `public, extensions, pg_temp` (no body rewrites), with a SQL test that a sync RPC can hash; then re-run the sale sync smoke — blocks Task 6 verification and is a production bug; smallest change — if wrong: revert one migration; owner must still push it to hosted.
Task 6: R9 fix committed 1c9e64b (migration 015 + test section 11; RED→GREEN; npm test 14/14). Task review of 1c9e64b NOT yet run — reviewer dispatch denied by auto-mode classifier; awaiting owner.
Task 6: smoke re-run after fix — sale sync accepted; sale/register/cash/stock rows on device's main branch; vat_rate_bp 500 ✅
Task 6: incident — clearing sb-* cookies on localhost:3101 also cleared the owner's localhost:3100 Supabase session (cookies are shared across ports); owner informed.
Task 6: fix review (1c9e64b) — Approved
Task 6: minor (deferred): section 11 asserts proconfig only, not a real digest()/RPC call; exact-string match brittle
Task 6: minor (deferred): future create-or-replace of a sync RPC with old search_path would regress (section 11 would catch)
Task 6: complete (commits 8952a3f..1c9e64b, review clean; smoke passed)
Final review: Ready after fixes (0 Critical, 3 Important, 5 new Minor). Triage: only backfill verification is must-fix among ledger minors.
Ruling: R10 — Important #1: add a repeatable backfill rehearsal (reset local DB to 202609140009, seed existing shops with devices/register/sales/credit notes/stock/cash rows, apply remaining migrations, assert no NULL branch_id, 1 owner/main branch/subscription per business, sync RPC still works) — unmet 1A exit criterion; highest prod risk — if wrong: only test code added.
Ruling: R11 — Important #3: rename 202610110015_sync_rpc_search_path.sql → 202610100001_sync_rpc_search_path.sql so the hotfix sorts after 0009 and before 010 and can be pushed to hosted alone — independent ALTER-only fix for a live bug — if wrong: rename back; content unchanged.
Ruling: R12 — Important #2 (trial clock for existing shops): no code change in 1A; migrations 010–014 must NOT be pushed to hosted until sub-plan 1F (billing) is live, at which point the owner decides how existing shops are treated (fresh trial vs active/override). Only the renamed sync hotfix may go to hosted earlier, with owner approval — trial start is a business decision and nothing reads entitlements until 1B — if wrong: owner wants an earlier push and the 014 backfill needs a launch-date trial_ends_at.
Ruling: R13 — new Minor (owner can move a branch to another business via branches UPDATE): fix now in 010 with a business_id-immutable trigger on branches + test — cheap and closes a Stage 2 hole before anything depends on it — if wrong: one trigger to drop.
Final review: deferred to 1B — Entitlements TS type for business_entitlements; fail-closed on null auth.uid(); SA business accepted by DB via direct PostgREST (setup must validate enabled countries); formatMoney ignores profile locale; push-window race (business created mid-014 push has no subscription) → push in quiet window + post-push check `select id from businesses except select business_id from subscriptions`.
Final fix wave: commits 1c9e64b..ecd45fc (3dc3583 rename hotfix → 202610100001; ddfa999 branches.business_id immutable + test 3c; ecd45fc backfill rehearsal `npm run test:rehearsal` PASS). Scoped re-review: all findings addressed, no new breakage.
Final: minor (deferred): test 3c exercises cross-tenant case (RLS) — add a two-business-owner case in Stage 2
Final: minor (deferred): rehearsal seed small — no lock-time/perf signal; push 010 in a quiet window
Final: minor (deferred): supabase/.temp/cli-latest is tracked and rewritten by every CLI run — git-ignore it
Final: note — implementer started Docker Desktop itself (local only)
