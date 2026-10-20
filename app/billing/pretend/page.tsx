import { PLANS, priceWithVat } from "@/lib/billing/plans";
import { PretendActions } from "./pretend-actions";
import { pretendShell, requirePretendOwner, TestBadge } from "./guard";

export const dynamic = "force-dynamic";

const aed = (minor: number) => `AED ${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plain = (minor: number) => (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function PretendCheckoutPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { denied } = await requirePretendOwner();
  const interval = (await searchParams).interval === "year" ? "year" : "month";
  if (denied) return <main style={pretendShell}><p>{denied}</p></main>;

  const starter = PLANS.starter;
  const net = (interval === "year" ? starter.annualPriceMinor : starter.monthlyPriceMinor)?.AED ?? 0;
  const { vatMinor, grossMinor } = priceWithVat(net);

  return (
    <main style={pretendShell}>
      <TestBadge />
      <h1 style={{ margin: 0, fontSize: 22 }}>{starter.name} plan</h1>
      <p style={{ margin: 0 }}>{interval === "year" ? "Yearly (2 months free)" : "Monthly"}</p>
      <p style={{ margin: 0, fontWeight: 600 }}>{aed(net)} + VAT {plain(vatMinor)} = {aed(grossMinor)}</p>
      <PretendActions
        interval={interval}
        buttons={[
          { action: "pay", label: "Pay with test card", tone: "primary", returnTo: "success" },
          { action: "decline", label: "Use a declining test card", returnTo: "stay" },
          { label: "Cancel", returnTo: "cancel" },
        ]}
      />
    </main>
  );
}
