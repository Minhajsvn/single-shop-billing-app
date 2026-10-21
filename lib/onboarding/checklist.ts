export type ChecklistFlags = { hasProduct: boolean; hasOpenedRegister: boolean; hasSale: boolean };

type ChecklistContext = { role: string | null; mode: "hosted" | "sample" | "unconfigured" };
export type ChecklistStep = { label: string; button: string; href: string };

const STEPS: Array<{ key: keyof ChecklistFlags } & ChecklistStep> = [
  { key: "hasProduct", label: "Add your products", button: "Add products", href: "/inventory" },
  { key: "hasOpenedRegister", label: "Open the register", button: "Open register", href: "/register" },
  { key: "hasSale", label: "Make your first sale", button: "New sale", href: "/sale" },
];

/** The "Get ready to sell" strip: hosted owners only. `next` is the first unfinished step, null once all three are done. */
export function checklistView(flags: ChecklistFlags | null, ctx: ChecklistContext): { done: number; next: ChecklistStep | null } | null {
  if (!flags || ctx.role !== "owner" || ctx.mode !== "hosted") return null;
  const done = STEPS.filter((step) => flags[step.key]).length;
  const first = STEPS.find((step) => !flags[step.key]);
  return { done, next: first ? { label: first.label, button: first.button, href: first.href } : null };
}
