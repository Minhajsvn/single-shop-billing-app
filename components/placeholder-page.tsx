import { HourglassMedium } from "@/components/icons";

export function PlaceholderPage({ eyebrow, title, description, sprint }: { eyebrow: string; title: string; description: string; sprint: string }) {
  return (
    <>
      <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1 className="page-title">{title}</h1><p className="page-copy">{description}</p></div><span className="badge blue">{sprint}</span></div>
      <section className="panel"><div className="empty"><HourglassMedium size={32} weight="duotone" /><h3>Foundation prepared</h3><p>This workflow is documented and scheduled in the delivery backlog. Its implementation starts in {sprint.toLowerCase()}.</p></div></section>
    </>
  );
}
