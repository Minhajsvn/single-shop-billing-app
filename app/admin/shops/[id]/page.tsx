import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyText } from "@/components/admin/copy-text";
import { ShopActions } from "@/components/admin/shop-actions";
import { requireStaff } from "@/lib/admin/require-staff";
import { getShop } from "@/lib/admin/shops";
import { adminDateTime, tillsLine } from "@/lib/admin/shop-view";
import { PLANS, type PlanId } from "@/lib/billing/plans";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-slate-200 bg-white">
      <h2 className="border-b border-slate-200 px-4 py-2 text-sm font-semibold">{title}</h2>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Fields({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-slate-500">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const TILL_STATUS: Record<string, string> = { active: "Active", paused: "Paused", revoked: "Revoked" };
const KIND: Record<string, string> = { extra_till: "Extra till", manual: "Manual" };
const ACTION: Record<string, string> = {
  "admin.extend_trial": "Extended trial",
  "admin.extra_till": "Gave extra till",
  "admin.end_extra_till": "Ended extra till",
  "admin.flag_seen": "Marked billing flag looked at",
};

export default async function AdminShopPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await requireStaff()).ok) notFound();

  const { id } = await params;
  const shop = await getShop(id);
  if (!shop) notFound();

  const s = shop.subscription;
  const plan = shop.planId ? PLANS[shop.planId as PlanId]?.name ?? shop.planId : "—";

  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin" className="text-sm text-slate-500 underline">All shops</Link>
        <h1 className="mt-1 text-xl font-semibold">{shop.name}</h1>
        <p className="text-sm text-slate-600">{shop.statusText}</p>
      </div>

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

      <Section title="Tills">
        <p className="mb-3 text-sm">{tillsLine(shop.activeTills, shop.tillsAllowed)}</p>
        {shop.tills.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr><th className="py-1 pr-4 font-medium">Number</th><th className="py-1 pr-4 font-medium">Name</th><th className="py-1 pr-4 font-medium">Branch</th><th className="py-1 font-medium">Status</th></tr>
              </thead>
              <tbody>
                {shop.tills.map((till) => (
                  <tr key={till.tillNumber} className="border-t border-slate-100">
                    <td className="py-1 pr-4">{till.tillNumber}</td>
                    <td className="py-1 pr-4">{till.name}</td>
                    <td className="py-1 pr-4">{till.branchName || "—"}</td>
                    <td className="py-1">{TILL_STATUS[till.status] ?? till.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-slate-500">No tills yet.</p>}
      </Section>

      <Section title="Extras">
        {shop.overrides.length ? (
          <ul className="space-y-2 text-sm">
            {shop.overrides.map((o) => (
              <li key={o.id} className="border-t border-slate-100 pt-2 first:border-0 first:pt-0">
                <span className="font-medium">{KIND[o.kind] ?? o.kind}</span>
                {o.maxTills !== null ? ` · ${o.maxTills} tills` : ""}
                {" · "}<span className={o.active ? "text-emerald-700" : "text-slate-500"}>{o.active ? "Active" : "Ended"}</span>
                {" · "}{o.expiresAt ? `${o.active ? "until" : "ended"} ${adminDateTime(o.expiresAt)}` : "no expiry"}
                <div className="text-slate-600">{o.note}</div>
                <div className="text-xs text-slate-400">Given {adminDateTime(o.createdAt)}</div>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">No extras.</p>}
      </Section>

      <Section title="Activity">
        {shop.activity.length ? (
          <ul className="space-y-2 text-sm">
            {shop.activity.map((event, index) => (
              <li key={`${event.createdAt}-${index}`} className="border-t border-slate-100 pt-2 first:border-0 first:pt-0">
                <span className="font-medium">{ACTION[event.action] ?? event.action}</span>
                {" · "}{event.actorEmail || "unknown"}{" · "}{adminDateTime(event.createdAt)}
                {event.note ? <div className="text-slate-600">{event.note}</div> : null}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">No admin actions yet.</p>}
      </Section>
    </div>
  );
}
