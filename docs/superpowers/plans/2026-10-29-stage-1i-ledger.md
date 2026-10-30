# SDD ledger — plan: docs/superpowers/plans/2026-10-29-stage-1i-admin-grants-members.md

Spec: docs/superpowers/specs/2026-10-29-stage-1i-admin-grants-and-members-design.md
Worktree: C:\Users\Administrator\Projects\single-shop-billing-app-1i (branch stage-1i-admin-grants-members, base 29f6178)
Env: local Supabase (supabase start), worktree-only .env.local (local keys, PLATFORM_STAFF_EMAILS=staff@shopledger.test). Baseline: npm test 314/314, test:sql PASS.
Setup note: Docker engine was hung (WSL VM stopped); restarted Docker Desktop + wsl --shutdown. Local db container had NUL bytes at postgresql.conf:780 (crash leftover); stripped NULs via docker cp, data volume untouched.

## Pre-flight scan
| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1 -> T3 | entitlements keys grantPlanId, grantEndsAt; access full, accessEndsAt = grant ends_at | consistent; but T3 lists billingSummary/bannerFor/isGranted only, not lifecycleState (see Ruling 1) |
| T1 -> T4/T5/T7 | admin_grant_plan(p_business_id, p_plan_id, p_ends_at null=open, p_actor, p_note); admin_revoke_grant | parseGrantPlan until null -> p_ends_at null: consistent |
| T2 -> T5 | admin_member_lookup -> {"userId"}; admin_add_member/set_member_role/set_member_status/log_password_reset | addMember order lookup->invite->add matches; codes match T4 MESSAGES |
| T2 <-> T4 | refusal codes | plan_limit_reached raised by trigger and by lookup pre-check; T4 copy covers both |
| T3 <-> T5 | both touch nothing shared | none |
| T4 -> T7 | GRANTABLE_PLANS, parsers, copy | consistent |
| T5 -> T7 | routes grant (POST/DELETE), members (POST), members/[memberId] (PATCH), password-reset (POST) | consistent |
| T6 -> T7 | AdminShop.grant/members/membersAllowed, ShopList.counts | consistent |
| T1 self | tests 27a-27e vs migration 0040 | consistent |
| T2 self | tests 27f-27k vs migration 0041 | consistent |
| T3 self | tests vs files | lifecycleState gap (Ruling 1) |
| T4 self | tests vs parser list | consistent |
| T5 self | invite redirect next=/reset-password vs DEFAULT_NEXT.invite | consistent |
| T6 self | grantEndingSoon, sortMembers tests | consistent |
| T7 self | browser-only verification | acceptable (UI) |
| T8 self | docs + full suite | consistent |

Ruling 1: T3 also makes lifecycleState() return "full" while isGranted(e, now) — the spec says a grant gives full access "regardless of the subscription's status or dates", and client gating (canWrite, register open) reads lifecycleState; without it a granted shop whose subscription is trialing/expired would still be treated as trial/read-only on the till — cost if wrong: one extra branch in lifecycleState, easy to remove.

