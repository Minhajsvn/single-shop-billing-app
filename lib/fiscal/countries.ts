export type CountryCode = "AE" | "SA";
export type CurrencyCode = "AED" | "SAR";
export type TaxCategory = "standard" | "zero" | "exempt";

export type CountryProfile = {
  code: CountryCode;
  name: string;
  enabled: boolean;
  currency: CurrencyCode;
  minorUnitExponent: number;
  timezone: string;
  locale: string;
  standardVatRateBp: number;
  taxIdLabel: string;
  taxIdPattern: RegExp;
  invoiceTitle: { en: string; ar: string };
  simplifiedInvoiceTitle: { en: string; ar: string };
};

export const COUNTRY_PROFILES: Record<CountryCode, CountryProfile> = {
  AE: {
    code: "AE",
    name: "United Arab Emirates",
    enabled: true,
    currency: "AED",
    minorUnitExponent: 2,
    timezone: "Asia/Dubai",
    locale: "en-AE",
    standardVatRateBp: 500,
    taxIdLabel: "TRN",
    taxIdPattern: /^[0-9]{15}$/,
    invoiceTitle: { en: "Tax Invoice", ar: "فاتورة ضريبية" },
    simplifiedInvoiceTitle: { en: "Simplified Tax Invoice", ar: "فاتورة ضريبية مبسطة" },
  },
  SA: {
    code: "SA",
    name: "Saudi Arabia",
    enabled: false,
    currency: "SAR",
    minorUnitExponent: 2,
    timezone: "Asia/Riyadh",
    locale: "en-SA",
    standardVatRateBp: 1500,
    taxIdLabel: "VAT number",
    taxIdPattern: /^3[0-9]{13}3$/,
    invoiceTitle: { en: "Tax Invoice", ar: "فاتورة ضريبية" },
    simplifiedInvoiceTitle: { en: "Simplified Tax Invoice", ar: "فاتورة ضريبية مبسطة" },
  },
};

const CURRENCY_EXPONENT: Record<CurrencyCode, number> = { AED: 2, SAR: 2 };

export function getCountryProfile(code: string): CountryProfile {
  const profile = COUNTRY_PROFILES[code as CountryCode];
  if (!profile) throw new Error(`Unsupported country: ${code}`);
  return profile;
}

export function enabledCountries(): CountryProfile[] {
  return Object.values(COUNTRY_PROFILES).filter((profile) => profile.enabled);
}

export function isValidTaxId(country: CountryCode, value: string): boolean {
  return getCountryProfile(country).taxIdPattern.test(value);
}

export function vatRateFor(country: CountryCode, category: TaxCategory): number {
  return category === "standard" ? getCountryProfile(country).standardVatRateBp : 0;
}

export function splitVatInclusive(grossFils: number, rateBp: number) {
  if (!Number.isInteger(grossFils) || grossFils < 0) throw new RangeError("Gross amount must be a non-negative integer of minor units.");
  if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10000) throw new RangeError("VAT rate must be 0–10000 basis points.");
  const netFils = Math.round((grossFils * 10000) / (10000 + rateBp));
  return { netFils, vatFils: grossFils - netFils, grossFils };
}

export function formatMoney(minor: number, currency: CurrencyCode): string {
  const exponent = CURRENCY_EXPONENT[currency];
  const locale = currency === "SAR" ? "en-SA" : "en-AE";
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: exponent, maximumFractionDigits: exponent }).format(minor / 10 ** exponent);
}
