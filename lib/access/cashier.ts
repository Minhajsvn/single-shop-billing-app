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
/** Stage 2D/2E: a manager also records deliveries, runs promotions and sees the reports (the server checks each call). */
const MANAGER_PAGES = ["/purchases", "/promotions", "/reports"];
const PURCHASES_LINK: NavLink = { href: "/purchases", label: "Purchases" };
const PROMOTIONS_LINK: NavLink = { href: "/promotions", label: "Promotions" };

/** The selling links with Purchases and Promotions after Inventory. */
function withPurchases(links: NavLink[]): NavLink[] {
  return links.flatMap((link) => (link.href === "/inventory" ? [link, PURCHASES_LINK, PROMOTIONS_LINK] : [link]));
}
/** The one Settings tab a cashier uses: Sync now and the outbox. */
export const MEMBER_SETTINGS_TAB = "data";

/** Only the owner manages the shop; every other member gets the cashier's view (owner decision 7). */
export function isOwnerView(role: Role): boolean {
  return role === null || role === "owner";
}

/** Stage 2A: managers edit products and stock as well as the owner; cashiers see stock read-only. */
export function canEditCatalogue(role: Role): boolean {
  return role !== "cashier";
}

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/** Whether this role may open the page; a cashier opening any other page by address goes to /overview. */
export function canUsePage(role: Role, pathname: string, tab?: string | null): boolean {
  if (isOwnerView(role)) return true;
  if (under(pathname, "/settings")) return tab == null || tab === "" || tab === MEMBER_SETTINGS_TAB;
  if (role === "manager" && MANAGER_PAGES.some((base) => under(pathname, base))) return true;
  return MEMBER_PAGES.some((base) => under(pathname, base));
}

/** The navigation for this role, in sidebar order (Settings last). */
export function navLinksFor(role: Role): NavLink[] {
  const memberSettings = { href: `/settings?tab=${MEMBER_SETTINGS_TAB}`, label: "Settings" };
  if (isOwnerView(role)) return [...withPurchases(SELLING_LINKS), { href: "/reports", label: "Reports" }, { href: "/settings", label: "Settings" }];
  if (role === "manager") return [...withPurchases(SELLING_LINKS), { href: "/reports", label: "Reports" }, memberSettings];
  return [...SELLING_LINKS, memberSettings];
}
