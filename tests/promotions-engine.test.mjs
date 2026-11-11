import assert from "node:assert/strict";
import test from "node:test";
import { applyPromotions, splitWholeFils } from "../lib/promotions/engine.ts";
import { isLive } from "../lib/promotions/live.ts";

// Wednesday 2026-11-11 12:00 Dubai.
const NOW = new Date("2026-11-11T08:00:00Z");
let seq = 0;
const promo = (over) => ({
  id: `pr${++seq}`, name: over.name ?? `Promo ${seq}`, kind: "percent_off", targetType: "all", targetId: null,
  percent: null, amountFils: null, buyQty: null, getQty: null, bundlePriceFils: null, minBasketFils: null,
  startsOn: "2026-11-01", endsOn: null, days: null, fromTime: null, toTime: null, active: true, archived: false,
  createdAt: `2026-11-01T00:00:${String(seq).padStart(2, "0")}Z`, ...over,
});
const cola = (quantity, extra = {}) => ({ key: "cola", productId: "p-cola", categoryId: "c-drinks", name: "Cola", quantity, listUnitGrossFils: 600, ...extra });
const dates = (quantity, extra = {}) => ({ key: "dates", productId: "p-dates", categoryId: "c-food", name: "Dates", quantity, listUnitGrossFils: 3200, ...extra });
const total = (lines) => lines.reduce((sum, line) => sum + line.unitGrossFils * line.quantity, 0);
const wellFormed = (lines) => lines.every((line) => Number.isInteger(line.unitGrossFils) && line.unitGrossFils >= 1 && Number.isInteger(line.quantity) && line.quantity >= 1);

test("percent off a category", () => {
  const p = promo({ kind: "percent_off", targetType: "category", targetId: "c-drinks", percent: 10, name: "Drinks 10%" });
  const result = applyPromotions([cola(2)], [p], NOW);
  assert.deepEqual(result.lines.map((l) => [l.quantity, l.unitGrossFils, l.promotionId, l.promotionSavingFils]), [[2, 540, p.id, 120]]);
  assert.equal(result.savingFils, 120);
});

test("amount off never below 1 fils", () => {
  const p = promo({ kind: "amount_off", targetType: "product", targetId: "p-cola", amountFils: 1000 });
  const result = applyPromotions([cola(1)], [p], NOW);
  assert.equal(result.lines[0].unitGrossFils, 1);
});

test("best offer wins; a tie goes to the older one", () => {
  const pct = promo({ kind: "percent_off", targetType: "category", targetId: "c-drinks", percent: 10 });
  const multi = promo({ kind: "multi_buy_free", targetType: "product", targetId: "p-cola", buyQty: 2, getQty: 1 });
  assert.equal(applyPromotions([cola(3)], [pct, multi], NOW).lines[0].promotionId, multi.id);
  const older = promo({ kind: "amount_off", targetType: "all", amountFils: 100, createdAt: "2026-10-01T00:00:00Z" });
  const newer = promo({ kind: "amount_off", targetType: "product", targetId: "p-cola", amountFils: 100, createdAt: "2026-11-02T00:00:00Z" });
  assert.equal(applyPromotions([cola(1)], [newer, older], NOW).lines[0].promotionId, older.id);
});

test("multi-buy remainder pays list", () => {
  const p = promo({ kind: "multi_buy_free", targetType: "product", targetId: "p-cola", buyQty: 2, getQty: 1 });
  const result = applyPromotions([cola(4)], [p], NOW);
  assert.deepEqual(result.lines.map((l) => [l.quantity, l.unitGrossFils]), [[3, 400], [1, 600]]);
  assert.equal(total(result.lines), 1800);
  assert.equal(result.savingFils, 600);
  assert.equal(total(applyPromotions([cola(6)], [p], NOW).lines), 2400);
});

