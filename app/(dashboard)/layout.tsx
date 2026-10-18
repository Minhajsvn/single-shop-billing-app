import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { RouteSkeleton } from "@/components/ui/route-skeleton";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  // The same AppShell renders while loading and when ready, so the frame never jumps; only the page swaps in.
  return <AuthGate loading={<AppShell loading><RouteSkeleton /></AppShell>}><AppShell>{children}</AppShell></AuthGate>;
}
