import type { DemoState, Product } from "../domain.ts";

function adjust(products: Product[], deltas: Map<string, number>): Product[] {
  return products.map((product) => deltas.has(product.id) ? { ...product, stock: product.stock + deltas.get(product.id)! } : product);
}

export function mergeSnapshot(server: DemoState, local: DemoState): DemoState {
  const kept = local.syncOperations.filter((operation) => operation.status !== "synced");
  const merged: DemoState = { ...server, syncOperations: kept };
  const deltas = new Map<string, number>();
  const addDelta = (productId: string | undefined, delta: number) => {
    if (productId) deltas.set(productId, (deltas.get(productId) ?? 0) + delta);
  };

  for (const operation of [...kept].sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    const payload = operation.payload;
    if (!payload) continue;
    if (operation.entity === "sale" && "sale" in payload && !merged.sales.some((sale) => sale.id === payload.sale.id)) {
      merged.sales = [payload.sale, ...merged.sales];
      for (const line of payload.sale.lines) addDelta(line.productId, -line.quantity);
    } else if (operation.entity === "credit-note" && "creditNote" in payload && !merged.creditNotes.some((note) => note.id === payload.creditNote.id)) {
      merged.creditNotes = [payload.creditNote, ...merged.creditNotes];
      for (const line of payload.creditNote.lines) addDelta(line.productId, line.quantity);
    } else if (operation.entity === "customer" && "customer" in payload && operation.status === "pending") {
      merged.customers = [payload.customer, ...merged.customers.filter((customer) => customer.id !== payload.customer.id)];
    } else if (operation.entity === "stock" && "movement" in payload && !merged.stockMovements.some((movement) => movement.id === payload.movement.id)) {
      merged.stockMovements = [payload.movement, ...merged.stockMovements];
      if (!merged.products.some((product) => product.id === payload.product.id)) merged.products = [{ ...payload.product, stock: 0 }, ...merged.products];
      addDelta(payload.movement.productId, payload.movement.delta);
    } else if (operation.entity === "register" && "action" in payload && operation.status === "pending") {
      merged.register = local.register ?? merged.register;
    }
  }

  merged.products = adjust(merged.products, deltas);
  return merged;
}
