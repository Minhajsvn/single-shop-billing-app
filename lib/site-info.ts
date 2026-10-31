// The business details shown on the public pages and required by the payment provider.
// Replace every bracketed placeholder with the real value before going live: billing stays "not set up" until then.
export const SITE_INFO = {
  legalName: "[LEGAL BUSINESS NAME]",
  address: "[REGISTERED ADDRESS]",
  email: "[SUPPORT EMAIL]",
  phone: "[PHONE]",
};

export type SiteInfo = typeof SITE_INFO;

/** True when any value is still a [PLACEHOLDER] or empty. */
export function hasPlaceholders(info: SiteInfo = SITE_INFO): boolean {
  return Object.values(info).some((value) => value.trim() === "" || /^\[.+\]$/.test(value.trim()));
}
