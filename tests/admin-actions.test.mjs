import assert from "node:assert/strict";
import test from "node:test";
import { NOTE_MAX, adminErrorMessage, parseEndExtraTill, parseExtendTrial, parseExtraTill, parseFlagSeen, refusalMessage } from "../lib/admin/actions.ts";

const now = new Date("2026-10-25T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

test("+7 / +14 days count from now when the trial has already ended", () => {
  const ended = "2026-10-20T10:00:00Z";
  assert.deepEqual(parseExtendTrial({ days: 7, note: "Asked for more time" }, now, ended), { ok: true, until: iso(now.getTime() + 7 * DAY), note: "Asked for more time" });
  assert.deepEqual(parseExtendTrial({ days: 14, note: "x" }, now, null), { ok: true, until: iso(now.getTime() + 14 * DAY), note: "x" });
});

test("+7 days counts from the current trial end when it is still in the future", () => {
  const end = "2026-10-30T10:00:00Z";
  const result = parseExtendTrial({ days: 7, note: "x" }, now, end);
  assert.deepEqual(result, { ok: true, until: iso(Date.parse(end) + 7 * DAY), note: "x" });
});

test("only 7 or 14 days are quick choices", () => {
  assert.equal(parseExtendTrial({ days: 30, note: "x" }, now, null).ok, false);
  assert.equal(parseExtendTrial({ days: "7", note: "x" }, now, null).ok, false);
});

test("a chosen trial end must be a future date", () => {
  assert.deepEqual(parseExtendTrial({ until: "2026-11-05T08:00:00.000Z", note: "x" }, now, null), { ok: true, until: "2026-11-05T08:00:00.000Z", note: "x" });
  assert.deepEqual(parseExtendTrial({ until: "2026-10-24T10:00:00Z", note: "x" }, now, null), { ok: false, error: "Choose a trial end in the future." });
  assert.deepEqual(parseExtendTrial({ until: "2026-10-25T10:00:00Z", note: "x" }, now, null), { ok: false, error: "Choose a trial end in the future." });
  assert.equal(parseExtendTrial({ until: "next week", note: "x" }, now, null).ok, false);
  assert.equal(parseExtendTrial({ note: "x" }, now, null).ok, false);
});

test("a date-only end means the end of that day in Dubai", () => {
  assert.deepEqual(parseExtendTrial({ until: "2026-11-05", note: "x" }, now, null), { ok: true, until: "2026-11-05T19:59:59.999Z", note: "x" });
  assert.deepEqual(parseExtraTill({ until: "2026-10-25", note: "x" }, now), { ok: true, until: "2026-10-25T19:59:59.999Z", note: "x" });
  assert.equal(parseExtraTill({ until: "2026-10-24", note: "x" }, now).ok, false);
  assert.equal(parseExtraTill({ until: "2026-02-30", note: "x" }, now).ok, false);
});

test("a note is required, trimmed, and at most 500 characters", () => {
  const noteError = { ok: false, error: "Write a note of up to 500 characters." };
  assert.equal(NOTE_MAX, 500);
  assert.deepEqual(parseExtendTrial({ days: 7 }, now, null), noteError);
  assert.deepEqual(parseExtendTrial({ days: 7, note: "   " }, now, null), noteError);
  assert.deepEqual(parseExtendTrial({ days: 7, note: "a".repeat(501) }, now, null), noteError);
  assert.equal(parseExtendTrial({ days: 7, note: "a".repeat(500) }, now, null).ok, true);
  assert.equal(parseExtendTrial({ days: 7, note: "  ok  " }, now, null).note, "ok");
  assert.deepEqual(parseExtraTill({ until: "2026-11-05T08:00:00Z" }, now), noteError);
  assert.deepEqual(parseEndExtraTill({ note: "" }), noteError);
  assert.deepEqual(parseEndExtraTill({ note: " Shop asked " }), { ok: true, note: "Shop asked" });
});

test("an extra till needs a future end date", () => {
  assert.deepEqual(parseExtraTill({ until: "2026-12-01T00:00:00.000Z", note: "Busy season" }, now), { ok: true, until: "2026-12-01T00:00:00.000Z", note: "Busy season" });
  assert.deepEqual(parseExtraTill({ until: "2026-10-01T00:00:00Z", note: "x" }, now), { ok: false, error: "Choose an end date in the future." });
  assert.deepEqual(parseExtraTill({ note: "x" }, now), { ok: false, error: "Choose an end date in the future." });
});

test("bodies that are not objects are refused", () => {
  for (const body of [null, undefined, "x", 7, []]) {
    assert.equal(parseExtendTrial(body, now, null).ok, false);
    assert.equal(parseExtraTill(body, now).ok, false);
    assert.equal(parseEndExtraTill(body).ok, false);
  }
});

test("every refusal code has plain words", () => {
  assert.equal(adminErrorMessage("trial_has_card"), "Change the trial end in Stripe.");
  assert.equal(adminErrorMessage("not_trialing"), "Only trials can be extended.");
  assert.equal(adminErrorMessage("end_not_in_future"), "Choose a trial end in the future.");
  assert.equal(adminErrorMessage("note_required"), "Write a note of up to 500 characters.");
  assert.equal(adminErrorMessage("until_not_in_future"), "Choose an end date in the future.");
  assert.equal(adminErrorMessage("no_extra_till"), "This shop has no extra till to end.");
  assert.equal(adminErrorMessage("shop_not_found"), "This shop no longer exists.");
  assert.equal(adminErrorMessage("plan_has_no_till_limit"), "This plan has no till limit, so an extra till is not needed.");
  assert.equal(adminErrorMessage("something_else"), "That did not work. Try again.");
});

test("refusalMessage reads only known refusal codes from a database error", () => {
  assert.deepEqual(refusalMessage({ code: "P0001", message: "trial_has_card" }), { known: true, message: "Change the trial end in Stripe." });
  assert.deepEqual(refusalMessage({ code: "P0001", message: "who knows" }), { known: false, message: "That did not work. Try again." });
  assert.deepEqual(refusalMessage({ code: "42501", message: "not_trialing" }), { known: false, message: "That did not work. Try again." });
  assert.deepEqual(refusalMessage(null), { known: false, message: "That did not work. Try again." });
});

test("marking a flag looked at needs a note; flag refusals have plain words", () => {
  assert.deepEqual(parseFlagSeen({ note: "  Checked in Stripe " }), { ok: true, note: "Checked in Stripe" });
  assert.deepEqual(parseFlagSeen({ note: "" }), { ok: false, error: "Write a note of up to 500 characters." });
  assert.deepEqual(parseFlagSeen(null), { ok: false, error: "Write a note of up to 500 characters." });
  assert.equal(adminErrorMessage("flag_not_found"), "This flag no longer exists.");
  assert.equal(adminErrorMessage("flag_already_seen"), "This flag was already marked looked at.");
});
