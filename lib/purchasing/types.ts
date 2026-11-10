// Stage 2D: suppliers and deliveries as the server functions return them (202611110057/058).
export type Supplier = { id: string; name: string; trn: string | null; phone: string | null; email: string | null; note: string | null; archived: boolean };

export type ReceiptSummary = {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierTrn: string | null;
  supplierInvoice: string | null;
  invoiceDate: string;
  lineCount: number;
  netFils: number;
  vatFils: number;
  grossFils: number;
  createdAt: string;
  voidedAt: string | null;
};

export type ReceiptLine = {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitCostFils: number;
  lineNetFils: number;
  costBeforeFils: number | null;
  costAfterFils: number;
};

export type ReceiptDetail = ReceiptSummary & { note: string | null; voidReason: string | null; receivedBy: string; lines: ReceiptLine[] };

/** What the record page sends (record_purchase_receipt's payload). */
export type ReceiptPayload = {
  id: string;
  supplierId: string;
  supplierInvoice?: string;
  invoiceDate: string;
  vatFils: number;
  note?: string;
  lines: { productId: string; quantity: number; unitCostFils: number }[];
};

export type LastDelivery = { invoiceDate: string; supplierName: string; unitCostFils: number };
