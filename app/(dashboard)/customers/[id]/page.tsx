import { CustomerDetailWorkspace } from "@/components/customer-detail-workspace";

export default async function CustomerDetailPage({ params }: PageProps<"/customers/[id]">) {
  const { id } = await params;
  return <CustomerDetailWorkspace id={id} />;
}
