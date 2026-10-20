# SDD ledger — plan: docs/superpowers/plans/2026-10-19-stage-1f-billing.md
Spec: docs/superpowers/specs/2026-10-19-stage-1f-billing-design.md · branch stage-1f-billing · merge base ec87eca (main) · plan commit 799a956

## Pre-flight scan
| Tasks | Produces → consumes | Found |
|---|---|---|
| T1 → T5, T6, T8 | `annualPriceMinor`, `priceWithVat` | consistent |
| T2 → T3 | `access_ends_at(sub)` used by the register trigger | consistent; ruling P2 (volatility) |
| T2 → T4 | Entitlements `accessEndsAt`, `cancelAt`, `hasPaymentMethod`, `billingInterval` | consistent |
| T2 → T5, T6 | `BillingEvent` JSON → `apply_billing_event` | consistent (`status` carries Stripe statuses incl. `unpaid`) |
| T3 → T4, T7 | device status `paused`; `choose_active_till` | consistent; T4 must include paused devices in the snapshot (it says so) |
| T4 → T7, T8 | lifecycleState, bannerFor, registerOpenDecision, canWrite, billingSummary (T8 adds to the same file) | consistent |
| T5 → T6 | `applyBillingEvent`, `billingProvider`, `createAdminClient` | consistent |
| T1 | test vs code | agrees |
| T2 | tests 24a/24b vs transitions | agrees; ruling P1 |
| T3 | enum add + use in one migration | plan already allows a split (0024a/0024b) |
| T4 | trial line "≤ 4 days left" vs spec "from day 10" of 14 | agrees |
| T5 | tests vs routes | agrees |
| T6 | `cancel` then `renew` needs the cancel state | read from `subscriptions.cancel_at`; agrees |
| T7 | browser RED step instead of a unit RED | acceptable: UI wiring over Task 4's tested logic |
| T8 | billingSummary tests | agrees |
| T9 | smoke needs a cashier member | Task 7 creates it (local only) |

