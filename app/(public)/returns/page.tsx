import { FeaturePage, featureMetadata } from "@/components/public/features/feature-page";

export const metadata = featureMetadata("returns");

export default function Page() {
  return <FeaturePage slug="returns" />;
}
