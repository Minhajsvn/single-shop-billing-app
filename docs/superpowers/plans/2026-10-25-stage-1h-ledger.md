# SDD ledger — plan: docs/superpowers/plans/2026-10-25-stage-1h-admin.md
Spec: docs/superpowers/specs/2026-10-25-stage-1h-admin-design.md · branch stage-1h-admin · merge base 778072c (main) · plan commit 9de1c4e

## Pre-flight scan
| Tasks | Produces → consumes | Found |
|---|---|---|
| T1 → T3, T4, T5 | requireStaff, cronSecretMatches | consistent |
| T2 → T4 | admin_extend_trial / admin_give_extra_till / admin_end_extra_till + refusal codes | consistent |
| T3 ↔ T5 | T3's AdminShop.flags / openFlags read admin_billing_flags, which T5 creates | conflict — ruling P1 |
| T4 ↔ T5 | T4 lists a flag "looked at" route consuming T5's admin_mark_flag_seen | conflict — ruling P2 |
| T2 → T5 | migration numbering 0035 then 0036 | consistent |
| T1–T5 | each task's own tests vs its code | agree |
| T6 | smoke covers RF1–RF5 | agrees |

Pre-flight: Ruling P1: Task 3 ships the shop list and page without flags (no openFlags column, no flags section); Task 5 adds the flags table, the "Needs a look" badge/filter/count and the flags section — the table does not exist until Task 5 — cost if wrong: none; same end state
Pre-flight: Ruling P2: Task 4 ships the trial and extra-till actions only; the "Mark looked at" route and button move to Task 5 with admin_mark_flag_seen — cost if wrong: none
Task 1: Ruling: (I-2, plan-mandated) signed-out visitors on /admin are redirected to /login like any other path — the spec's §6 anti-goal (nobody off the allowlist can tell /admin exists) binds over the plan's "signed-out → 404"; signed-in non-staff still get the normal 404 — cost if wrong: signed-out probes see a login redirect (same as any page)
Task 1: Ruling: (I-1) a catch-all app/api/v1/[...path]/route.ts answers every method with the same 404 as adminNotFound(), and admin routes answer unsupported methods with adminNotFound(), so admin APIs are indistinguishable from missing ones — cost if wrong: none
Task 1: minor (deferred): requireStaff calls getUser up to 3 times per page (wrap in React cache()); no automated route test for requireStaff/ping; mark staff.ts server-only; AdminLayout name in the dev-only RSC payload
Task 1: fix round 1/5 (3 addressed, 0 open — catch-all + admin routes answer the identical 404 for every method; signed-out /admin → /login; staff.ts marked server-only; commits 562630b..3c815ae)
Task 1: minor (deferred): bare /api/v1 still returns Next's HTML 404 ([[...path]] would close it); server-only markers are comments, not enforced (the server-only package is not installed)
Task 1: complete (commits 9de1c4e..3c815ae, review clean)
Task 2: Ruling: (I-2) an extra till means "one more than the shop's current limit", not a stored number: entitlements_internal computes tills = coalesce(newest active manual max_tills override, plan max_tills) + 1 when an active extra_till override exists, + addon_tills; the extra_till row's max_tills becomes informational — a plan change (Pro trial → paid Starter, upgrade) or a manual override then stays correct — cost if wrong: none; matches the owner's "an extra till for a while"
Task 2: Ruling: (I-1) giving an extra till on a plan with no till limit (or no plan row) is refused with plan_has_no_till_limit — otherwise an audited no-op — cost if wrong: none
Task 2: minor (deferred): frozen now() in tests never exercises an override ending and a new one starting at the same instant; extend can set a date earlier than the current trial end; extra till allowed for read-only/canceled shops; plain index instead of partial; route must pass the signed-in staff id as p_actor (Task 4)
Task 2: fix round 1/5 (2 addressed, 0 open — extra till = one more than the current base (newest manual override or plan) + add-ons; unlimited plans refused with plan_has_no_till_limit; entitlements_internal redefined inside 0035, so 0036 stays free; commits 40434c6..e17fb8e)
Task 2: note: behaviour change — a manual till override is now the base and an extra till adds 1 on top (before, the newest override won)
Task 2: complete (commits 3c815ae..e17fb8e, review clean)
Task 3: minor (deferred): up to 50 entitlements RPCs + 50 getUserById per list page and a full listUsers scan per email search (pilot-scale; a single SQL function later); `_` not escaped in ilike; Auth lookup failures show as "—"/"unknown"; unexplained dashes when no subscription row
Task 3: Ruling: billingSummary keeps "· Starter starts …" for a trial with a card on file — in Stage 1 checkout only buys Starter; active and cancelling lines now use the real plan name — cost if wrong: one word once other plans are sold
Task 3: fix round 1/5 (3 addressed, 0 open — real plan name in the status line (also the owner Billing tab); page past the end clamps to the last page; email search limited to shop owners, capped at 200, ≥3 chars; commits 0f2669b..7587d7e)
Task 3: minor (deferred): no "narrow your search" hint past 200 owner matches; count and range are separate reads (race → empty page)
Task 3: complete (commits e17fb8e..7587d7e, review clean)
Task 4: minor (deferred): +7/+14 computed from a trial end read before the SQL lock — two tabs can last-write-win (pass days to SQL and add under the lock); no content-type/Origin check on admin POST/DELETE (SameSite=Lax cookies already block cross-site); no body size limit (staff-only); confirm preview can differ from the stored date and a 400 does not refresh the page; no upper bound on until; a missing shop on the trial route reads "Only trials can be extended."
Task 4: complete (commits 7587d7e..122533a, review clean)
Task 5: Ruling: two false-flag guards stand — a missing Stripe trial end counts only while our row is trialing, and when both sides are canceled only status is compared — otherwise every finished trial and every canceled shop would be flagged daily — cost if wrong: a real trial-end or period mismatch on a canceled shop goes unflagged
Task 5: Ruling: the billing-check route stays POST + x-admin-cron-secret (no GET); the schedule notes use GitHub Actions and Supabase pg_cron + pg_net instead of Vercel Cron (which only sends GET with a Bearer header) — keeps the route contract and avoids a state-changing GET — cost if wrong: Vercel users schedule it another way
Task 5: note: runBillingCheck also returns a failed count so a provider outage is not reported as a clean run
Task 5: Ruling: (I-1, load-bearing for Task 4's "Change the trial end in Stripe") apply_billing_event's subscription_changed stores Stripe's trial end in trial_ends_at while the Stripe status is trialing — otherwise a trial changed in Stripe never reaches access and the billing check reopens a flag daily — fixed in this task's fix round with a SQL test — cost if wrong: Stripe becomes the source of a card-on-file trial's end date (as the Task 4 copy already tells staff)
Task 5: minor (deferred): admin_billing_check_shops is capped by PostgREST db-max-rows (1000) and a single-shop run filters that list; sequential Stripe calls with no time budget or maxDuration; an account-wide Stripe failure fails every shop in turn; incomplete_expired/paused can still compare times; an open flag whose field now agrees has no hint; one more count query per /admin load
Task 5: fix round 1/5 (1 addressed, 0 open — subscription_changed stores Stripe's trial end while trialing; migration 202610250037; commits e6ce971..0e20090)
Task 5: minor (deferred): a trialing event with a past/shortened trialEnd is trusted as-is (Stripe is the source)
Task 5: complete (commits 122533a..0e20090, review clean)
Task 6: smoke: all checks pass (RF1 owner 404 on /admin and admin APIs, billing-check 401; RF2 unconfirmed allowlisted email refused / 404; search by owner email; RF5 expired trial extended → shop usable; RF3 extra till → third till, ended → till choice at next open; RF4 three runs → one flag, looked-at closes, next run reopens; cron wrong/missing → 401, right → 200, GET → 404; card-on-file trial and unlimited-plan extra till refused; audit rows right); no defects, no commits
Task 6: suites: npm test 306/306, test:sql PASS, lint 0, typecheck 0, test:rehearsal PASS (subagent); npm run build exit 0 (controller) — 1H smoke passed
Task 6: minor (deferred): /login ignores ?next= (pre-1H), so staff land on /setup and type /admin; admin date and note fields lack aria-labels
Task 6: complete (smoke only)
Final review: Opus reviewer, verdict ready to merge with fixes; 0 Critical, 3 Important, 3 Minor; Review Focus 1, 2, 4, 5 pass, 3 over-pauses
Final: Ruling: (I-3) the billing-check route answers adminNotFound() (404) when there is neither a staff session nor a matching cron secret, instead of 401 — spec §6 (nobody off the allowlist can tell the admin API exists) beats §8's 401, same as Task 1 I-2; schedulers only need a non-2xx; notes and tests updated — cost if wrong: a misconfigured scheduler sees 404 instead of 401
Final: Ruling: (I-2) choose_active_till lets the owner keep up to the shop's till limit (array of kept tills, checked against entitlements_internal in SQL; multi-select in the choose-till card) — an expiring extra till on Pro must leave 2 tills, not 1 — cost if wrong: none
Final: (I-1) owners must not read admin.* audit rows — enters the fix pass
Final: re-graded Minor 3 (notes must say to keep "Confirm email" on in the hosted project, or an unregistered allowlisted address becomes staff on sign-up) to Important — it decides who is staff — enters the fix pass
Final: minor (deferred): same-second out-of-order subscription_changed events can move a trial end backwards; admin_extend_trial accepts a date earlier than the current trial end; admin_billing_check_shops capped at 1000 rows (track before ~900 Stripe shops); aria-labels on the admin date/note fields
Final: fixed owner audit leak — owners see no admin.% rows (migration 202610250038); SQL 26g RED→GREEN
Final: fixed till choice — owners keep up to the till limit via choose_active_tills (migration 202610250039), multi-select card; SQL 26h RED→GREEN
Final: fixed billing-check route — refused callers get adminNotFound(); unit test RED→GREEN
Final: fixed hosted notes — keep Confirm email on; register staff before listing them; release migration list now covers 1G and 1H (0029–0039)
Final: suites after fix wave: test:sql PASS, npm test 310/310, typecheck 0, lint 0, test:rehearsal PASS; npm run build exit 0 (controller); re-review: all findings addressed, no new Critical/Important
Final: note: re-reviewer's GET-on-billing-check concern checked by the controller — GET/HEAD/PUT/PATCH/DELETE/OPTIONS already export adminNotFound
Final: minor (deferred): till choice reads the limit without locking the subscription (a choice racing an expiring extra till can use the old limit); ChooseTill keeps its first selection if the till list changes while open
