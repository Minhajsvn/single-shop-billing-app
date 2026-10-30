// SERVER ONLY. Admin console reads with the service-role client. Callers check requireStaff() first.
// Owner and actor emails come from the Auth admin API (auth.admin.getUserById / listUsers), not a SQL view:
// no new migration, and auth.users is never exposed through PostgREST.
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlanId } from "@/lib/billing/plans";
import { parseEntitlements, READ_ONLY_ENTITLEMENTS, type Entitlements } from "@/lib/billing/entitlements";
import {
  emailNeedle, grantEndingSoon, isShopId, matchingOwnerIds, overrideActive, pageWindow, searchFilter, searchTerm, shopStatusText, sortMembers,
} from "@/lib/admin/shop-view";

export const SHOPS_PAGE_SIZE = 50;

type AdminClient = ReturnType<typeof createAdminClient>;

export type AdminShopRow = {
  id: string;
  name: string;
  ownerEmail: string;
  planId: string | null;
  statusText: string;
  createdAt: string;
  /** Open billing-check flags; above 0 shows "Needs a look". */
  openFlags: number;
};

export type AdminBillingFlag = { id: string; field: string; ours: string | null; theirs: string | null; firstSeen: string; lastSeen: string };

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
  /** Open flags, oldest first, and when the billing check last looked at this shop. */
  billingCheck: { lastCheckedAt: string | null; flags: AdminBillingFlag[] };
  /** The plan grant in force now, if any. */
  grant: AdminGrant | null;
  /** Owner first, then oldest first. */
  members: AdminMember[];
  /** The shop's member limit; null = unlimited. */
  membersAllowed: number | null;
};

export type AdminGrant = {
  planId: PlanId; endsAt: string | null; grantedByEmail: string; note: string; createdAt: string; endingSoon: boolean;
};

export type AdminMember = {
  id: string; userId: string; email: string; role: "owner" | "manager" | "cashier"; status: "active" | "disabled";
  createdAt: string; lastSignInAt: string | null; isOwner: boolean;
};

type BusinessRow = { id: string; legal_name: string; owner_id: string; created_at: string };

async function usersById(admin: AdminClient, ids: string[]): Promise<Map<string, User>> {
  const unique = [...new Set(ids)];
  const found = await Promise.all(unique.map(async (id) => (await admin.auth.admin.getUserById(id)).data.user));
  return new Map(found.filter((user): user is User => user !== null).map((user) => [user.id, user]));
}

/** Ids of users whose email contains the needle. Pages through every user (fine at pilot scale). */
async function userIdsByEmail(admin: AdminClient, needle: string): Promise<string[]> {
  const ids: string[] = [];
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    for (const user of data.users) if (user.email?.toLowerCase().includes(needle)) ids.push(user.id);
    if (data.users.length < perPage) return ids;
  }
}

/** Every shop owner's user id, read in pages (no id list goes into a URL). */
async function shopOwnerIds(admin: AdminClient): Promise<Set<string>> {
  const owners = new Set<string>();
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await admin.from("businesses").select("owner_id").order("id").range(from, from + size - 1);
    if (error) throw error;
    for (const row of data ?? []) owners.add(row.owner_id as string);
    if ((data ?? []).length < size) return owners;
  }
}

/** Owners whose email contains the term and who own a shop, capped; none for terms under 3 characters. */
async function ownerIdsByEmail(admin: AdminClient, term: string): Promise<string[]> {
  const needle = emailNeedle(term);
  if (!needle) return [];
  const [userIds, owners] = await Promise.all([userIdsByEmail(admin, needle), shopOwnerIds(admin)]);
  return matchingOwnerIds(userIds, owners);
}

async function entitlementsFor(admin: AdminClient, businessId: string): Promise<Entitlements> {
  const { data, error } = await admin.rpc("entitlements_internal", { target_business_id: businessId });
  if (error) throw error;
  return data ? parseEntitlements(data) : READ_ONLY_ENTITLEMENTS;
}

