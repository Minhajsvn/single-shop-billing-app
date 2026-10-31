import { SITE_INFO } from "@/lib/site-info";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Contact | Shop Ledger UAE" };

export default function ContactPage() {
  return (
    <article className="public-doc">
      <h1 className="page-title">Contact</h1>
      <dl className="public-details">
        <dt>Business name</dt>
        <dd>{SITE_INFO.legalName}</dd>
        <dt>Registered address</dt>
        <dd>{SITE_INFO.address}</dd>
        <dt>Support email</dt>
        <dd>{SITE_INFO.email}</dd>
        <dt>Phone</dt>
        <dd>{SITE_INFO.phone}</dd>
      </dl>
    </article>
  );
}
