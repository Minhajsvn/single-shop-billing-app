# SDD ledger — plan: docs/superpowers/plans/2026-10-13-stage-1b-server-first-data.md

Spec: docs/superpowers/specs/2026-10-11-saas-plans-and-improvements-design.md
Prior: docs/superpowers/plans/2026-10-11-stage-1a-ledger.md (1A merged 28b54c6)
Branch: stage-1b-server-first (worktree .claude/worktrees/stage-1b-server-first), branched from c133f6d
Env: local Supabase running (Docker 29.8.2); worktree .env.local holds local-only values + generated ENTITLEMENT_SIGNING_SECRET (git-ignored). Baseline npm test 14/14.

## Pre-flight scan

| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1 ↔ 1A hotfix 202610100001 | T1 recreates sync RPCs via create-or-replace (resets search_path) | T1 Part B re-applies `public, extensions, pg_temp`; section 11 guards — consistent |
| T1 ↔ T6 | T1 reads `p_payload->>'deviceId'`; T6 puts deviceId in payload (customer: route merges into customer object) | consistent |
| T2 ↔ T6 | nextInvoiceNumber/nextCreditNoteNumber/dubaiSupplyDate | signatures match |
| T3 ↔ T6 | Entitlements, READ_ONLY_ENTITLEMENTS, token+expiresAt | consistent |
| T4 ↔ T5 ↔ T6 | ShopSnapshot.state is DemoState; mergeSnapshot(DemoState, DemoState) | consistent |
| T4 self | mapper has unused `deviceId` param with `void deviceId` | plan allows dropping it if lint complains — see R2 |
| T6 ↔ T7 | startHostedStore/startSampleStore/useShopContext/refreshSnapshot/getStoreMode; lib/device.ts | consistent |
| T7 self | sample mode must work when Supabase is configured, but server-side proxy.ts redirects every unauthenticated request to /login before AuthGate runs | conflict — see R1 |
| T8 self | needs two tills: Pro trial tills=2 ✓; third till blocked ✓ | consistent |

Ruling: R1 — T7 also modifies proxy.ts: when cookie `shop-ledger-mode=sample` is present, the proxy lets the request through without a user; startSampleStore() sets that cookie (path=/, SameSite=Lax, session cookie) and sign-in/hosted start clears it — plan's sessionStorage-only approach cannot pass the server-side redirect — if wrong: sample shop unreachable when Supabase is configured; small revert.
Ruling: R2 — T4 implementer may drop the unused `deviceId` param from mapSnapshotRows (signature becomes `(rows, generatedAt)`); T6 must then call it that way — plan explicitly allows it — if wrong: trivial signature fix.

