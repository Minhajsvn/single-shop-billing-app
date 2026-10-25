# SDD ledger — plan: docs/superpowers/plans/2026-10-21-stage-1g-onboarding.md
Spec: docs/superpowers/specs/2026-10-21-stage-1g-onboarding-design.md · branch stage-1g-onboarding · merge base 78afe02 (main) · plan commit 4cc2c50

## Pre-flight scan
| Tasks | Produces → consumes | Found |
|---|---|---|
| T1 → T5 | config.toml confirmations on; mail catcher; token-hash templates | consistent; ruling P1 (existing test/rehearsal accounts) |
| T2 → T3 | migration numbering 0029/0030 then 0031 | consistent (latest on main is 0028) |
| T2 → T4 | `find_sale_by_invoice`, member RLS, widened sync guards | consistent |
| T3 → T4 | both edit app-shell.tsx and demo-store.ts | sequential, no conflict |
| T2 ↔ 1F tests | 24d/24h write `paused` directly | T2 step 25f covers it |
| T1 | tests vs code | agrees |
| T2 | 25a–25f vs interfaces | agrees |
| T3 | checklistView tests vs copy | agrees |
| T4 | cashier "Settings only for the Data tab" vs 1F Data tab (sync, outbox, backup download) | agrees — backup download is read-only |
| T5 | smoke needs the cashier SQL line from T1's notes | agrees |

