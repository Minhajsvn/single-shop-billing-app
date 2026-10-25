// SERVER ONLY. Admin console reads with the service-role client. Callers check requireStaff() first.
// Owner and actor emails come from the Auth admin API (auth.admin.getUserById / listUsers), not a SQL view:
// no new migration, and auth.users is never exposed through PostgREST.
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseEntitlements, READ_ONLY_ENTITLEMENTS, type Entitlements } from "@/lib/billing/entitlements";
import { isShopId, overrideActive, searchFilter, shopStatusText } from "@/lib/admin/shop-view";

export const SHOPS_PAGE_SIZE = 50;

type AdminClient = ReturnType<typeof createAdminClient>;

export type AdminShopRow = {
  id: string;
  name: string;
  ownerEmail: string;
  planId: string | null;
  statusText: string;
  createdAt: string;
};

export type AdminSubscription = {
  planId: string;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  addonTills: number;
  addonBranches: number;
  hasPaymentMethod: boolean;
  billingInterval: string | null;
  cancelAt: string | null;
  canceledAt: string | null;
  lastEventAt: string | null;
  updatedAt: string;
};

export type AdminShop = AdminShopRow & {
  trn: string;
  phone: string;
  country: string;
  ownerConfirmed: boolean;
  subscription: AdminSubscription | null;
  entitlements: Entitlements;
  tills: { tillNumber: number; name: string; branchName: string; status: string }[];
  activeTills: number;
  tillsAllowed: number | null;
  overrides: { id: string; kind: string; maxTills: number | null; expiresAt: string | null; note: string; createdAt: string; active: boolean }[];
  activity: { action: string; actorEmail: string; note: string; createdAt: string }[];
};

type BusinessRow = { id: string; legal_name: string; owner_id: string; created_at: string };

async function usersById(admin: AdminClient, ids: string[]): Promise<Map<string, User>> {
  const unique = [...new Set(ids)];
  const found = await Promise.all(unique.map(async (id) => (await admin.auth.admin.getUserById(id)).data.user));
  return new Map(found.filter((user): user is User => user !== null).map((user) => [user.id, user]));
}

/** Ids of users whose email contains the term. Pages through every user (fine at pilot scale). */
async function userIdsByEmail(admin: AdminClient, term: string): Promise<string[]> {
  const needle = term.trim().toLowerCase();
  if (!needle) return [];
  const ids: string[] = [];
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    for (const user of data.users) if (user.email?.toLowerCase().includes(needle)) ids.push(user.id);
    if (data.users.length < perPage) return ids;
  }
}

async function entitlementsFor(admin: AdminClient, businessId: string): Promise<Entitlements> {
  const { data, error } = await admin.rpc("entitlements_internal", { target_business_id: businessId });
  if (error) throw error;
  return data ? parseEntitlements(data) : READ_ONLY_ENTITLEMENTS;
}

async function toRows(admin: AdminClient, businesses: BusinessRow[], now: Date): Promise<AdminShopRow[]> {
  const [owners, entitlements] = await Promise.all([
    usersById(admin, businesses.map((b) => b.owner_id)),
    Promise.all(businesses.map((b) => entitlementsFor(admin, b.id))),
  ]);
  return businesses.map((b, index) => ({
    id: b.id,
    name: b.legal_name,
    ownerEmail: owners.get(b.owner_id)?.email ?? "",
    planId: entitlements[index].planId,
    statusText: shopStatusText(entitlements[index], now),
    createdAt: b.created_at,
  }));
}

/** Newest first, pages of 50 (page starts at 1). Search: name / owner email / TRN contains, or the exact shop id. */
export async function listShops(input: { query: string; page: number }): Promise<{ rows: AdminShopRow[]; total: number }> {
  const admin = createAdminClient();
  const page = Math.max(1, Math.floor(input.page) || 1);
  const from = (page - 1) * SHOPS_PAGE_SIZE;

  let request = admin.from("businesses").select("id, legal_name, owner_id, created_at", { count: "exact" });
  if (input.query.trim()) {
    const filter = searchFilter(input.query, await userIdsByEmail(admin, input.query));
    if (!filter) return { rows: [], total: 0 };
    request = request.or(filter);
  }
  const { data, count, error } = await request
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + SHOPS_PAGE_SIZE - 1);
  if (error) throw error;

  return { rows: await toRows(admin, (data ?? []) as BusinessRow[], new Date()), total: count ?? 0 };
}

export async function getShop(id: string): Promise<AdminShop | null> {
  if (!isShopId(id)) return null;
  const admin = createAdminClient();
  const now = new Date();

  const { data: business, error } = await admin
    .from("businesses")
    .select("id, legal_name, owner_id, created_at, trn, phone, country")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!business) return null;

  const [sub, entitlements, devices, overrides, events] = await Promise.all([
    admin.from("subscriptions").select("*").eq("business_id", id).maybeSingle(),
    entitlementsFor(admin, id),
    admin.from("devices").select("till_number, name, status, branch:branches(name)").eq("business_id", id).order("till_number"),
    admin.from("entitlement_overrides").select("id, kind, max_tills, expires_at, note, created_at").eq("business_id", id).order("created_at", { ascending: false }),
    admin.from("audit_events").select("action, actor_id, summary, created_at").eq("business_id", id).like("action", "admin.%")
      .order("created_at", { ascending: false }).limit(20),
  ]);
  for (const result of [sub, devices, overrides, events]) if (result.error) throw result.error;

  const users = await usersById(admin, [business.owner_id, ...(events.data ?? []).map((event) => event.actor_id as string)]);
  const owner = users.get(business.owner_id);
  const s = sub.data;
  const tills = (devices.data ?? []).map((device) => {
    const branch = device.branch as { name: string } | { name: string }[] | null;
    return {
      tillNumber: device.till_number as number,
      name: device.name as string,
      branchName: (Array.isArray(branch) ? branch[0]?.name : branch?.name) ?? "",
      status: device.status as string,
    };
  });

  return {
    id: business.id,
    name: business.legal_name,
    ownerEmail: owner?.email ?? "",
    planId: entitlements.planId,
    statusText: shopStatusText(entitlements, now),
    createdAt: business.created_at,
    trn: business.trn,
    phone: business.phone,
    country: business.country,
    ownerConfirmed: Boolean(owner?.email_confirmed_at),
    subscription: s ? {
      planId: s.plan_id, status: s.status, stripeCustomerId: s.stripe_customer_id, stripeSubscriptionId: s.stripe_subscription_id,
      trialEndsAt: s.trial_ends_at, currentPeriodEnd: s.current_period_end, graceEndsAt: s.grace_ends_at,
      addonTills: s.addon_tills, addonBranches: s.addon_branches, hasPaymentMethod: s.has_payment_method,
      billingInterval: s.billing_interval, cancelAt: s.cancel_at, canceledAt: s.canceled_at, lastEventAt: s.last_event_at, updatedAt: s.updated_at,
    } : null,
    entitlements,
    tills,
    activeTills: tills.filter((till) => till.status === "active").length,
    tillsAllowed: entitlements.limits.tills,
    overrides: (overrides.data ?? []).map((o) => ({
      id: o.id, kind: o.kind, maxTills: o.max_tills, expiresAt: o.expires_at, note: o.note, createdAt: o.created_at,
      active: overrideActive(o.expires_at, now),
    })),
    activity: (events.data ?? []).map((event) => ({
      action: event.action as string,
      actorEmail: users.get(event.actor_id as string)?.email ?? "",
      note: typeof event.summary?.note === "string" ? event.summary.note : "",
      createdAt: event.created_at as string,
    })),
  };
}