Pre-flight: Ruling P1: trialing with a null `trial_ends_at` has access end `-infinity` (read-only) — matches today's `entitlements_internal`, which needs `trial_ends_at > at_time` — cost if wrong: such rows (none exist; every business gets a trial date) would need an override.
Pre-flight: Ruling P2: `access_ends_at` is declared `stable`, not immutable — it reads only its argument but `-infinity`/interval arithmetic on timestamptz is not immutable-safe across settings — cost if wrong: none.
Task 1: ⚠️ resolved by controller: SUPABASE_SERVICE_ROLE_KEY present in .env.local (name check only); stripe 23.0.0 published 2026-10-01 (18 days old)
Task 1: minor (deferred): priceWithVat rounds through floating point (Math.round(minor*0.05)); an integer form would be robust for arbitrary amounts; no half-fil test case
Task 1: complete (commits 799a956..33fcfbc, review clean)
Task 2: Ruling: past_due with a null grace_ends_at has access end -infinity (read-only), not null — null would mean full access forever; matches P1 and 1A behaviour — cost if wrong: such a row (none expected; payment_failed always sets grace) needs an override
Task 2: Ruling: (plan-mandated I1) invoice_paid while trialing with trial_ends_at > now() only stores current_period_end and keeps the Pro trial — Stripe's $0 trial-start invoice must not end the trial; Task 5 still filters amount 0 as a second guard — cost if wrong: a paid non-zero invoice during the trial (should not happen with trial_end) would wait for the trial end
Task 2: Ruling: (I2) accessEndsAt in the entitlements JSON is always a parseable ISO instant or null; -infinity is emitted as 1970-01-01T00:00:00Z — the client compares it as a date — cost if wrong: none
Task 2: Ruling: (minor 3, load-bearing for Task 5) an event that resolves to no business is not kept in stripe_events, so a redelivery after checkout links the ids is applied; Task 5's webhook answers unknown_business with a non-2xx so Stripe retries — cost if wrong: a truly orphan event is retried by Stripe for up to 3 days
Task 2: minor (deferred): subscription_changed applied paths (trialing/active/past_due, grace-once second copy, cancel_at set/clear) and non-trial checkout_completed are untested
Task 2: minor (deferred): malformed event input raises (casts, unique violations) and rolls back — Task 5 should map these to a permanent 4xx
Task 2: minor (deferred): subscription_changed with Stripe status canceled/incomplete/incomplete_expired keeps the current status (undocumented)
Task 2: minor (deferred): no test that authenticated cannot execute access_ends_at
Task 2: note for Task 3: access_ends_at is revoked from authenticated, so the register_sessions trigger function must be security definer
Task 2: fix round 1/5 (3 addressed, 0 open — $0 trial invoice keeps the trial; accessEndsAt parseable; unknown-business events not recorded; commits 2b17d51..a531eb5)
Task 2: minor (deferred): the trial-invoice guard keys on local trial state, not the invoice amount; a real paid invoice during a still-running local trial would keep the trial (prevented by checkout's trial_end rule)
Task 2: complete (commits 33fcfbc..a531eb5, review clean)
Task 3: ⚠️ resolved: app/api/v1/sync/route.ts turns RPC errors into {status: rejected, error: message} (implementer verified; reviewer could not see it) — read_only / till_paused surface as rejected ops
Task 3: Ruling: (plan-mandated I1) the paused-till gate gets the same time rule as read-only: devices gain paused_at (set by choose_active_till); a session on a paused till is accepted when opened_at < paused_at and it arrives within 72 hours of paused_at — the spec's anti-goal (no sale refused mid-shift because of billing) binds over the plan's literal rule — cost if wrong: a paused till can sync a backdated shift for 72 hours
Task 3: Ruling: (minor 1, promoted for the same anti-goal) apply_sale_sync's implicit session uses coalesce(payload register.openedAt, now()) so a shift whose open op never reached the server is judged by when it really opened — cost if wrong: none; register: null keeps now()
Task 3: minor (deferred): the gate is not exercised through the implicit sessions of an adjustment or a close; no test that a missing subscription row is refused; no in-window backdated open test near the 72 h edge
Task 3: minor (deferred): choose_active_till writes no audit event
Task 3: note for Task 4: map-rows maps every non-active device status to revoked; Task 4 must map paused
Task 3: fix round 1/5 (2 addressed, 0 open — paused_at time rule; implicit sale session keeps openedAt; commits f199b65..d3a1dff)
Task 3: minor (deferred): re-reviewer believes apply_register_sync's implicit adjustment/close sessions use now(); controller's grep shows they pass register.openedAt (202610130016 lines 551-563, 602-614) — final review to confirm
Task 3: complete (commits a531eb5..d3a1dff, review clean)
Task 4: dispatch was interrupted by the user; the implementer finished and committed anyway (3495de9); user chose to resume — reviewed as is
Task 4: ⚠️ resolved: snapshot devices query has no status filter (route.ts:43), so paused devices are returned
Task 4: minor (deferred): Settings Tills tab shows any non-active till as a red Revoked badge; paused needs a Paused label (Task 7 till work)
Task 4: minor (deferred): singular "1 day" and the trial "ends today" wording are untested; no test for grace falling back to accessEndsAt or for choose_till with unlimited tills; role default for sample mode untested
Task 4: complete (commits d3a1dff..3495de9, review clean)
Task 5: Ruling: keep the implementer's extra 409 guard (checkout refused when a subscription id exists and status is not canceled) — prevents a second, separately charged Stripe subscription; a shop in grace or read-only after a failed payment fixes its card in the portal instead, so Task 8 shows Manage billing (not Choose a plan) whenever hasPaymentMethod and status is not canceled; Task 6's pretend flow lives with the same guard — cost if wrong: an owner whose subscription is stuck in a Stripe-only status (incomplete_expired) cannot re-checkout without support
Task 5: ⚠️ open: the live cashier → 403 check on checkout/portal is left for Task 7/9 (pure guard unit-tested)
Task 5: minor (deferred): no route-level webhook test locking the status contract; raw DB error text returned in 502 bodies (owner-session.ts); membership lookup limit(1) without ordering; checkout payment_status unpaid maps to active; return URLs built from request origin (proxy needs a site URL); unknown_business 409 retries for subscriptions created outside the app
Task 5: complete (commits 3495de9..dbec148, review clean)
Task 6: Ruling: pretend portal actions (cancel, fail renewal, end trial/grace, renew, update card) return to /settings?tab=billing&portal=return, not checkout=success — a "Payment received" toast after "Simulate failed renewal" would be false; Task 8 makes that change and refreshes entitlements on portal=return — cost if wrong: one URL param
Task 6: minor (deferred): pretend route ignores applyBillingEvent results (stale/duplicate still redirect as success); actions are not checked against current state (dev tool); route owner/404 behaviour, created-time ordering and end_trial date move are untested
Task 6: complete (commits dbec148..0367dc7, review clean)
Task 7: ⚠️ confirmed real gap (pre-existing, load-bearing): devices RLS is owner-only, so a hosted cashier sees no tills and is stuck at the till picker; owner decision 2 (everyone sees the banner) and the Task 9 cashier checks cannot work — enters the fix loop
Task 7: Ruling: add a migration with a select policy letting any active member (has_role(business_id, 'cashier'), which includes manager and owner) read their own business's devices; writes stay owner-only — cashiers must pick the till they work on; reading till names/numbers of one's own shop exposes nothing new — cost if wrong: cashiers can see their shop's till list
Task 7: incident: the implementer's first preview_start used the main checkout's .claude/launch.json and .env.local (hosted Supabase); one sign-in attempt with local test credentials failed on DNS before reaching any host; the server was stopped at once; later runs used this worktree — must be reported to the user
Task 7: minor (deferred): paused-till stop card offers Update card / Choose a plan though nothing above Starter is sold (drop the plan action there in Stage 1); choose-till toasts success even when the refresh fails; Open register dialog closes silently when the submit-time check flips to blocked (now ticks per minute); choose-till default selection can go stale; .choose-till-option uses white instead of a token
Task 7: fix round 1/5 (1 addressed, 0 open — members read their shop's tills; cashier browser check done, portal 403 for cashier; commits 9c6b5c9..7ed6efd)
Task 5: ⚠️ resolved in Task 7 fix round: cashier gets 403 from /api/v1/billing/portal in the browser
Task 7: minor (deferred): devices has an unused pin_hash column (never written anywhere) that members can now read row-wide; if PINs are ever stored, restrict that column (column grants or a view) before use
Task 7: complete (commits 0367dc7..7ed6efd, review clean)
Task 8: ⚠️ open: browser check not run (Terminal panel denied for the subagent) — moved into Task 9's smoke (tab visible for owner, hidden for cashier, pretend round trip, provider endpoint without sign-in)
Task 8: minor (deferred): buttons render before the provider kind is known (server 503s safely); "Payment received" toast even if the entitlement refresh fails; billingSummary untested for a null period end ("renews " trailing space) and a Dubai date rollover; no component test for button choice / param handling
Task 8: complete (commits 7ed6efd..8e78059, review clean)
Task 9: smoke (subagent, browser, local only): all 9 lifecycle checks pass plus Task 8 carry-overs (Billing tab owner-only, Payment received on checkout=success, portal=return without toast, provider endpoint anonymous {kind}); cashier 403 on checkout, portal and pretend
Task 9: defect fixed: active Starter showed "renews " with no date — entitlements now carry currentPeriodEnd (migration 202610200026); RED in npm test, test:sql and browser, GREEN after; reviewed clean
Task 9: Ruling: check 8 (offline more than 72 h) verified with an in-page stub (entitlements fetch rejected, clock 4 days ahead) instead of stopping Supabase — the decision logic is unit-tested in Task 4; this proves the wiring — cost if wrong: a real network outage path not exercised end to end
Task 9: suites: npm test 202/202, test:sql PASS, test:rehearsal PASS, lint clean, typecheck clean (subagent); npm run build exit 0 (controller, dev server stopped first) — 1F smoke passed
Task 9: note (pre-existing, outside 1F): cashiers cannot read sales or register_sessions (owner-only RLS), so a hosted cashier sees no sales and no open register; the cashier till picker offers "Register a new till" though only owners may add tills — needs its own stage
Task 9: complete (commits 8e78059..47c14df, review clean)
Final review: Opus reviewer, verdict ready to merge with fixes; 0 Critical, 3 Important (I1, I2, I3), 6 Minor; Review Focus 1-5 pass
Final: re-graded M3 (pretend provider runs when only some STRIPE_* variables are set) to Important — global constraint says the pretend provider runs only when Stripe keys are absent; a half-configured server would fake payments — enters the fix pass
Final: Ruling: I3 (a register that is never closed keeps selling after access ends) — the code stands: the spec's owner decision says an open register stays usable until it is closed, and capping it would make the client sell offline into sales the server later rejects (the §6 anti-goal); shops close daily and the existing stale-register warning applies — cost if wrong: an unpaid shop that never closes its register keeps selling; surfaced to the owner
Final: Ruling: declined-to-judge items stand as built — sales syncing more than 72 h after the access end are rejected (designer call 7, accepted at approval); product/customer writes are blocked in the UI only (spec requires UI); paying with under 48 h of trial left charges at once (Stripe minimum); double-click checkout race (Stripe Checkout sessions are idempotent per click only) — cost if wrong: listed to the owner
Final: minor (deferred): banner says "Sales are paused" while a shift is still open; failed first charge after a trial leaves plan_id pro through grace; no-cache first load is read-only until /entitlements answers; billing-panel repeats VAT arithmetic instead of priceWithVat; choose-till toasts success after a refresh error
Final: minor (deferred, before real Stripe): unknown-business 409 should be 200 for events with no business metadata (shared Stripe account); raw DB error text in 502 bodies; return URLs from request origin; pin_hash readable by members
Final: fixed I1 canceled is final — SQL 24g RED→GREEN (migration 202610200027), suites: test:sql PASS, npm test 203/203, rehearsal PASS, typecheck/lint clean
Final: fixed I2 paused_at server-stamped and never in the future — SQL 24h RED→GREEN (migration 202610200028)
Final: fixed M3 partial Stripe config → billing not set up — tests/billing-stripe RED (2 fail) → GREEN (23 pass); npm run build exit 0 after the fix wave (controller)
Final: re-review: all findings addressed, no new Critical/Important breakage
Final: Ruling: residual till-limit path (an owner inserts a till already paused via direct API writes, then syncs a register open backdated just before the stamp, within 72 h; the shift then sells indefinitely) — parked, not fixed in this branch: it needs deliberate hand-crafted API calls by the paying owner against their own plan (no data exposure to anyone else), and there is no second fix wave; suggested follow-up: tills inserted already paused get no grace window, and/or cap backdating on paused tills — cost if wrong: a determined owner can run extra tills on Starter until fixed
Final: minor (deferred): 24g accepts stale or applied for late invoice_paid/subscription_changed instead of asserting stale; optional hardening — ignore non-checkout events whose subscriptionId differs from the stored one
