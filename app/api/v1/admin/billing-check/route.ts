import { adminNotFound, requireStaff } from "@/lib/admin/require-staff";
import { billingCheckCaller, CRON_SECRET_HEADER } from "@/lib/admin/staff";
import { readBody, refused } from "@/lib/admin/action-route";
import { runBillingCheck } from "@/lib/admin/billing-check-run";
import { isShopId } from "@/lib/admin/shop-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Daily billing check: a staff session, or the scheduler's `x-admin-cron-secret` header. Neither → 401 (this route
 * only; every other admin route answers 404). Body `{ businessId? }` checks one shop; no body checks every shop.
 * It only records flags; it never changes a subscription.
 */
export async function POST(request: Request) {
  const staff = await requireStaff();
  if (!billingCheckCaller(staff.ok, request.headers.get(CRON_SECRET_HEADER))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await readBody(request);
  const input = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  let businessId: string | undefined;
  if (input.businessId !== undefined) {
    if (typeof input.businessId !== "string" || !isShopId(input.businessId)) return refused("That shop id is not valid.");
    businessId = input.businessId;
  }

  try {
    return Response.json(await runBillingCheck({ businessId }));
  } catch (error) {
    const detail = error as { code?: string; message?: string };
    console.error("admin billing check failed", detail?.code, detail?.message);
    return Response.json({ error: "The billing check did not run. Try again." }, { status: 500 });
  }
}

// Unsupported methods answer the same 404 as a missing route instead of Next's 405 / automatic OPTIONS.
export const GET = adminNotFound;
export const HEAD = adminNotFound;
export const PUT = adminNotFound;
export const PATCH = adminNotFound;
export const DELETE = adminNotFound;
export const OPTIONS = adminNotFound;
