import type { Customer, Product } from "@/lib/domain";
import { createClient } from "@/lib/supabase/client";

const CONTEXT_KEY = "shop-ledger-cloud-context-v1";
const PRODUCT_MAP_KEY = "shop-ledger-cloud-product-map-v1";
const CUSTOMER_MAP_KEY = "shop-ledger-cloud-customer-map-v1";

type CloudContext = { businessId: string; deviceName: string };

function readContext(): CloudContext | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(CONTEXT_KEY) ?? "null") as Partial<CloudContext> | null;
    return value?.businessId ? { businessId: value.businessId, deviceName: value.deviceName ?? "Device 01" } : null;
  } catch {
    return null;
  }
}

function readMap(key: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function saveMap(key: string, value: Record<string, string>) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

export type CatalogSyncResult = {
  products: number;
  customers: number;
  errors: string[];
};

export async function syncCatalogToSupabase(products: Product[], customers: Customer[]): Promise<CatalogSyncResult> {
  const context = readContext();
  if (!context) return { products: 0, customers: 0, errors: ["This device is not linked to a Supabase business yet."] };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { products: 0, customers: 0, errors: ["Your secure session has expired. Sign in again before syncing."] };

  const result: CatalogSyncResult = { products: 0, customers: 0, errors: [] };
  const productMap = readMap(PRODUCT_MAP_KEY);
  const customerMap = readMap(CUSTOMER_MAP_KEY);

  const { data: existingProducts, error: productsError } = await supabase
    .from("products")
    .select("id, sku")
    .eq("business_id", context.businessId);
  if (productsError) return { ...result, errors: [productsError.message] };
  const productsBySku = new Map((existingProducts ?? []).map((item) => [item.sku as string, item.id as string]));

  for (const product of products) {
    const existingId = productMap[product.id] ?? productsBySku.get(product.sku);
    const payload = {
      business_id: context.businessId,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode || null,
      price_fils: product.priceFils,
      stock_quantity: product.stock,
      low_stock_threshold: product.lowStockThreshold,
      status: product.active ? "active" : "inactive",
    };
    const query = existingId
      ? supabase.from("products").update(payload).eq("id", existingId).eq("business_id", context.businessId).select("id").single()
      : supabase.from("products").insert(payload).select("id").single();
    const { data, error } = await query;
    if (error || !data) {
      result.errors.push(`Product ${product.sku}: ${error?.message ?? "could not be saved"}`);
      continue;
    }
    productMap[product.id] = data.id as string;
    result.products += 1;
  }

  const { data: existingCustomers, error: customersError } = await supabase
    .from("customers")
    .select("id, name, phone, trn")
    .eq("business_id", context.businessId);
  if (customersError) {
    saveMap(PRODUCT_MAP_KEY, productMap);
    return { ...result, errors: [...result.errors, customersError.message] };
  }

  for (const customer of customers) {
    const existing = customerMap[customer.id]
      ? { id: customerMap[customer.id] }
      : (existingCustomers ?? []).find((item) => (customer.trn && item.trn === customer.trn) || (!customer.trn && item.name === customer.name && item.phone === customer.phone));
    const payload = {
      business_id: context.businessId,
      name: customer.name,
      phone: customer.phone,
      email: customer.email || null,
      address: customer.address || null,
      trn: customer.trn || null,
    };
    const query = existing
      ? supabase.from("customers").update(payload).eq("id", existing.id).eq("business_id", context.businessId).select("id").single()
      : supabase.from("customers").insert(payload).select("id").single();
    const { data, error } = await query;
    if (error || !data) {
      result.errors.push(`Customer ${customer.name}: ${error?.message ?? "could not be saved"}`);
      continue;
    }
    customerMap[customer.id] = data.id as string;
    result.customers += 1;
  }

  saveMap(PRODUCT_MAP_KEY, productMap);
  saveMap(CUSTOMER_MAP_KEY, customerMap);
  return result;
}