test("3 for AED 10 with a remainder", () => {
  const p = promo({ kind: "multi_buy_price", targetType: "product", targetId: "p-cola", buyQty: 3, bundlePriceFils: 1000 });
  const result = applyPromotions([cola(4)], [p], NOW);
  assert.equal(total(result.lines), 1000 + 600);
  assert.ok(wellFormed(result.lines));
  assert.deepEqual(result.lines.map((l) => l.quantity).reduce((a, b) => a + b), 4);
});

test("split keeps whole fils", () => {
  assert.deepEqual(splitWholeFils(2000, 3), [{ quantity: 2, unitGrossFils: 667 }, { quantity: 1, unitGrossFils: 666 }]);
  assert.deepEqual(splitWholeFils(1800, 3), [{ quantity: 3, unitGrossFils: 600 }]);
  const p = promo({ kind: "multi_buy_price", targetType: "product", targetId: "p-cola", buyQty: 3, bundlePriceFils: 2000 });
  const result = applyPromotions([{ ...cola(3), listUnitGrossFils: 700 }], [p], NOW);
  assert.deepEqual(result.lines.map((l) => [l.quantity, l.unitGrossFils]), [[2, 667], [1, 666]]);
  assert.equal(total(result.lines), 2000);
});

test("basket below, at and above its threshold; on top of item offers", () => {
  const basket = promo({ kind: "basket_percent", targetType: "all", percent: 5, minBasketFils: 20000 });
  assert.equal(applyPromotions([dates(4)], [basket], NOW).savingFils, 0); // 128.00 < 200.00
  const at = applyPromotions([dates(5), cola(5)], [basket], NOW); // 160.00 + 30.00 = 190.00 < 200 → none
  assert.equal(at.savingFils, 0);
  const above = applyPromotions([dates(5), { ...cola(10) }], [basket], NOW); // 160 + 60 = 220.00 → 11.00
  assert.equal(above.savingFils, 1100);
  assert.equal(total(above.lines), 22000 - 1100);
  assert.ok(wellFormed(above.lines));
  const itemOff = promo({ kind: "percent_off", targetType: "product", targetId: "p-dates", percent: 50 });
  const both = applyPromotions([dates(5), cola(10)], [basket, itemOff], NOW); // 80 + 60 = 140 < 200 → basket off
  assert.equal(both.savingFils, 8000);
  const exactly = applyPromotions([dates(5), cola(10), cola(10, { key: "cola2" })], [basket, itemOff], NOW); // 80+60+60 = 200 → 10.00
  assert.equal(exactly.savingFils, 8000 + 1000);
});

test("manual line keeps basket", () => {
  const pct = promo({ kind: "percent_off", targetType: "all", percent: 50 });
  const basket = promo({ kind: "basket_percent", targetType: "all", percent: 10, minBasketFils: 0 });
  const result = applyPromotions([dates(1, { manualUnitGrossFils: 3000 })], [pct, basket], NOW);
  assert.equal(total(result.lines), 2700); // manual 30.00, no 50% item offer, then 10% basket
  assert.equal(result.lines[0].promotionId, basket.id);
  assert.equal(result.lines[0].manual, true);
  assert.equal(result.lines[0].listUnitGrossFils, 3200);
});

test("custom items (no product) take no item offer but share the basket", () => {
  const pct = promo({ kind: "percent_off", targetType: "all", percent: 50 });
  const result = applyPromotions([{ key: "x", name: "Gift wrap", quantity: 1, listUnitGrossFils: 1000 }], [pct], NOW);
  assert.equal(total(result.lines), 1000);
});

test("category offer ignores an archived category (the cart passes no category)", () => {
  const p = promo({ kind: "percent_off", targetType: "category", targetId: "c-drinks", percent: 10 });
  assert.equal(applyPromotions([cola(1, { categoryId: null })], [p], NOW).savingFils, 0);
});

