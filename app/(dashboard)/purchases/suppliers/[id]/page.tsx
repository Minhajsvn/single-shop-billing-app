import { SupplierPage } from "@/components/purchasing/supplier-page";

export default async function SupplierDetailPage({ params }: PageProps<"/purchases/suppliers/[id]">) {
  const { id } = await params;
  return <SupplierPage id={id} />;
}
