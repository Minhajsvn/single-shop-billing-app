import { SITE_INFO } from "@/lib/site-info";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Contact | billo" };

export default function ContactPage() {
  return (
    <article className="public-doc">
      <h1 className="page-title">Contact</h1>
      <p className="page-copy">{SITE_INFO.brandName} is operated by {SITE_INFO.legalName} (sole proprietor).</p>
      <dl className="public-details">
        <dt>Brand</dt>
        <dd>{SITE_INFO.brandName}</dd>
        <dt>Legal name</dt>
        <dd>{SITE_INFO.legalName}</dd>
        <dt>Website</dt>
        <dd>{SITE_INFO.website}</dd>
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
