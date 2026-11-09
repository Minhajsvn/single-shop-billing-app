// The business details shown on the public pages and required by the payment provider.
// Replace every bracketed placeholder with the real value before going live: billing stays "not set up" until then.
// legalName must match the Razorpay KYC exactly; brandName is the product people see.
export const SITE_INFO = {
  brandName: "billo",
  website: "billoae.com",
  legalName: "MOHAMMED MINHAJ",
  address: "mjcoode, Keralam, India",
  email: "support@billoae.com",
  phone: "+91 90728 39370",
};

export type SiteInfo = typeof SITE_INFO;

/** The public origin, used for canonical URLs, the sitemap and structured data. */
export const SITE_URL = "https://billoae.com";

/** True when any value is still a [PLACEHOLDER] or empty. */
export function hasPlaceholders(info: SiteInfo = SITE_INFO): boolean {
  return Object.values(info).some((value) => value.trim() === "" || /^\[.+\]$/.test(value.trim()));
}
