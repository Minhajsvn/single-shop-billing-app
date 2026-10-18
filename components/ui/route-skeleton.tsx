"use client";

import { usePathname } from "next/navigation";
import { Skeleton } from "@/components/ui/list-parts";

/** The page's shape in grey while the hosted shop loads: cards on Overview, the product grid on New sale, a list elsewhere. */
export function RouteSkeleton() {
  const pathname = usePathname();
  const variant = pathname === "/overview" ? "cards" : pathname === "/sale" ? "grid" : "list";
  return (
    <div className="route-skeleton" role="status" aria-label="Loading your shop">
      <div className="page-heading"><div><span className="skeleton-block skeleton-eyebrow" /><span className="skeleton-block skeleton-title" /></div></div>
      {variant === "cards" ? <Skeleton variant="cards" rows={4} /> : null}
      <section className="panel">
        <Skeleton variant={variant === "grid" ? "grid" : "list"} rows={variant === "grid" ? 8 : 6} />
      </section>
    </div>
  );
}