test("window crossing midnight belongs to its start day", () => {
  const p = promo({ days: [5], fromTime: "22:00", toTime: "02:00" });
  assert.equal(isLive(p, new Date("2026-11-13T19:00:00Z")), true); // Fri 23:00 Dubai
  assert.equal(isLive(p, new Date("2026-11-13T21:00:00Z")), true); // Sat 01:00 Dubai
  assert.equal(isLive(p, new Date("2026-11-13T23:00:00Z")), false); // Sat 03:00 Dubai
  assert.equal(isLive(p, new Date("2026-11-12T19:00:00Z")), false); // Thu 23:00 Dubai
});

test("days, dates, active and archived", () => {
  assert.equal(isLive(promo({ days: [5] }), new Date("2026-11-13T08:00:00Z")), true); // Friday
  assert.equal(isLive(promo({ days: [5] }), NOW), false); // Wednesday
  assert.equal(isLive(promo({ startsOn: "2026-11-12" }), NOW), false);
  assert.equal(isLive(promo({ endsOn: "2026-11-10" }), NOW), false);
  assert.equal(isLive(promo({ endsOn: "2026-11-11" }), NOW), true);
  assert.equal(isLive(promo({ active: false }), NOW), false);
  assert.equal(isLive(promo({ archived: true }), NOW), false);
  assert.equal(isLive(promo({ fromTime: "11:00", toTime: "13:00" }), NOW), true);
  assert.equal(isLive(promo({ fromTime: "13:00", toTime: "15:00" }), NOW), false);
});

test("pricing depends on now only", () => {
  const p = promo({ kind: "percent_off", percent: 10, fromTime: "11:00", toTime: "13:00" });
  assert.equal(applyPromotions([cola(1)], [p], NOW).savingFils, 60);
  assert.equal(applyPromotions([cola(1)], [p], new Date("2026-11-11T10:00:00Z")).savingFils, 0); // 14:00 Dubai
});

test("no promotions leaves the cart at list (or manual) price", () => {
  const result = applyPromotions([cola(2), dates(1, { manualUnitGrossFils: 3000 })], [], NOW);
  assert.deepEqual(result.lines.map((l) => [l.quantity, l.unitGrossFils, l.promotionId]), [[2, 600, undefined], [1, 3000, undefined]]);
  assert.equal(result.savingFils, 0);
});

test("Stage 2F: weighed lines take percent off and the basket offer, never AED off or multi-buys", () => {
  const loose = (key, gross, grams) => ({ key, productId: "p-loose", categoryId: "c-food", name: "Loose dates", quantity: 1, listUnitGrossFils: gross, weightGrams: grams, pricePerKgFils: 4000 });
  const percent = promo({ kind: "percent_off", targetType: "product", targetId: "p-loose", percent: 10 });
  assert.deepEqual(applyPromotions([loose("a", 3000, 750)], [percent], NOW).lines.map((l) => [l.unitGrossFils, l.weightGrams, l.pricePerKgFils]), [[2700, 750, 4000]]);
  const amount = promo({ kind: "amount_off", targetType: "product", targetId: "p-loose", amountFils: 500 });
  assert.equal(applyPromotions([loose("a", 3000, 750)], [amount], NOW).lines[0].unitGrossFils, 3000);
  const free = promo({ kind: "multi_buy_free", targetType: "product", targetId: "p-loose", buyQty: 1, getQty: 1 });
  const bundle = promo({ kind: "multi_buy_price", targetType: "all", buyQty: 2, bundlePriceFils: 1000 });
  assert.deepEqual(applyPromotions([loose("a", 3000, 750), loose("b", 2000, 500)], [free, bundle], NOW).lines.map((l) => l.unitGrossFils), [3000, 2000]);
  const basket = promo({ kind: "basket_percent", percent: 10, minBasketFils: 2000 });
  assert.equal(applyPromotions([loose("a", 3000, 750)], [basket], NOW).lines[0].unitGrossFils, 2700);
});
