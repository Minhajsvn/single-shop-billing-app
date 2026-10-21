import { Archive, CashRegister, ChartBar, Gear, House, IdentificationCard, Receipt, ShoppingCart, type Icon } from "@phosphor-icons/react";

/** The icon for each page, by its path (a link's query, such as Settings' ?tab=data, is ignored). */
const NAV_ICONS: Record<string, Icon> = {
  "/overview": House, "/sale": ShoppingCart, "/sales": Receipt, "/inventory": Archive,
  "/customers": IdentificationCard, "/register": CashRegister, "/reports": ChartBar, "/settings": Gear,
};

export const pathOf = (href: string) => href.split("?")[0];
export const navIcon = (href: string): Icon => NAV_ICONS[pathOf(href)] ?? House;
