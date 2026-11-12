import assert from "node:assert/strict";
import test from "node:test";
import { describeTest, saveScaleLabel } from "../lib/weighing/client.ts";

const settings = { prefixes: ["21", "22"], codeLength: 5, value: "weight" };
const dates = { id: "d", name: "Medjool Dates", sku: "DAT", priceFils: 4000, stock: 5000, lowStockThreshold: 0, active: true, taxCategory: "standard", soldByWeight: true, scaleCode: 1234 };
const plain = (text) => text.replace(/\u00a0/g, " ");

test("the settings test box explains what a label would do", () => {
  assert.equal(plain(describeTest("2101234007501", settings, [dates])), "Item 01234 → Medjool Dates · 0.750 kg · AED 30.00");
  assert.equal(plain(describeTest("2101234030004", { ...settings, value: "price" }, [dates])), "Item 01234 → Medjool Dates · 0.750 kg · AED 30.00");
  assert.equal(describeTest("2101234007501", settings, []), "Item 01234 → no weighed product has this scale code");
  assert.equal(describeTest("2101234007509", settings, [dates]), "This label did not scan cleanly; scan again");
  assert.equal(describeTest("2301234007505", settings, [dates]), "Not a scale label for these settings");
  assert.equal(describeTest("2101234000007", settings, [dates]), "This label has no weight or price");
  assert.equal(describeTest("", settings, [dates]), "");
});

test("saving the setting maps the server's refusals", async () => {
  const reply = (status, body) => async () => new Response(JSON.stringify(body), { status });
  assert.deepEqual(await saveScaleLabel(settings, { fetch: reply(200, { ok: true }) }), { ok: true });
  assert.equal((await saveScaleLabel(settings, { fetch: reply(400, { code: "invalid_scale_label" }) })).error, "Check the prefixes (20–29) and item code length (4–6).");
  assert.equal((await saveScaleLabel(settings, { fetch: reply(400, { code: "feature_not_in_plan" }) })).error, "Scale labels are part of the Pro plan.");
  assert.equal((await saveScaleLabel(settings, { fetch: reply(403, { code: "not_owner" }) })).error, "Only the shop owner can change scale labels.");
  assert.equal((await saveScaleLabel(settings, { fetch: async () => { throw new Error("offline"); } })).error, "Scale label settings need a connection");
});
