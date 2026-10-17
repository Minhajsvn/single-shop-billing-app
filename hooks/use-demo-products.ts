"use client";

import { useMemo } from "react";
import { addProduct, adjustStock, applyImport, productLimit, setProductActive, updateProduct, useDemoStore } from "@/lib/demo-store";
import { productSyncProblems } from "@/lib/store/product-sync";

export function useDemoProducts() {
  const store = useDemoStore();
  // Products the server refused (duplicate SKU or barcode, plan limit), keyed by product id.
  const syncProblems = useMemo(() => productSyncProblems(store.syncOperations), [store.syncOperations]);
  return {
    products: store.products,
    movements: store.stockMovements,
    syncOperations: store.syncOperations,
    syncProblems,
    addProduct,
    updateProduct,
    setProductActive,
    applyImport,
    productLimit,
    adjustStock,
    hydrated: true,
  };
}
