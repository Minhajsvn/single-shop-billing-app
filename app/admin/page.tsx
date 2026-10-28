import Link from "next/link";
import { notFound } from "next/navigation";
import { NeedsLookBadge } from "@/components/admin/needs-look-badge";
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
  const { rows, total, page, pages, needsLookCount } = await listShops({ query, page: Number.parseInt(one(params.page), 10), needsLook });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">Shops</h1>
        <form action="/admin" method="get" className="flex w-full gap-2 sm:w-auto">
          <input
            type="search" name="q" defaultValue={query} aria-label="Search shops"
            placeholder="Shop name, owner email, TRN or shop id"
            className="min-w-0 flex-1 rounded border border-line-strong bg-surface px-3 py-1.5 text-sm sm:w-80"
          />
          {needsLook ? <input type="hidden" name="look" value="1" /> : null}
          <button type="submit" className="rounded bg-accent px-3 py-1.5 text-sm text-white">Search</button>
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <p className={needsLookCount ? "font-medium text-danger" : "text-muted"}>
          {needsLookCount === 1 ? "1 shop needs a look" : `${needsLookCount} shops need a look`}
        </p>
        <Link href={pageHref(query, 1, !needsLook)} className="underline">
          {needsLook ? "Show all shops" : "Needs a look only"}
        </Link>
      </div>

      <p className="text-sm text-muted">
        {total === 1 ? "1 shop" : `${total} shops`}{needsLook ? " needing a look" : ""}{query ? ` matching “${query}”` : ""}
        {query || needsLook ? <> · <Link href="/admin" className="underline">Clear</Link></> : null}
      </p>

      <div className="overflow-x-auto rounded border border-line bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-raised text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Shop</th>
              <th className="px-3 py-2 font-medium">Owner email</th>
              <th className="px-3 py-2 font-medium">Plan</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-line last:border-0 hover:bg-raised">
                <td className="px-3 py-2"><Link href={`/admin/shops/${row.id}`} className="font-medium underline-offset-2 hover:underline">{row.name}</Link>
                  {row.openFlags ? <> <NeedsLookBadge /></> : null}
                </td>
                <td className="px-3 py-2">{row.ownerEmail || "—"}</td>
                <td className="px-3 py-2">{row.planId ? PLANS[row.planId as PlanId]?.name ?? row.planId : "—"}</td>
                <td className="px-3 py-2">{row.statusText}</td>
                <td className="whitespace-nowrap px-3 py-2">{adminDateTime(row.createdAt)}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">No shops found.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <nav className="flex items-center justify-between text-sm" aria-label="Pages">
          {page > 1 ? <Link href={pageHref(query, page - 1, needsLook)} className="underline">Previous</Link> : <span />}
          <span className="text-muted">Page {page} of {pages}</span>
          {page < pages ? <Link href={pageHref(query, page + 1, needsLook)} className="underline">Next</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
