import { FeaturePage, featureMetadata } from "@/components/public/features/feature-page";

export const metadata = featureMetadata("vat-invoice");

export default function Page() {
  return <FeaturePage slug="vat-invoice" />;
}
