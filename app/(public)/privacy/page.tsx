import { SITE_INFO } from "@/lib/site-info";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy policy | billo" };

export default function PrivacyPage() {
  return (
    <article className="public-doc">
      <h1 className="page-title">Privacy policy</h1>
      <p className="page-copy">How {SITE_INFO.legalName} handles the information in billo.</p>

      <h2>What we store</h2>
      <p>Your account (name, email address and a hashed password), your shop details and settings, and the records you enter: products, stock, customers, sales, invoices and cash register entries.</p>

      <h2>Why</h2>
      <p>To run the service for your shop: sign you in, keep your records, sync your tills, and show your reports. We do not sell your data.</p>

      <h2>Where</h2>
      <p>Records are stored with Supabase, our database and sign-in provider. A copy of the data you use is also kept in your browser so the till can work offline.</p>

      <h2>Payments</h2>
      <p>Payments are processed by Razorpay. Card details are entered on Razorpay&apos;s pages. billo never sees or stores your card number.</p>

      <h2>Deleting your data</h2>
      <p>To ask for your account and shop data to be deleted, email {SITE_INFO.email} from the address on the account. See also <Link href="/contact">Contact</Link>.</p>
    </article>
  );
}
