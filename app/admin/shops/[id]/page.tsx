import Link from "next/link";
import { notFound } from "next/navigation";
import { BillingCheck } from "@/components/admin/billing-check";
import { CopyText } from "@/components/admin/copy-text";
import { GrantPanel } from "@/components/admin/grant-panel";
import { MembersPanel } from "@/components/admin/members-panel";
import { NeedsLookBadge } from "@/components/admin/needs-look-badge";
import { ShopActions } from "@/components/admin/shop-actions";
import { StatusPill } from "@/components/admin/status-pill";
import { flagFieldLabel, flagValueText } from "@/lib/billing/billing-check";
import { requireStaff } from "@/lib/admin/require-staff";
import { getShop } from "@/lib/admin/shops";
import { adminDateTime, tillsLine } from "@/lib/admin/shop-view";
import { PLANS, type PlanId } from "@/lib/billing/plans";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-header"><h2 className="panel-title">{title}</h2></div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function Fields({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="admin-fields">
      {items.map(([label, value]) => (
        <div key={label} style={{ display: "contents" }}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const TILL_STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: "Active", tone: "green" },
  paused: { label: "Paused", tone: "yellow" },
  revoked: { label: "Revoked", tone: "red" },
};
const KIND: Record<string, string> = { extra_till: "Extra till", manual: "Manual" };
const ACTION: Record<string, string> = {
  "admin.extend_trial": "Extended trial",
  "admin.extra_till": "Gave extra till",
  "admin.end_extra_till": "Ended extra till",
  "admin.flag_seen": "Marked billing flag looked at",
  "admin.grant_plan": "Granted a plan",
  "admin.revoke_grant": "Revoked the granted plan",
  "admin.add_member": "Added a user",
  "admin.set_member_role": "Changed a user's role",
  "admin.set_member_status": "Enabled or disabled a user",
  "admin.send_password_reset": "Sent a password reset email",
};

export default async function AdminShopPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await requireStaff()).ok) notFound();

  const { id } = await params;
  const shop = await getShop(id);
  if (!shop) notFound();

  const s = shop.subscription;
  const plan = shop.planId ? PLANS[shop.planId as PlanId]?.name ?? shop.planId : "—";
  // A live Stripe subscription: it has an id and is not canceled. Granting is refused then.
  const paysThroughStripe = Boolean(s?.stripeSubscriptionId) && s?.status !== "canceled";
  const grantPlan = shop.grant ? PLANS[shop.grant.planId]?.name ?? shop.grant.planId : null;

  return (
    <div className="admin-page">
      <div className="page-heading">
        <div style={{ minWidth: 0 }}>
          <Link href="/admin" className="admin-back">← All shops</Link>
          <h1 className="page-title">{shop.name}</h1>
          <div className="admin-pills">
            <StatusPill text={shop.statusText} />
            {shop.billingCheck.flags.length ? <NeedsLookBadge /> : null}
          </div>
        </div>
      </div>

      <div className="admin-columns">
        <div className="admin-column">
          <Section title="Shop">
            <Fields items={[
              ["Legal name", shop.name],
              ["TRN", shop.trn],
              ["Phone", shop.phone],
              ["Country", shop.country],
              ["Created", adminDateTime(shop.createdAt)],
              ["Owner email", shop.ownerEmail ? `${shop.ownerEmail} (${shop.ownerConfirmed ? "confirmed" : "not confirmed"})` : "—"],
              ["Shop id", <CopyText key="id" value={shop.id} />],
            ]} />
          </Section>

          <Section title="Plan and billing">
            <Fields items={[
              ["Plan", plan],
              ["Status", shop.statusText],
              ["Granted plan", shop.grant ? `${grantPlan} · ${shop.grant.endsAt ? `until ${adminDateTime(shop.grant.endsAt)}` : "until revoked"}` : "None"],
              ["Trial end", adminDateTime(s?.trialEndsAt ?? null)],
              ["Grace end", adminDateTime(s?.graceEndsAt ?? null)],
              ["Current period end", adminDateTime(s?.currentPeriodEnd ?? null)],
              ["Cancel date", adminDateTime(s?.cancelAt ?? null)],
              ["Payment method on file", s ? (s.hasPaymentMethod ? "Yes" : "No") : "—"],
              ["Billing interval", s?.billingInterval === "year" ? "Annual" : s?.billingInterval === "month" ? "Monthly" : "—"],
              ["Stripe customer", <CopyText key="customer" value={s?.stripeCustomerId ?? null} />],
              ["Stripe subscription", <CopyText key="subscription" value={s?.stripeSubscriptionId ?? null} />],
              ["Last Stripe event", adminDateTime(s?.lastEventAt ?? null)],
            ]} />
          </Section>

          <Section title="Billing check">
            <BillingCheck
              shopId={shop.id}
              shopName={shop.name}
              lastChecked={shop.billingCheck.lastCheckedAt ? adminDateTime(shop.billingCheck.lastCheckedAt) : "never"}
              flags={shop.billingCheck.flags.map((flag) => ({
                id: flag.id,
                label: flagFieldLabel(flag.field),
                ours: flagValueText(flag.field, flag.ours, adminDateTime),
                theirs: flagValueText(flag.field, flag.theirs, adminDateTime),
                firstSeen: adminDateTime(flag.firstSeen),
                lastSeen: adminDateTime(flag.lastSeen),
              }))}
            />
          </Section>

          <Section title="Tills">
            <p style={{ margin: "0 0 14px", fontSize: 13 }}>{tillsLine(shop.activeTills, shop.tillsAllowed)}</p>
            {shop.tills.length ? (
              <div className="table-wrap stack-table admin-table">
                <table>
                  <thead><tr><th>Number</th><th>Name</th><th>Branch</th><th>Status</th></tr></thead>
                  <tbody>
                    {shop.tills.map((till) => {
                      const status = TILL_STATUS[till.status] ?? { label: till.status, tone: "" };
                      return (
                        <tr key={till.tillNumber}>
                          <td data-label="Number">{till.tillNumber}</td>
                          <td data-label="Name">{till.name}</td>
                          <td data-label="Branch">{till.branchName || "—"}</td>
                          <td data-label="Status"><span className={`badge ${status.tone}`}>{status.label}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <p className="admin-muted" style={{ margin: 0 }}>No tills yet.</p>}
          </Section>

          <Section title="Extras">
            {shop.overrides.length ? (
              <ul className="admin-list">
                {shop.overrides.map((o) => (
                  <li key={o.id}>
                    <div className="admin-row">
                      <span className="product-name">{KIND[o.kind] ?? o.kind}{o.maxTills !== null ? ` · ${o.maxTills} tills` : ""}</span>
                      <span className={`badge ${o.active ? "green" : ""}`}>{o.active ? "Active" : "Ended"}</span>
                      <span className="admin-muted">{o.expiresAt ? `${o.active ? "until" : "ended"} ${adminDateTime(o.expiresAt)}` : "no expiry"}</span>
                    </div>
                    {o.note ? <p className="admin-note">{o.note}</p> : null}
                    <div className="admin-muted">Given {adminDateTime(o.createdAt)}</div>
                  </li>
                ))}
              </ul>
            ) : <p className="admin-muted" style={{ margin: 0 }}>No extras.</p>}
          </Section>

          <Section title="Activity">
            {shop.activity.length ? (
              <ul className="admin-list">
                {shop.activity.map((event, index) => (
                  <li key={`${event.createdAt}-${index}`}>
                    <span className="product-name">{ACTION[event.action] ?? event.action}</span>
                    <div className="admin-muted">{event.actorEmail || "unknown"} · {adminDateTime(event.createdAt)}</div>
                    {event.note ? <p className="admin-note">{event.note}</p> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="admin-muted" style={{ margin: 0 }}>No admin actions yet.</p>}
          </Section>
        </div>

        <div className="admin-column admin-side">
          <Section title="Actions">
            <ShopActions
              shopId={shop.id}
              shopName={shop.name}
              status={s?.status ?? null}
              hasPaymentMethod={s?.hasPaymentMethod ?? false}
              trialEndsAt={s?.trialEndsAt ?? null}
              tillLimited={shop.tillsAllowed !== null}
              extraTillUntil={shop.overrides.find((o) => o.kind === "extra_till" && o.active)?.expiresAt ?? null}
            />
          </Section>
          <GrantPanel shopId={shop.id} grant={shop.grant} paysThroughStripe={paysThroughStripe} />
          <MembersPanel shopId={shop.id} members={shop.members} membersAllowed={shop.membersAllowed} />
        </div>
      </div>
    </div>
  );
}
