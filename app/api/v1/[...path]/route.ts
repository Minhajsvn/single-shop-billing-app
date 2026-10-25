// Unknown /api/v1 paths answer exactly like an admin route does for non-staff, so the admin API
// cannot be found by comparing responses. Real routes are more specific and always win over this one.
// Relative .ts import so the unit tests can load this file directly.
import { adminNotFound } from "../../../../lib/admin/not-found.ts";

export const dynamic = "force-dynamic";

export const GET = adminNotFound;
export const HEAD = adminNotFound;
export const POST = adminNotFound;
export const PUT = adminNotFound;
export const PATCH = adminNotFound;
export const DELETE = adminNotFound;
export const OPTIONS = adminNotFound;
