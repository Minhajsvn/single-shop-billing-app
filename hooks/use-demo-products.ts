"use client";

import { addProduct, adjustStock, useDemoStore } from "@/lib/demo-store";

export function useDemoProducts() {
  const store = useDemoStore();
  return { products: store.products, movements: store.stockMovements, addProduct, adjustStock, hydrated: true };
}