async function toRows(admin: AdminClient, businesses: BusinessRow[], now: Date): Promise<Omit<AdminShopRow, "openFlags">[]> {
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

/** Shops with at least one open billing flag (the "Needs a look" count), whatever the search. */
async function needsLookCount(admin: AdminClient): Promise<number> {
  const { count, error } = await admin.from("businesses")
    .select(`id, ${OPEN_FLAGS_INNER}`, { count: "exact", head: true })
    .is("admin_billing_flags.seen_at", null);
  if (error) throw error;
  return count ?? 0;
}

// Open flags are embedded through admin_billing_flags.business_id (no id list goes into a URL). With !inner only
// shops that have an open flag are returned; without it every shop comes back with its (possibly empty) open flags.
const OPEN_FLAGS = "admin_billing_flags(id)";
const OPEN_FLAGS_INNER = "admin_billing_flags!inner(id)";

export type ShopCounts = { shops: number; needsLook: number; trial: number; granted: number; paying: number };

export type ShopList = { rows: AdminShopRow[]; total: number; page: number; pages: number; needsLookCount: number; counts: ShopCounts };

/** Business ids from a query, read in pages so the default row cap never truncates them. */
async function businessIds(read: (from: number, to: number) => PromiseLike<{ data: { business_id: string }[] | null; error: Error | null }>): Promise<string[]> {
  const ids: string[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await read(from, from + size - 1);
    if (error) throw error;
    for (const row of data ?? []) ids.push(row.business_id);
    if ((data ?? []).length < size) return ids;
  }
}

/** Platform-wide totals for the list header. A fixed number of reads, whatever the number of shops. */
async function shopCounts(admin: AdminClient, needsLook: number): Promise<ShopCounts> {
  const nowIso = new Date().toISOString();
  const [shops, paying, grantedIds, trialingIds] = await Promise.all([
    admin.from("businesses").select("id", { count: "exact", head: true }),
    admin.from("subscriptions").select("business_id", { count: "exact", head: true })
      .not("stripe_subscription_id", "is", null).in("status", ["active", "past_due"]),
    businessIds((from, to) => admin.from("plan_grants").select("business_id").is("revoked_at", null).lte("starts_at", nowIso)
      .or(`ends_at.is.null,ends_at.gt.${nowIso}`).order("id").range(from, to)),
    businessIds((from, to) => admin.from("subscriptions").select("business_id").eq("status", "trialing").order("business_id").range(from, to)),
  ]);
  if (shops.error) throw shops.error;
  if (paying.error) throw paying.error;
  const granted = new Set(grantedIds);
  return {
    shops: shops.count ?? 0,
    needsLook,
    trial: trialingIds.filter((id) => !granted.has(id)).length,
    granted: granted.size,
    paying: paying.count ?? 0,
  };
}

/**
 * Newest first, pages of 50 (page starts at 1; a page past the end gives the last page).
 * Search: name / TRN contains, owner email contains (3+ characters), or the exact shop id.
 * `needsLook` keeps only shops with an open billing flag.
 */
export async function listShops(input: { query: string; page: number; needsLook?: boolean }): Promise<ShopList> {
  const admin = createAdminClient();
  const flagged = await needsLookCount(admin);
  const counts = await shopCounts(admin, flagged);
  const term = searchTerm(input.query);
  let filter: string | null = null;
  if (input.query.trim()) {
    filter = searchFilter(term, await ownerIdsByEmail(admin, term));
    if (!filter) return { rows: [], total: 0, page: 1, pages: 1, needsLookCount: flagged, counts };
  }
  const flags = input.needsLook ? OPEN_FLAGS_INNER : OPEN_FLAGS;

  // Count first, so the requested page can be clamped: a range past the last row is a PostgREST error (PGRST103).
  let counting = admin.from("businesses").select(input.needsLook ? `id, ${OPEN_FLAGS_INNER}` : "id", { count: "exact", head: true });
  if (input.needsLook) counting = counting.is("admin_billing_flags.seen_at", null);
  if (filter) counting = counting.or(filter);
  const { count, error: countError } = await counting;
  if (countError) throw countError;
  const total = count ?? 0;
  const { page, pages, from } = pageWindow(input.page, total, SHOPS_PAGE_SIZE);
  if (total === 0) return { rows: [], total, page, pages, needsLookCount: flagged, counts };

  let request = admin.from("businesses").select(`id, legal_name, owner_id, created_at, ${flags}`).is("admin_billing_flags.seen_at", null);
  if (filter) request = request.or(filter);
  const { data, error } = await request
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + SHOPS_PAGE_SIZE - 1);
  // A shop removed between the count and this read can still push the range past the end.
  if (error && error.code !== "PGRST103") throw error;

  const businesses = ((error ? [] : data) ?? []) as (BusinessRow & { admin_billing_flags: { id: string }[] | null })[];
  const rows = await toRows(admin, businesses, new Date());
  return {
    rows: rows.map((row, index) => ({ ...row, openFlags: businesses[index].admin_billing_flags?.length ?? 0 })),
    total, page, pages, needsLookCount: flagged, counts,
  };
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

  const nowIso = now.toISOString();
  const [sub, entitlements, devices, overrides, events, flags, lastCheck, grants, memberRows] = await Promise.all([
    admin.from("subscriptions").select("*").eq("business_id", id).maybeSingle(),
    entitlementsFor(admin, id),
    admin.from("devices").select("till_number, name, status, branch:branches(name)").eq("business_id", id).order("till_number"),
    admin.from("entitlement_overrides").select("id, kind, max_tills, expires_at, note, created_at").eq("business_id", id).order("created_at", { ascending: false }),
    admin.from("audit_events").select("action, actor_id, summary, created_at").eq("business_id", id).like("action", "admin.%")
      .order("created_at", { ascending: false }).limit(20),
    admin.from("admin_billing_flags").select("id, field, ours, theirs, first_seen, last_seen").eq("business_id", id).is("seen_at", null)
      .order("first_seen"),
    admin.from("admin_billing_check_runs").select("checked_at").eq("business_id", id).maybeSingle(),
    admin.from("plan_grants").select("plan_id, ends_at, granted_by, note, created_at").eq("business_id", id).is("revoked_at", null)
      .lte("starts_at", nowIso).or(`ends_at.is.null,ends_at.gt.${nowIso}`).order("created_at", { ascending: false }).limit(1),
    admin.from("business_members").select("id, user_id, role, status, created_at").eq("business_id", id),
  ]);
  for (const result of [sub, devices, overrides, events, flags, lastCheck, grants, memberRows]) if (result.error) throw result.error;

  const users = await usersById(admin, [
    business.owner_id,
    ...(events.data ?? []).map((event) => event.actor_id as string),
    ...(grants.data ?? []).map((g) => g.granted_by as string),
    ...(memberRows.data ?? []).map((m) => m.user_id as string),
  ]);
  const g = grants.data?.[0];
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
    openFlags: (flags.data ?? []).length,
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
    grant: g ? {
      planId: g.plan_id as PlanId, endsAt: g.ends_at as string | null, grantedByEmail: users.get(g.granted_by as string)?.email ?? "",
      note: (g.note as string | null) ?? "", createdAt: g.created_at as string, endingSoon: grantEndingSoon(g.ends_at as string | null, now),
    } : null,
    members: sortMembers((memberRows.data ?? []).map((m) => ({
      id: m.id as string, userId: m.user_id as string, email: users.get(m.user_id as string)?.email ?? "",
      role: m.role as AdminMember["role"], status: m.status as AdminMember["status"], createdAt: m.created_at as string,
      lastSignInAt: users.get(m.user_id as string)?.last_sign_in_at ?? null, isOwner: m.user_id === business.owner_id,
    }))),
    membersAllowed: entitlements.limits.members,
    billingCheck: {
      lastCheckedAt: (lastCheck.data?.checked_at as string | undefined) ?? null,
      flags: (flags.data ?? []).map((f) => ({
        id: f.id as string, field: f.field as string, ours: f.ours as string | null, theirs: f.theirs as string | null,
        firstSeen: f.first_seen as string, lastSeen: f.last_seen as string,
      })),
    },
  };
}
