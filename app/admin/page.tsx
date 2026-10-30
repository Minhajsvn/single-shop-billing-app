import Link from "next/link";
import { notFound } from "next/navigation";
import { NeedsLookBadge } from "@/components/admin/needs-look-badge";
import { StatusPill } from "@/components/admin/status-pill";
import { requireStaff } from "@/lib/admin/require-staff";
import { listShops } from "@/lib/admin/shops";
import { adminDateTime } from "@/lib/admin/shop-view";
import { PLANS, type PlanId } from "@/lib/billing/plans";

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function pageHref(query: string, page: number, needsLook: boolean): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (needsLook) params.set("look", "1");
  if (page > 1) params.set("page", String(page));
  const text = params.toString();
  return text ? `/admin?${text}` : "/admin";
}

export default async function AdminShopsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await requireStaff()).ok) notFound();

  const params = await searchParams;
  const query = one(params.q).trim().slice(0, 200);
  const needsLook = one(params.look) === "1";
  const { rows, total, page, pages, needsLookCount, counts } = await listShops({ query, page: Number.parseInt(one(params.page), 10), needsLook });

  const metrics: { label: string; value: number; note: string }[] = [
    { label: "Shops", value: counts.shops, note: "All shops" },
    { label: "Needs a look", value: counts.needsLook, note: counts.needsLook === 1 ? "Shop with an open billing flag" : "Shops with an open billing flag" },
    { label: "On trial", value: counts.trial, note: "Trying Pro" },
    { label: "Granted", value: counts.granted, note: "Plan given by Shop Ledger" },
    { label: "Paying", value: counts.paying, note: "Through Stripe" },
  ];

  return (
    <div className="admin-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Admin</span>
          <h1 className="page-title">Shops</h1>
        </div>
      </div>

      <div className="metric-grid admin-metrics">
        {metrics.map((metric) => (
          <div key={metric.label} className="metric">
            <div className="metric-label">{metric.label}</div>
            <div className="metric-value">{metric.value}</div>
            <div className="metric-note">{metric.note}</div>
          </div>
        ))}
      </div>

      <section className="panel">
        <div className="panel-body">
          <form action="/admin" method="get" className="toolbar" role="search">
            <div className="search">
              <input
                type="search" name="q" defaultValue={query} aria-label="Search shops" className="input"
                placeholder="Shop name, owner email, TRN or shop id"
              />
            </div>
            {needsLook ? <input type="hidden" name="look" value="1" /> : null}
            <button type="submit" className="button primary">Search</button>
            <Link href={pageHref(query, 1, !needsLook)} className="button" aria-pressed={needsLook}>
              {needsLook ? "Show all shops" : "Needs a look only"}
            </Link>
          </form>
        </div>

        <p className="admin-summary">
          {needsLookCount === 1 ? "1 shop needs a look" : `${needsLookCount} shops need a look`}
          {" · "}{total === 1 ? "1 shop" : `${total} shops`}{needsLook ? " needing a look" : ""}{query ? ` matching “${query}”` : ""}
          {query || needsLook ? <> · <Link href="/admin">Clear</Link></> : null}
        </p>

        {rows.length ? (
          <div className="table-wrap stack-table admin-table">
            <table>
              <thead>
                <tr><th>Shop</th><th>Owner email</th><th>Plan</th><th>Status</th><th>Created</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Shop">
                      <Link href={`/admin/shops/${row.id}`} className="invoice-link product-name">{row.name}</Link>
                      {row.openFlags ? <> <NeedsLookBadge /></> : null}
                    </td>
                    <td data-label="Owner email">{row.ownerEmail || "—"}</td>
                    <td data-label="Plan">{row.planId ? PLANS[row.planId as PlanId]?.name ?? row.planId : "—"}</td>
                    <td data-label="Status"><StatusPill text={row.statusText} /></td>
                    <td data-label="Created" className="nowrap">{adminDateTime(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="admin-empty">No shops found.</p>}

        {pages > 1 ? (
          <nav className="pager" aria-label="Pages">
            {page > 1 ? <Link href={pageHref(query, page - 1, needsLook)} className="button">Previous</Link> : <span />}
            <span className="pager-position">Page {page} of {pages}</span>
            {page < pages ? <Link href={pageHref(query, page + 1, needsLook)} className="button">Next</Link> : <span />}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
