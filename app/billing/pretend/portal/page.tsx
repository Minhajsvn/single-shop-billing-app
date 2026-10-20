import { PretendActions } from "../pretend-actions";
import { pretendShell, requirePretendOwner, TestBadge } from "../guard";

export const dynamic = "force-dynamic";

export default async function PretendPortalPage() {
  const { denied } = await requirePretendOwner();
  if (denied) return <main style={pretendShell}><p>{denied}</p></main>;

  return (
    <main style={pretendShell}>
      <TestBadge />
      <h1 style={{ margin: 0, fontSize: 22 }}>Manage billing</h1>
      <p style={{ margin: 0 }}>Each button sends the same event a real renewal, failure or cancellation would.</p>
      <PretendActions
        interval="month"
        buttons={[
          { action: "update_card", label: "Update card", tone: "primary", returnTo: "success" },
          { action: "cancel", label: "Cancel subscription at period end", returnTo: "success" },
          { action: "renew", label: "Simulate renewal", returnTo: "success" },
          { action: "fail_renewal", label: "Simulate failed renewal", returnTo: "success" },
          { action: "end_trial", label: "End trial now", returnTo: "success" },
          { action: "end_grace", label: "End grace now", returnTo: "success" },
          { label: "Back to Settings", returnTo: "cancel" },
        ]}
      />
    </main>
  );
}
