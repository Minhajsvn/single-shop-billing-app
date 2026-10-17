import type { DemoState, Product } from "../domain.ts";

/** Stock changes from not-yet-synced operations, in sync order: a delta adds; an import count sets the stock outright. */
type StockStep = { kind: "delta" | "set"; value: number };

function applySteps(products: Product[], steps: Map<string, StockStep[]>): Product[] {
  return products.map((product) => {
    const productSteps = steps.get(product.id);
    if (!productSteps) return product;
    const stock = productSteps.reduce((current, step) => step.kind === "set" ? step.value : current + step.value, product.stock);
    return { ...product, stock };
  });
}

export function mergeSnapshot(server: DemoState, local: DemoState): DemoState {
  const kept = local.syncOperations.filter((operation) => operation.status !== "synced");
  const merged: DemoState = { ...server, syncOperations: kept };
  const steps = new Map<string, StockStep[]>();
  const addStep = (productId: string | undefined, step: StockStep) => {
    if (productId) steps.set(productId, [...(steps.get(productId) ?? []), step]);
  };

  for (const operation of [...kept].sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    const payload = operation.payload;
    if (!payload) continue;
    if (operation.entity === "sale" && "sale" in payload && !merged.sales.some((sale) => sale.id === payload.sale.id)) {
      merged.sales = [payload.sale, ...merged.sales];
      for (const line of payload.sale.lines) addStep(line.productId, { kind: "delta", value: -line.quantity });
    } else if (operation.entity === "credit-note" && "creditNote" in payload && !merged.creditNotes.some((note) => note.id === payload.creditNote.id)) {
      merged.creditNotes = [payload.creditNote, ...merged.creditNotes];
      for (const line of payload.creditNote.lines) addStep(line.productId, { kind: "delta", value: line.quantity });
    } else if (operation.entity === "customer" && "customer" in payload && operation.status === "pending") {
      merged.customers = [payload.customer, ...merged.customers.filter((customer) => customer.id !== payload.customer.id)];
    } else if (operation.entity === "product" && "product" in payload && !("movement" in payload)) {
      // Pending or refused product changes stay visible in this browser; stock always comes from the server and movements.
      const record = payload.product;
      merged.products = merged.products.some((product) => product.id === record.id)
        ? merged.products.map((product) => product.id === record.id ? { ...record, stock: product.stock } : product)
        : [{ ...record, stock: 0 }, ...merged.products];
    } else if (operation.entity === "stock" && "movement" in payload && !merged.stockMovements.some((movement) => movement.id === payload.movement.id)) {
      merged.stockMovements = [payload.movement, ...merged.stockMovements];
      if (payload.product && !merged.products.some((product) => product.id === payload.product!.id)) merged.products = [{ ...payload.product, stock: 0 }, ...merged.products];
      addStep(payload.movement.productId, payload.movement.type === "import-count" && payload.countedStock !== undefined
        ? { kind: "set", value: payload.countedStock }
        : { kind: "delta", value: payload.movement.delta });
    } else if (operation.entity === "register" && "action" in payload && operation.status === "pending") {
      merged.register = local.register ?? merged.register;
    }
  }

  merged.products = applySteps(merged.products, steps);
  return merged;
}
