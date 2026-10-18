import type { Customer, Sale } from "../domain.ts";

const digits = (text: string) => text.replace(/\D/g, "");

/** A UAE phone in one canonical form: digits only, without 00971/971 and the trunk 0. */
export function normalizePhone(text: string): string {
  return digits(text).replace(/^(00971|971)/, "").replace(/^0/, "");
}

/**
 * True when the query (at least 4 digits) appears in the phone, whatever the formatting: "+971 55 555 0198",
 * "0555550198" and "55-555-0198" are the same number. Raw digits are compared too, so "0198" finds "…0198".
 */
export function phoneMatches(query: string, phone: string | undefined): boolean {
  const queryDigits = digits(query);
  if (!phone || queryDigits.length < 4) return false;
  const normalisedQuery = normalizePhone(query);
  return (normalisedQuery.length >= 4 && normalizePhone(phone).includes(normalisedQuery)) || digits(phone).includes(queryDigits);
}

const contains = (value: string | undefined, term: string) => Boolean(value && value.toLowerCase().includes(term));

/** Sales are found by invoice number, customer name or customer phone. */
export function saleMatches(sale: Sale, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  return contains(sale.invoiceNumber, term) || contains(sale.customer?.name, term) || phoneMatches(term, sale.customer?.phone);
}

/** Customers are found by name, email, TRN or phone. */
export function customerMatches(customer: Customer, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  return contains(customer.name, term) || contains(customer.email, term) || contains(customer.trn, term) || phoneMatches(term, customer.phone);
}
