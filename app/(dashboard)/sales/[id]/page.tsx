import { InvoiceDetailWorkspace } from "@/components/invoice-detail-workspace";

export default async function InvoiceDetailPage({ params }: PageProps<"/sales/[id]">) {
  const { id } = await params;
  return <InvoiceDetailWorkspace id={id} />;
}
