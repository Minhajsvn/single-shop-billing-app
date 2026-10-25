import { adminNotFound, requireStaff } from "@/lib/admin/require-staff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Staff-only liveness check for the admin gate; everyone else gets 404. */
export async function GET() {
  if (!(await requireStaff()).ok) return adminNotFound();
  return Response.json({ ok: true });
}

// Unsupported methods answer the same 404 as a missing route instead of Next's 405 / automatic OPTIONS.
export const POST = adminNotFound;
export const PUT = adminNotFound;
export const PATCH = adminNotFound;
export const DELETE = adminNotFound;
export const OPTIONS = adminNotFound;
