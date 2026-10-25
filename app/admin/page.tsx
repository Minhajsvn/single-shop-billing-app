import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/require-staff";

export default async function AdminShopsPage() {
  if (!(await requireStaff()).ok) notFound();

  return <h1 className="text-xl font-semibold">Shops</h1>;
}
