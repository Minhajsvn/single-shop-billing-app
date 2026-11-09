import { FeaturePage, featureMetadata } from "@/components/public/features/feature-page";

export const metadata = featureMetadata("offline-pos");

export default function Page() {
  return <FeaturePage slug="offline-pos" />;
}
