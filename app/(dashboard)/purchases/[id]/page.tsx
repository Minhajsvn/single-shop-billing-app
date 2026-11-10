import { DeliveryDetail } from "@/components/purchasing/delivery-detail";

export default async function DeliveryPage({ params }: PageProps<"/purchases/[id]">) {
  const { id } = await params;
  return <DeliveryDetail id={id} />;
}
