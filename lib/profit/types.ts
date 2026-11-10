/** The jsonb profit_report returns (spec 2C §4.4). Amounts are fils; margin is a percentage with one decimal. */
export type ProfitTotals = { netFils: number; costedNetFils: number; costFils: number; profitFils: number; marginPct: number | null; uncostedNetFils: number; uncostedLines: number };
export type ProfitDay = { date: string; netFils: number; costFils: number; profitFils: number };
export type ProfitCategory = { categoryId: string | null; name: string; netFils: number; costFils: number; profitFils: number; marginPct: number | null };
export type ProfitProduct = { productId: string | null; name: string; quantity: number; netFils: number; costFils: number; profitFils: number; marginPct: number | null };
export type ProfitReport = { totals: ProfitTotals; byDay: ProfitDay[]; byCategory: ProfitCategory[]; byProduct: ProfitProduct[] };
