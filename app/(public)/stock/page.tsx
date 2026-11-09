import { FeaturePage, featureMetadata } from "@/components/public/features/feature-page";

export const metadata = featureMetadata("stock");

export default function Page() {
  return <FeaturePage slug="stock" />;
}
