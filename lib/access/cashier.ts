import type { MemberRole } from "../snapshot/types.ts";

/** The signed-in member's role; null until the first snapshot says (nothing is blocked then — the server checks writes). */
export type Role = MemberRole | null;

export type NavLink = { href: string; label: string };

const SELLING_LINKS: NavLink[] = [
  { href: "/overview", label: "Overview" },
  { href: "/sale", label: "New sale" },
  { href: "/sales", label: "Sales" },
  { href: "/inventory", label: "Inventory" },
  { href: "/customers", label: "Customers" },
  { href: "/register", label: "Register" },
];

/** Pages a cashier (or manager) may open: selling, today's sales, read-only stock, customers, the register. */
const MEMBER_PAGES = ["/overview", "/sale", "/sales", "/inventory", "/customers", "/register"];
/** The one Settings tab a cashier uses: Sync now and the outbox. */
export const MEMBER_SETTINGS_TAB = "data";

/** Only the owner manages the shop; every other member gets the cashier's view (owner decision 7). */
export function isOwnerView(role: Role): boolean {
  return role === null || role === "owner";
}

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/** Whether this role may open the page; a cashier opening any other page by address goes to /overview. */
export function canUsePage(role: Role, pathname: string, tab?: string | null): boolean {
  if (isOwnerView(role)) return true;
  if (under(pathname, "/settings")) return tab == null || tab === "" || tab === MEMBER_SETTINGS_TAB;
  return MEMBER_PAGES.some((base) => under(pathname, base));
}

/** The navigation for this role, in sidebar order (Settings last). */
export function navLinksFor(role: Role): NavLink[] {
  return isOwnerView(role)
    ? [...SELLING_LINKS, { href: "/reports", label: "Reports" }, { href: "/settings", label: "Settings" }]
    : [...SELLING_LINKS, { href: `/settings?tab=${MEMBER_SETTINGS_TAB}`, label: "Settings" }];
}
