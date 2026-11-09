# Build ledger — plan: docs/superpowers/plans/2026-11-08-stage-2a-staff-and-pins.md

Spec: docs/superpowers/specs/2026-11-08-stage-2a-staff-and-pins-design.md
Worktree: .claude/worktrees/stage-2a-staff-pins (branch stage-2a-staff-pins, base aedabdb). Built natively in one session.
Env: local Supabase (supabase start), worktree-only .env.local with local keys; local test logins T2A_OWNER/CASHIER/MANAGER
seeded for browser checks (local auth only).

## Decisions taken during the build (differ from the plan)

1. **One operator RPC instead of redefining four sync functions (Task 3).** `apply_operator_sync` runs after each accepted
   record with the same payload, fills `operator_member_id` / `approved_by_member_id` (or the register `opened_*` /
   `closed_*` pair) only when still null, and never rejects. Copying ~250-line sync functions was the bigger risk.
   Cost if wrong: two RPCs per named record; a failure only leaves the names empty (logged by the route).
2. **PIN hashes hidden at the column level (migration 047).** Row security lets every member read their team, so the
   table grant now excludes `pin_hash` / `pin_salt`; only `staff_list()` (owner only) returns them. Not in the plan;
   found while wiring the snapshot.
3. **Register open is matched by the operation's entity id (migration 048).** `apply_register_sync` stores an opened
   session under the operation id, not the till's register id. Found in the browser check; `apply_operator_sync` now
   takes `p_entity_id`.
4. **Store actions read the operator from the operator session** and take only an optional approver argument, instead
   of an `actor` parameter on every call. Operator fields are sent only while the PIN lock is on.
5. **Managers edit products and stock only on the owner's signed-in till.** Catalogue sync accepts owner sessions only
   (`owns_business`), so a manager signed in on their own device stays read-only. Opening it to managers needs the
   product/stock sync functions changed — deferred.
6. **Own PIN route `PUT /api/v1/staff/me/pin`** added so members can set their PIN without the owner-only staff list.
7. **Approval dialog shows PIN pad only after picking an approver** (auto-picked when there is one); Switch key is F9.

## Deferred minors

- The till's local register copy loses the `opened_*` names after a snapshot refresh (the server snapshot does not
  return them). Records on the server are correct; only the local copy is affected.
- No unit test for `requestSchema` keeping the new optional member-id fields (covered end to end in the browser).
- "Last sale" in Settings → Staff reads the latest sale only, not register or refund activity.
- Starter shops see the lock settings as a Pro prompt; the plan's `FeatureGate` component was not reused (plain copy).

## Evidence

- `npm test` 398/398; `npm run test:sql` foundation + staff_pins PASS; typecheck clean apart from the known fresh-checkout
  `PageProps` errors (needs `.next/types`); lint clean.
- Browser (local Supabase, dev server): lock screen; wrong PIN shake; 5-try block with countdown; F9 and Switch; reload
  restores the operator; cashier navigation; register open and close, a 15% discount and a refund each required
  Omar's PIN and stored Aisha as operator and Omar as approver; Settings → Staff list, invite, set PIN, lock settings.
- `npm run build` passes.
- Offline production-build run (2026-11-09, `npm start`, local API gateway stopped to cut the server off): unlocked as
  Aisha, switched to Omar offline, Omar closed yesterday's register and opened today's without an approval prompt,
  switched back to Aisha and sold; three changes queued. With the server back and Sync now pressed, all synced: the sale
  names Aisha, the closed register names Omar as closer, the new register names Omar as opener, and no
  `sync.operator_unverified` rows were written. The disabled-member offline case is covered by the SQL tests (3b).
- The stale-register guard still blocks a sale when yesterday's register is open, with the PIN lock on.
