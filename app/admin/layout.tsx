import type { Metadata } from "next";
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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <span className="text-sm font-semibold">Shop Ledger · Admin</span>
          <span className="truncate text-xs text-slate-500">{staff.email}</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      <ConfirmHost />
      <Toaster />
    </div>
  );
}