## Progress
Ruling: R3 — keep implementer's added `set_config('request.jwt.claims','',true)` before SQL section 14 — without it the null-uid path is never reached (B's claims persist) — if wrong: one test line.
Task 1: implementer DONE 8664b79 (RED till_number missing → GREEN test:sql + rehearsal; npm test 14/14). Reviewing.
Task 1: complete (commits c133f6d..8664b79, review clean)
Task 1: minor (deferred): section 13 guard regex weak/negative-only — assert positive `sync_device_id(p_business_id, p_payload)` in all five + none `from public.devices`
Task 1: minor (deferred): no behavioural test that RPCs book to the payload device (Task 8 smoke covers it end-to-end)
Task 1: minor (deferred): fallback-order test decided by id tiebreak, not created_at
Task 1: minor (deferred): case-sensitive uuid text compare in sync_device_id (no index use)
Task 1: minor (deferred): trigger functions keep default EXECUTE (harmless)
Ruling: R4 — Task 1 minor #4 (owner can UPDATE devices.till_number via API → renumbering breaks "never renumber" and can collide invoice numbers) is FIXED in the final fix wave: BEFORE UPDATE trigger rejecting till_number changes ('till_number_immutable') + test — global constraint at stake, cheap — if wrong: one trigger.
Ruling: R5 — Task 1 minor #5 (queued fiscal ops from a since-revoked till fail with sync_device_invalid) — carried to Task 6/8 awareness and final review; proper handling (allow revoked-device fiscal docs or surface + admin path) decided in 1F/Stage 2 — if wrong: offline invoices from a revoked till need manual recovery.
Task 2: implementer DONE be33909 (6/6 new tests, npm test 20/20, lint clean; typecheck pre-existing PageProps errors only). Task review dispatch DENIED by auto-mode classifier — awaiting owner.
Task 2: complete (commits 8664b79..be33909, review clean)
Task 2: minor (deferred): escape test uses "A-B" which doesn't exercise escaping — use "S.K"; no tests for >9999, Dubai midnight boundary, year rollover, trailing-suffix rejection
Task 2: minor (deferred): `?? "00"` fabricates date parts silently; prefix not validated (empty/digit prefixes could collide)
Task 3: implementer DONE 4d94a20 (5/5 new, npm test 25/25, lint/build/typecheck clean). Reviewing.
Task 3: complete (commits be33909..4d94a20, review clean)
Ruling: R6 — token hardening minors (#1 require exactly 2 token segments, #2 non-finite expiresAt = expired + validate businessId string, #3 verifyEntitlements asserts secret) go into the final fix wave — cheap, security-relevant before 1F verifies server-side — if wrong: none.
Task 3: minor (deferred): trialEndsAt/graceEndsAt not ISO-validated; bad override feature string → parse throws → 503 (fails closed) — add check constraint on entitlement_overrides.features in 1H
Task 3: minor (deferred): missing-secret 503 before auth; no route test / extra-segment / 1ms-before-TTL tests
Task 3: note — reviewer #7 (business_entitlements null-uid bypass) already fixed by Task 1 migration 016 (fail-closed).
Task 3: minor (deferred): multi-business users get arbitrary business via limit(1) — revisit when members span businesses (Stage 2)
Task 4: implementer DONE 18a2d3a (npm test 31/31; R2 applied: mapSnapshotRows(rows, generatedAt)). Reviewing.
Task 4: review Needs fixes — C1 ambiguous PostgREST embeds (sale_items/credit_note_items have 2 FKs each: inline + 0004 composite) → route 502 for every shop; I1 PostgREST max_rows=1000 silently truncates snapshot lists; I2 credit note outside 90-day window gets invoiceNumber "".
Ruling: R7 — fix round 1 scope: C1 (FK hints, verified live), I1 (page each list with .range() until a short page), I2 (embed parent invoice_number via hinted FK and prefer it in mapper + test), plus cheap M1 (400 on present-but-invalid deviceId), M3 (membership query error → 502, not 404). Other minors deferred.
Task 4: fix round 1 committed 442b1c4 (C1 hints verified live 300 PGRST201→200; I1 paging; I2 embedded invoice ref + test; M1; M3). Re-reviewing.
Task 4: fix round 1/5 (5 addressed, 0 open; commits 18a2d3a..442b1c4)
Task 4: complete (commits 4d94a20..442b1c4, review clean after 1 fix round)
Task 4: minor (deferred): offset paging can skip/duplicate rows under concurrent writes; `as unknown as SnapshotRows` hides shape drift; paging untested (>1000 rows)
Task 4: minor (deferred): raw PostgREST error.message echoed in 502 bodies (schema detail) — log server-side, return generic
Task 4: minor (deferred): non-owner members get a hollow snapshot (owner-only read policies until Stage 2) — add explicit owner check or comment
Task 4: minor (deferred): embedded lines/cash movements unordered (no line ordinal column) — reprint line order may differ; add order for cash_movements
Task 4: minor (deferred): stock type mapping via replace("_","-") — use explicit map; snapshot refetches full 90 days each refresh (plan incremental `since`)
Task 5: implementer DONE 621b586 (7/7 new, npm test 39/39). Reviewing.
Task 5: complete (commits 442b1c4..621b586, review clean)
Ruling: R8 — Task 6 must serialize sync and snapshot refresh: one in-flight chain; every refresh records a sync epoch at request time and DISCARDS its response if a sync completed (epoch changed) after the request started; refresh runs only after a sync finishes — the snapshot's products and sales are read in separate queries, so an interleaved sync can double-decrement or drop a sale (review Important 1) — if wrong: transient wrong stock until next refresh.
Ruling: R9 — failed ops: sale/credit-note ops stay applied in the merge (issued fiscal docs are immutable and must stay visible); failed register and customer ops are kept for review but NO LONGER override server data (merge applies register/customer only when status is "pending"); also harden register merge to `local.register ?? merged.register`. Implemented in Task 6 with tests in tests/snapshot-merge.test.mjs — if wrong: a rejected register/customer edit shows server truth instead of local intent, still visible in outbox for retry.
Task 5: minor (deferred): pending sales/credit notes lose their local stock movements on refresh (history only, until synced)
Task 5: minor (deferred): addProduct with stock 0 queues no op → product vanishes on hosted refresh and never syncs — fix in 1D (catalogue) by syncing product creation regardless of stock
Task 5: minor (deferred): pending sales always placed first in lists; missing tests for credit-note branch, same-product double pending, register open→close, stock dedupe, failed-op stock effect, input non-mutation
Task 6: implementer dispatch DENIED by auto-mode classifier — awaiting owner.
Task 6: retry dispatch DENIED again (classifier reason: Data Exfiltration) — awaiting owner decision.
Executor switched to INLINE (executing-plans) for Tasks 6–8 at owner's request after repeated subagent-dispatch denials. BASE for Task 6: 621b586
Task 6: R9 merge change committed 8b57072 — 4 tests (3 RED→GREEN, failed-sale test passed pre-change by design); npm test 43/43
Task 6: Ruling: R10 — hosted localStorage cache EXCLUDES customers (PRD: locally cached customer data minimized + protected by device-bound Web Crypto key); customers are restored on hydrate from the existing encrypted IndexedDB copy (add decrypt/load in lib/offline-db.ts); persistOfflineSnapshot runs in hosted mode only (sample mode must not pollute the hosted IndexedDB) — brief silent; PRD binding — if wrong: offline reload briefly shows no customers until IndexedDB load resolves.
Task 6: Ruling: R11 — "unconfigured" mode (no Supabase env) keeps today's local demo behaviour (demo seed + STORE_KEY) so local dev without Supabase still works; module initial state is empty (not demo) whenever Supabase is configured, and SSR snapshot matches the mode — prevents a demo-data flash for hosted shops (Review Focus 5) — if wrong: unconfigured dev shows empty shop.
Task 6: Ruling: R12 — sync request zod schemas moved from the route into lib/sync/request-schema.ts (Next route files cannot export arbitrary names) so deviceId preservation and rpcPayloadFor are unit-tested; zod strips unknown keys, so deviceId had to be declared on every payload — if wrong: one file move.
Task 6: Ruling: R13 — refreshSnapshot returns {ok} | {ok:false,error} instead of Promise<void> (superset; startHostedStore needs the error); clearHostedStore() added for sign-out and refuses while unsynced ops exist; a snapshot from a different business never merges the cached local state — brief silent — if wrong: minor API reshaping in Task 7.
Task 6: complete (commits 621b586..57cbb94, tests: npm test → 53/53 pass; lint/build/typecheck clean; test:sql PASS)
Task 7: Ruling: R14 — sample-mode access decision extracted into lib/auth/access-rules.ts (routeDecision + SAMPLE_MODE_COOKIE shared by proxy.ts and the store) so R1 is unit-tested (6 tests); proxy.ts routes through it — if wrong: one helper.
Task 7: Ruling: R15 — AuthGate loads the shop once per mount (dashboard layout persists across navigations) instead of on every pathname change; sample mode renders children directly; sign-out refuses while unsynced ops exist (clearHostedStore) and clears the sample cookie — brief silent; avoids a full reload + spinner on every page and never discards unsynced fiscal work — if wrong: a manual reload is needed to pick up another tab's sign-out.
Task 7: complete (commits 57cbb94..a8e2cfa, tests: npm test → 59/59 pass; lint/typecheck/build clean)
Task 8: smoke steps 1–5 PASS (setup → no demo data, "Till 1"; product synced stock 10; till 1 sale SMK-1-261014-0001 booked to till 1, stock 8; till picker → "Counter 2" = till 2; SMK-2-261014-0001 booked to till 2, stock 7; per-till registers 100.00/50.00; 3rd till → "Your plan allows 2 tills…").
Task 8: FINDING — with the Supabase API unreachable, any full page load redirects to /login: proxy.ts treats a getUser() network failure as "signed out", so an outage logs every till out (breaks PRD limited-offline checkout; Review Focus 1). Pre-existing logic, surfaced by 1B smoke.
Task 8: Ruling: R16 — fix now: routeDecision gains `authUnavailable` + `hasSessionCookie`; when the auth server cannot be reached and the browser still holds a Supabase session cookie, the proxy lets the page through (client AuthGate uses the locally stored session + hosted cache; every API route and RLS still verify the user server-side) — offline checkout is a core requirement — if wrong: a revoked session could load the page shell during an outage, but cannot read or write any data.
Task 8: R16 fix committed 2c266cf (3 access-rule tests, 1 RED→GREEN; proxy reads AuthRetryableFetchError/5xx as auth-unavailable).
Task 8: smoke steps 6–8 PASS — outage (kong stopped): page loads from cache after ~15s, sale SMK-2-261014-0002 issued offline (server stock still 7); API restored → auto-synced exactly once (3 sales, stock 6) and still shown once in the app (stock 6); planted legacy demo blob → no SL-260830 invoices in hosted mode; sign-out allowed with 0 pending; "Try the sample shop" → sample banner + badge, no /api/v1 calls; "Leave sample" clears the cookie.
Task 8: minor (deferred): during an auth outage the AuthGate waits ~15s on supabase-js retries before using the cache — add a short timeout around getSession/business check
Task 8: minor (deferred): sale → invoice uses a full page reload (window.location.assign), which re-runs the slow outage start-up — 1C replaces it with the receipt panel
Task 8: minor (deferred): overview copy still says "invoices in demo ledger" in hosted mode
Task 8: minor (deferred): every full page load re-fetches snapshot + entitlements (no staleness window)
Task 8: complete (commits a8e2cfa..2c266cf, tests: npm test → 62/62 pass; test:sql PASS; test:rehearsal PASS; lint/typecheck/build clean; 8/8 smoke steps pass)
Final review (fresh opus reviewer): Ready after fixes — 2 Critical, 6 Important, 8 new Minor.
Final: Ruling: re-grade — C1 (sample mode survives sign-in → real sales go unsynced into demo store) and C2 (multi-till register totals include other tills → close rejected forever) stay Critical; I1 (hosted cache not scoped to user/business; can destroy or expose another business's unsynced fiscal ops), I2 (Leave sample deletes hosted cache incl. unsynced invoices), I3 (IndexedDB customers unscoped, never cleared, may resurface old demo customers), I6 (>50 queued ops blocks sync forever) stay Important and are FIXED in this pass, together with pledged R4 and R6.
Final: Ruling: I4 (client supplier snapshot stripped; server rebuilds supplier_snapshot from the business row at sync time) — NOT fixed in 1B: accepting a client-supplied supplier needs another full apply_sale_sync rewrite plus validation that cashiers cannot spoof the legal identity; deferred to 1E with a guard design (server keeps business-row snapshot; settings change warns when any till has unsynced sales) — cost if wrong: an offline sale synced after a legal-name/TRN/address edit reprints with the newer details.
Final: Ruling: I5 (two browsers choosing the same till collide on invoice numbers) — partial fix now: till picker warns that a till must be used by only one browser at a time and that numbering is per till; proper device claim/lock deferred to Stage 2 (staff + device management) — cost if wrong: a shop that deliberately runs one till number on two browsers gets a rejected invoice that needs manual handling.
Final: fixed C2 (multi-till register totals) — tests/register-totals.test.mjs "only this till's sales and refunds count toward its drawer" RED(module missing)→GREEN + snapshot-map "sales and credit notes keep the till that issued them" RED→GREEN; Sale/CreditNote.deviceId; commit 4e3bfce
Final: fixed I6 (>50 queued ops) — tests/hosted-store.test.mjs "sync batches respect the server's 50-operation limit" RED→GREEN; client posts oldest-first batches of 50 and keeps every batch's results; commit 4e3bfce; suite 69/69
Final: fixed R6 (token hardening) — tests/entitlements.test.mjs 3 R6 tests RED→GREEN (extra segments, short/empty secret on verify, non-finite expiry + non-string businessId); suite 72/72
Final: fixed R4 (till_number immutable) — foundation_test.sql section 16 RED ("till_number must be immutable") → GREEN via migration 202610150017; test:sql + rehearsal PASS
Final: Ruling: R17 — fix C1/I1/I2/I3 by scoping every hosted cache to the signed-in user id (localStorage key shop-ledger-hosted-store-v1:<userId>; IndexedDB snapshot/customers keys suffixed with the user id; legacy unscoped keys removed on start). AuthGate always checks the session when Supabase is configured: a session switches the store to hosted (startHostedStore(userId) clears sample mode); sample mode only renders when there is no session. Because caches are per user, sign-out no longer refuses while ops are pending: it keeps that user's cache (synced on their next sign-in) and only wipes it when nothing is pending — supersedes R15's sign-out refusal and removes the "failed ops block sign-out forever" minor — if wrong: a shared device retains a signed-out user's unsynced sales (customers excluded) until that user signs in again.
Final: fixed C1 (sample mode survived sign-in) — AuthGate always checks the session; startHostedStore(userId) leaves sample mode. Verified end-to-end (no unit seam: browser-only store): sample → Leave sample → client-side sign-in → real shop, Till 1, SMK-1-261015-0001, no sample banner. RED evidence = reviewer's trace of the pre-fix code path (not reproduced in browser before the fix).
Final: fixed C2 end-to-end — Till 2 expected cash 78.50 (excludes Till 1's 28.50); close accepted by server (till 2 closed, till 1 open; 3 register ops accepted).
Final: fixed I1/I2/I3 (R17) — per-user hosted cache key (hostedCacheKey unit-tested), per-user IndexedDB snapshot/customers, legacy unscoped keys removed on start, sample mode never touches hosted caches, sign-out keeps a user's unsynced work in their own cache and wipes it otherwise.
Final: fixed I5 (partial, per ruling) — till picker warns one browser per till; till picker now reports a failed load.
Final: suite after fix pass — npm test 72/72; test:sql PASS; test:rehearsal PASS; lint/typecheck/build clean.
Final: minor (deferred): client discards the signed entitlement token (keeps entitlements + expiresAt) — store it in 1F so the server can verify
Final: minor (deferred): R8 epoch check is redundant within a tab (serial queue already prevents overlap) — keep or remove for clarity
Final: minor (deferred): refreshEntitlements may drop fresh entitlements when the cache still names a previous business (fixed next start)
Final: minor (deferred): customer snapshots inside cached sales and pending customer ops still reach localStorage (R10 partial)
Final: minor (deferred): no auto-sync retry when the API recovers during a server-side outage (offline-runtime only re-runs on online/pending changes)
