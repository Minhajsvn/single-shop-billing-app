import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmHost } from "@/components/ui/confirm-host";
import { Toaster } from "@/components/ui/toaster";
import { requireStaff } from "@/lib/admin/require-staff";

// Static metadata would also render on the non-staff 404 and reveal the console, so it is gated too.
export async function generateMetadata(): Promise<Metadata> {
  if (!(await requireStaff()).ok) return {};
  return { title: "Admin · Shop Ledger UAE", robots: { index: false, follow: false } };
}

// Outside the (dashboard) group on purpose: staff need no shop or till.
// Layouts do not re-run on client navigation and do not stop child pages from rendering,
// so every admin page (and every /api/v1/admin route) must call requireStaff() itself too.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  if (!staff.ok) notFound();

  return (
    <div className="admin-shell">
      <header className="topbar">
        <div className="admin-brand">
          <strong>Shop Ledger · Admin</strong>
          <small title={staff.email}>{staff.email}</small>
        </div>
        <Link href="/overview" className="admin-open-link">Open shop app</Link>
      </header>
      <main className="admin-main">{children}</main>
      <ConfirmHost />
      <Toaster />
    </div>
  );
}
