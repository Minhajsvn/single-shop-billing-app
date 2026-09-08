"use client";

import { WarningCircle } from "@phosphor-icons/react";
import { useEffect } from "react";

export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("Shop Ledger dashboard error", { message: error.message, digest: error.digest });
  }, [error]);

  return <section className="panel error-boundary" role="alert"><WarningCircle size={38} weight="duotone" /><h1>We could not open this workspace.</h1><p>Your locally saved invoices and stock were not removed. Retry the screen; if it happens again, download a backup from Settings before troubleshooting.</p>{error.digest && <code>Reference {error.digest}</code>}<button className="button primary" onClick={() => retry()}>Try again</button></section>;
}