Pre-flight: Ruling P1: turning email confirmations on must not break test:sql / test:rehearsal / the smoke accounts — any account those scripts create is created confirmed (admin API `email_confirm: true` or direct auth.users rows with email_confirmed_at); Task 1 runs both suites — cost if wrong: a red suite caught in Task 1
Task 1: Ruling: accept the extra /setup heading change ("Set up your shop") — spec §4.2 asks for it; the brief's file list missed business-setup.tsx — cost if wrong: one heading
Task 1: minor (deferred): signupErrorMessage maps any error mentioning "password" to the 8-character rule (match code weak_password instead); /reset-password accepts any session, not only a recovery one (Supabase default secure_password_change=false); unconfirmed-sign-in resend starts without a cooldown
Task 1: fix round 1/5 (control-character/backslash redirect closed; 1 new open — dot-segment normalisation /.//evil.com → //evil.com; commits fedf974..9063530)
Task 1: fix round 2/5 (1 addressed, 0 open — dot segments, encoded dots and "//" after normalisation rejected; commits 9063530..d411c37)
Task 1: note: a re-review dispatch that listed explicit attack strings was refused by the auto-mode classifier; re-dispatched as a plain same-origin review of safeNext
Task 1: complete (commits 4cc2c50..d411c37, review clean)
Task 2: implemented inline by the controller (two subagent dispatches refused by the auto-mode classifier; user chose "build Task 2 yourself")
Task 2: Ruling: the four sync RPC guards are rewritten in place from their live definitions (pg_get_functiondef + replace, each check asserted exactly once) instead of copying ~900 lines — same effect as the brief's copy-and-change, far less drift risk — cost if wrong: a migration that fails loudly on reset
Task 2: Ruling: the till status guard keys on current_user (authenticated/anon) instead of a set_config flag in choose_active_till — every security-definer function passes, as the spec says, and 24d needs no change — cost if wrong: an admin-role direct write could still pause a till (admins only)
Task 2: Ruling: find_sale_by_invoice also returns the sale's credit notes (sale_item_id, quantity) so the refund view knows what is already refunded — Task 4 needs it — cost if wrong: one extra key
Task 2: Ruling: pre-existing defect fixed — apply_credit_note_sync's ambiguous sale_item_id meant no refund with lines could sync since 202610130016; fixed inside the same rewrite — cost if wrong: none; must be reported to the user (refunds made on hosted before this never reached the server)
Task 2: 24h fixture: forged paused till now inserted by the admin role (owners can no longer insert paused tills); assertions unchanged
Task 2: fix round 1/5 (2 addressed + 4 improvements, 0 open — real cash-movement and credit-note visibility tests; lookups audited; today's refunds visible; one function per name; paused→revoked allowed; commits cc0e0c2..e0efce9)
Task 2: open questions to the owner (not blocking): invoice numbers are guessable — audit-only vs also a per-hour lookup limit; paused tills cannot be un-paused (follow-up when upgrades are sold)
Task 2: minor (deferred): revoked→active is not locked (still limited by enforce_plan_limit on activation); lookup audit rows have no rate limit or retention; apply_credit_note_sync's returned-quantity check takes no lock (two concurrent refunds of one line can over-refund, pre-existing); register_session_open has no business check (UUID oracle only)
Task 2: complete (commits d411c37..e0efce9, review clean)
Task 3: note: the session left auto mode at the user's request after the classifier refused agent dispatches; reviews resumed in manual mode
Task 3: fix round 1/5 (1 addressed, 0 open — only active products complete step 1; indentation restored; commits 9c3f700..b0d9c18); 'inactive' is the archive status (product_status enum: active, inactive)
Task 3: minor (deferred): strip flags refresh only with a snapshot refresh (offline work ticks after sync); a billing banner appearing mid-visit resets the strip's local state; the "ready" transition and 1/2-of-3 states are unit-tested only, not browser-checked
Task 3: complete (commits e0efce9..b0d9c18, review clean)
Task 4: Ruling: owners get the same refund-by-invoice path as cashiers (RefundByInvoice shown to owners; useFoundSale on ?invoice= for any role) — otherwise an owner must sign in as a cashier to refund an old receipt; extends 1E's "older than 90 days is view-only" for the by-invoice path only; find_sale_by_invoice already admits owners — cost if wrong: owners can refund old sales by invoice number (as cashiers already can)
Task 4: minor (deferred): cashier credit notes on old sales show an empty invoice number in other browsers (nothing displays it today); local invoice match ignores case but the server match is exact; the invoice lookup cache never expires (a refund elsewhere fails on sync, server stays right); one-render flash of a hidden page before redirect; no unit test for createCreditNote counting server refunds; shift filter compares timestamp strings
Task 4: Ruling: managers get the cashier view — the spec defines only owner and cashier; manager is not used in Stage 1 — cost if wrong: a manager sees less than intended until staff roles are designed
Task 4: fix round 1/5 (1 addressed, 0 open — owners refund old sales by invoice number; by-id view stays view-only; commits adebf18..66d3bdd); the implementer was cut off once by a usage limit and resumed
Task 4: minor (deferred): ?invoice= is read after mount, so for one render neither lookup runs (possible brief not-found flash)
Task 4: complete (commits b0d9c18..66d3bdd, review clean)
Task 5: smoke: all 7 checks pass (signup + resend + token-hash link in a cookie-less tab → /setup; unconfirmed sign-in copy; duplicate email → check-email; checklist 0→3 → ready → gone; forgot/reset password; cashier till, sale, customer, refund of yesterday's sale by invoice, no Reports/past sales; owner REST insert of a paused till → 400 till_status_locked); no defects, no commits
Task 5: suites: npm test 240/240, test:sql PASS, lint 0, typecheck 0, test:rehearsal PASS (subagent); npm run build exit 0 (controller, dev server stopped) — 1G smoke passed
Task 5: minor (deferred, pre-existing, not 1G): Overview greeting is always "Good afternoon."; real shops see "N invoices in demo ledger"; a wrong password shows the raw "Invalid login credentials"
Task 5: complete (commits 66d3bdd..66d3bdd, smoke only)
Final review: Opus reviewer, verdict ready to merge with fixes; 0 Critical, 1 Important, 6 Minor; Review Focus 1-5 pass; nothing reaches a hosted project
Final: re-graded Minor 2 (concurrent refunds of one sale line can over-refund; cashiers on several tills can now refund any old sale) to Important — money paid out twice — enters the fix pass
Final: re-graded Minor 3 (invoice lookup is case-sensitive on the server, case-insensitive locally) to Important — the owner-decision-8 feature silently fails for a lowercase entry on a phone — enters the fix pass
Final: re-graded Minor 6 (hosted notes omit applying migrations 0029-0031 and the refund-sync history) to Important — the owner deploys from these notes — enters the fix pass
Final: minor (deferred): abandoned open shift keeps its old sales visible to cashiers (consider business_date >= yesterday); onboarding_status keeps running after all steps are done; weak-password mapping matches any "password" text; /reset-password accepts any session; revoked→active not locked; lookup audit has no rate limit; empty invoice number on cashier refunds in other browsers; lookup cache never expires; ?invoice= read after mount; no unit test for createCreditNote counting server refunds; pre-existing copy issues (greeting, "demo ledger", raw sign-in error)
Final: Ruling: declined-to-judge items stand — cashiers may edit customers (spec "add allowed" + existing Edit; owner may restrict later); managers get the cashier view (Task 4 ruling); guessable invoice numbers (open question to the owner); member_sees_sale per-row cost on owner snapshots not measured — cost if wrong: listed to the owner
Owner decisions (2026-10-22): the audit log is enough for staff invoice lookups (no rate limit); un-pausing can wait for plan upgrades but not for payment recovery or manual pauses → Task 6 added: owner Pause / Resume till on Settings → Tills, resume within the plan's till limit
Task 6: Ruling: a shop always keeps one active till (pausing the last active till is refused, last_active_till) — a shop with no selling till would be stuck at the till picker — cost if wrong: an owner who wants zero tills must revoke instead
Final: fixed two-membership shop choice — one helper (highest role, then oldest membership) used by every route; tests/membership.test.mjs RED→GREEN; notes: owner creates cashier accounts in the dashboard
Final: fixed concurrent over-refund — sale line locked before the quantity check (migration 202610220032); SQL RED→GREEN
Final: fixed case-insensitive invoice lookup (exact spelling first, then oldest; index on upper(invoice_number)); SQL RED→GREEN
Final: fixed hosted notes — migration list 202610190023..202610220032 with backup first; refunds before 0029 stayed on their till
Final: suites after fix wave: test:sql PASS, npm test 245/245, typecheck 0, lint 0, test:rehearsal PASS; re-review: all findings addressed, no new Critical/Important
Final: Ruling: "highest role first" stands for users in two shops — the opposite order would let anyone who adds an owner as a cashier elsewhere move that owner out of their own shop; a cashier who also owns a trial shop lands in their own shop (notes warn; use a separate account) — cost if wrong: such a cashier must use a second email
Final: minor (deferred): two refunds of one sale listing shared lines in opposite order can deadlock (one aborts and the till retries; no double refund) — lock the sale row once before the loop; no true concurrent test of the refund lock; chooseMembership falls back to row order on an unparseable created_at
Task 6: Ruling: the plan-limit message reads "1 till" / "2 tills" instead of the brief's literal "N till(s)" — same wording as the existing till chooser — cost if wrong: one string
Task 6: fix round 1/5 (1 addressed, 0 open — a paused till only finishes a shift opened within 72 h before the pause, so re-pausing cannot extend an old shift; migration 202610220034; commits a8b1a7d..1b4869b)
Task 6: minor (deferred): the one-active-till rule lives only in pause_till (an owner can still revoke the other active till directly); no warning when pausing this browser's own till; success toast shows even if the snapshot refresh fails; foreign-till test id may only prove "unknown id"; no concurrency test for the till lock; at the plan limit a direct status edit reports plan_limit_reached before till_status_locked
Task 6: complete (commits d4eba50..1b4869b, review clean)
