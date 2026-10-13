import assert from "node:assert/strict";
import test from "node:test";
import {
  COUNTRY_PROFILES,
  enabledCountries,
  formatMoney,
  getCountryProfile,
  isValidTaxId,
  splitVatInclusive,
  vatRateFor,
} from "../lib/fiscal/countries.ts";
import { calculateVatInclusive, formatAED } from "../lib/domain.ts";

test("only the UAE is enabled in Stage 1", () => {
  assert.deepEqual(enabledCountries().map((profile) => profile.code), ["AE"]);
  assert.equal(COUNTRY_PROFILES.SA.enabled, false);
});

test("country profiles carry currency, timezone and VAT rate", () => {
  assert.equal(getCountryProfile("AE").currency, "AED");
  assert.equal(getCountryProfile("AE").timezone, "Asia/Dubai");
  assert.equal(getCountryProfile("SA").standardVatRateBp, 1500);
  assert.throws(() => getCountryProfile("XX"), /Unsupported country/);
});

test("tax IDs are validated per country", () => {
  assert.equal(isValidTaxId("AE", "100123456700003"), true);
  assert.equal(isValidTaxId("AE", "10012345670000"), false);
  assert.equal(isValidTaxId("SA", "300000000000003"), true);
  assert.equal(isValidTaxId("SA", "100000000000003"), false);
});

test("zero-rated and exempt items carry no VAT", () => {
  assert.equal(vatRateFor("AE", "standard"), 500);
  assert.equal(vatRateFor("AE", "zero"), 0);
  assert.equal(vatRateFor("SA", "exempt"), 0);
});

test("VAT-inclusive split preserves every minor unit at any rate", () => {
  assert.deepEqual(splitVatInclusive(2850, 500), { netFils: 2714, vatFils: 136, grossFils: 2850 });
  assert.deepEqual(splitVatInclusive(11500, 1500), { netFils: 10000, vatFils: 1500, grossFils: 11500 });
  assert.deepEqual(splitVatInclusive(999, 0), { netFils: 999, vatFils: 0, grossFils: 999 });
  assert.throws(() => splitVatInclusive(10.5, 500), RangeError);
  assert.throws(() => splitVatInclusive(-1, 500), RangeError);
});

test("legacy helpers keep their UAE behaviour", () => {
  assert.deepEqual(calculateVatInclusive(5700), { netFils: 5429, vatFils: 271, grossFils: 5700 });
  assert.deepEqual(calculateVatInclusive(11500, 1500), { netFils: 10000, vatFils: 1500, grossFils: 11500 });
  assert.match(formatAED(2850), /AED\s?28\.50/);
  assert.match(formatMoney(4200, "SAR"), /42\.00/);
});