## Progress
Task 1: dispatched (BASE 29f6178, implementer sonnet)
Task 1: implementer DONE 4dc1815; review dispatched (review-29f6178..4dc1815.diff)
Task 1: warn items resolved by controller: test:sql PASS at 4dc1815 (so 27e audit deletes run as service_role inside the rolled-back test).
Task 1: minor (deferred): 27e revoke_note assertion uses >= 1, could be = 1.
Task 1: minor (deferred): p_actor not validated; bad actor surfaces as FK error 23503, not a coded refusal.
Task 1: minor (deferred): note_required checked before shop_not_found (refusal order).
Task 1: complete (commits 29f6178..4dc1815, review clean)
Task 2: dispatched (BASE 4dc1815, implementer sonnet)
Task 2: implementer DONE eb11e6f; review dispatched
Task 2: warn item resolved by controller: admin_clean_note comes from Task 1 migration 202610290040 (complete).
Task 2: minor (deferred): admin_add_member with unknown p_user_id surfaces FK 23503, not a coded refusal (routes resolve the id through lookup first).
Task 2: minor (deferred): set_member_role/status write an audit row even when the value is unchanged.
Task 2: minor (deferred): 27i "row stays disabled" check after a caught exception is weak evidence.
Task 2: minor (deferred): lookup limit 1 without order (emails unique, harmless).
Task 2: fix round 1/5 dispatched (re-enable bypasses member_of_other_shop [Important]; + 27j owner_protected no-audit assertion [Minor, folded in]); FIX_BASE eb11e6f
Task 2: fix round 1/5 (2 addressed, 0 open; commits eb11e6f..a16b54b)
Task 2: controller ran test:sql at a16b54b: PASS (fix report pasted no output lines).
Task 2: minor (deferred): one-active-shop check is check-then-act; concurrent add-in-Q + re-enable-in-P could both pass (needs partial unique index or advisory lock on user_id; same in admin_add_member).
Task 2: Ruling: migration 202610290041 edited in place during the fix round — it exists only on the local test DB (hosted DB has migrations through 202610250039, checked earlier) — cost if wrong: a DB that had applied the old version would lack the re-enable guard; re-check `supabase migration list` before release.
Task 2: complete (commits 4dc1815..a16b54b, review clean)
Task 3: dispatched (BASE a16b54b, implementer sonnet, Ruling 1 carried). Session paused at usage limit; on resume check git log for a Task 3 commit and task-3-report.md, then review.
Task 3: implementer DONE_WITH_CONCERNS b77276d (npm test 317 pass). Concern "2 PageProps typecheck errors" = worktree had no generated .next route types; controller ran `npx next typegen` -> tsc 0 errors. Not a Task 3 defect.
Task 3: review dispatched (review-a16b54b..b77276d.diff)
Task 3: warn item resolved: grantPlanId/grantEndsAt key names confirmed in Task 1 review (entitlements_internal returns both).
Task 3: minor (deferred): owner-session.ts parseEntitlements(ent) can throw on a malformed rpc payload (pretend guard is a server component -> 500); use safeParse -> 502.
Task 3: minor (deferred): bannerFor returns null before the stale check, so the stale-cache warning is hidden during a grant (untested).
Task 3: minor (deferred): billingSummary `|| "Starter"` fallback misleading for a grant plan without a PLANS entry (unreachable via zod enum).
Task 3: minor (deferred): no tests for grantEndsAt == now, unparseable grantEndsAt, loadOwnerBilling, checkout 409, panel hiding.
Task 3: minor (deferred): portal/pretend routes pay the extra business_entitlements rpc though only checkout uses `granted`.
Task 3: complete (commits a16b54b..b77276d, review clean)
Task 4: dispatched (BASE b77276d, implementer sonnet)
Task 4: implementer DONE 0a35f57 (323 pass); review dispatched
Task 4: Ruling: reviewer dispatch was denied by the auto-mode permission classifier; controller reviewed the diff (b77276d..0a35f57) itself against the brief — spec compliant (all 12 messages verbatim, GRANTABLE_PLANS, five parsers, email trim/lower-case + shape check, roles cashier|manager, note required, existing messages unchanged, file stays pure) — cost if wrong: one task without an independent reviewer; the final whole-branch review covers it.
Task 4: minor (deferred): parseMemberChange answers an invalid status (or both/neither fields) with role_not_allowed ("Choose cashier or manager."), misleading for a bad status.
Task 4: complete (commits b77276d..0a35f57, reviewed by controller)
Paused before Task 5: subagent dispatch blocked by permission classifier; asked user to allow agents or switch to native execution.
Resumed subagent-driven (user allowed agents). Task 5: dispatched (BASE 0a35f57, implementer sonnet)
Task 5: implementer DONE_WITH_CONCERNS 8c60a23 (334 pass); HTTP route flow not exercised locally (no shops in local DB) — Task 7 browser check must cover it; review dispatched
Task 5: Ruling: reviewer dispatch denied again by the auto-mode classifier (implementer dispatch was allowed); controller reviewed 0a35f57..8c60a23 itself — staff check first in every handler, uuid checks on shop and member ids, cross-shop member guard (memberInShop) on PATCH and password-reset, lookup→invite→add order with invite_failed before any insert, reset_failed writes no audit row, no links/tokens/passwords returned, unimplemented methods = adminNotFound, /auth/confirm accepts invite → /reset-password (which accepts any session) — cost if wrong: security-sensitive routes without an independent task reviewer; final whole-branch review must re-check them.
Task 5: minor (deferred): invite email heading is generic ("You're invited to Shop Ledger"), plan text said "You're invited to <shop> on Shop Ledger" (needs invite metadata + {{ .Data }}).
Task 5: minor (deferred): an invited auth user remains if admin_add_member is refused after the invite (limit race).
Task 5: minor (deferred): if admin_log_password_reset fails after the email was sent, the route reports failure though the email went out.
Task 5: minor (deferred): members/route.ts casts createAdminClient() to the helper's structural type (TS2589 workaround).
Task 5: minor (deferred): admin-staff.test.mjs checks new routes' 404 behaviour by reading route source text (route files import "@/"), not by calling handlers.
Task 5: HTTP flow (staff cookie -> routes -> real SQL) not exercised; Task 7 browser check must cover grant, add/invite, role, status, reset end to end.
Task 5: complete (commits 0a35f57..8c60a23, reviewed by controller)
Task 6: Ruling: ShopList.counts are platform-wide totals from a fixed number of count queries (shops, needsLook, trial = trialing without grant, granted = grant in force, paying = stripe sub active/past_due), not per page — spec 9.5 says no per-shop calls; KPI band reads as platform totals — cost if wrong: counts differ from the visible page, easy to scope later.
Task 6: dispatched (BASE 8c60a23, implementer sonnet)
Task 6: implementer DONE_WITH_CONCERNS a23869a (336 pass). Controller: tsc clean at 8c60a23, TS2589 at a23869a in members/[memberId]/route.ts:24 -> introduced by Task 6's changes; fix round 1 dispatched to Task 6 implementer.
Task 6: fix round 1/5 (TS2589 addressed: root cause members.ts AdminClientLike, now ReturnType<typeof createAdminClient>; commit 89e3b85; tsc 0, 336 pass)
Task 6: warn items resolved: plan_grants.granted_by is NOT NULL (Task 1 migration), so the null-granted_by lookup cannot happen; members limit comes from entitlements_internal, which applies a grant in force.
Task 6: minor (deferred): shopCounts id-list reads page by 1000, so query count grows past 1000 trialing/granted rows (constant only via RPC/embedded counts).
Task 6: minor (deferred): listShops runs shopCounts after needsLookCount (extra round trip), also on early-return search paths.
Task 6: minor (deferred): trial-minus-granted logic and grant/member mapping untested; grantEndingSoon at exactly 7 days / malformed date and sortMembers without owner / equal createdAt untested.
Task 6: minor (deferred): sortMembers comparator NaN on malformed createdAt (theoretical).
Task 6: complete (commits 8c60a23..89e3b85, review clean)
Task 7: Ruling: browser verification of Task 7 done by the controller (has the browser tools); implementer prepares local-only test accounts (staff, owner with Pro-trial shop, cashier) in git-ignored local-test-accounts.md — cost if wrong: none beyond who runs the check. Dispatched (BASE 89e3b85, implementer sonnet)
Task 7: controller browser check (worktree dev server :3200, local Supabase, local test accounts). PASS: login ?next=/admin lands on /admin; list KPI band 5 counts (shops 1, needs look 0, trial 1, granted 0, paying 0); shop page 9 panels; grant Business until revoked -> owner status "Business plan · provided by Shop Ledger", tills limit 7, activity row; add user " NewCashier@ShopLedger.test " -> invite in Mailpit to newcashier@shopledger.test, member row 3 of 20; Make manager / Disable / Enable / Send reset email all 200 with audit rows; owner Settings>Billing shows grant copy, no checkout/portal buttons, no banner; owner POST /api/v1/billing/checkout -> 409 exact copy; Starter grant with 3 tills -> owner register shows "Choose which tills stay … 2 tills" (Review Focus 2); no horizontal scroll at 360/1024/1920, light and dark.
Task 7: FAIL (Important): after a successful admin action the page does not refresh (grant, add user, role, status, reset all needed a manual reload to show the change).
Task 7: FAIL (Important): `.admin-table .badge, .admin-pills .badge, .admin-fields .badge { white-space: normal }` makes pills wrap mid-word (39px tall: "Own/er", "Acti/ve"); Members table header "STATUS" wraps at 1024px.
Task 7: fix round 1/5 dispatched (2 findings); FIX_BASE ebf4b16
Env note: docker CLI hung again during the check (containers kept serving); Starter switch for Review Focus 2 done via local PostgREST rpc admin_grant_plan with the local service-role key.
Task 7: fix round 1/5 (2 addressed, 0 open; commits ebf4b16..1e9e69d) — verified by controller in the browser after restarting the dev server: role change and grant revoke update the page without reload and close the dialog; all pills 24px; no horizontal scroll at 360/1024. Refresh cause per implementer: Next dev serverComponentsHmrCache (experimental.serverComponentsHmrCache: false in next.config.ts, dev only).
Task 7: implementer could not log in (auto mode refused it the local test password) — correct boundary; controller did all browser checks.
Task 7: code review dispatched (review-89e3b85..1e9e69d.diff)
Task 7: warn item resolved: page.tsx:67 paysThroughStripe = stripeSubscriptionId && status !== 'canceled' — same rule as SQL stripe_subscription_live.
Task 7: Ruling: Extend trial / Extra till / End extra till / Grant / Revoke stay inline forms (Add user and member actions are dialogs), deviating from spec 4.3 "actions open in the shared dialog style" — the 1H forms already worked inline with the required note and confirm step, and the owner's request was the look, not the interaction — cost if wrong: moving five inline forms into dialogs later (UI only).
Task 7: minor (deferred): busy not set during await requestConfirm, so Enter in the underlying form could open a second confirm.
Task 7: minor (deferred): dialogs lack focus trap / focus restore; Escape handled on backdrop only; prefer aria-labelledby.
Task 7: minor (deferred): status-pill tone derived from shopStatusText wording (startsWith/includes), untested.
Task 7: minor (deferred): dubaiToday duplicated (grant-panel, shop-actions); note/footer/send skeleton repeated across three components; fixed note ids.
Task 7: minor (deferred): inline style props (margin 0, fontSize 13, display contents) should be admin CSS classes.
Task 7: minor (deferred): endsInText uses new Date() at render (suppressHydrationWarning).
Task 7: minor (deferred): next.config.ts experimental.serverComponentsHmrCache: false needs a comment that it is dev-only and safe to remove.
Task 7: complete (commits 89e3b85..1e9e69d, 1 parked deviation via ruling)
Task 8: dispatched (BASE 1e9e69d, implementer haiku); worktree dev server stopped first to avoid build resource clash
Task 8: release notes, this ledger and the full suite run (commit docs: Stage 1I release notes and ledger)
Task 8: notes updated (migrations 0040/0041 listed; invite.html template step; cashier section points to admin console).
Task 8: docker was down; started Docker Desktop, `npx supabase start` ok before test:sql.
Task 8: npm test 336/336, typecheck, lint, build PASS; test:sql PASS; test:rehearsal run last (see report).
Task 8: complete pending rehearsal result.
