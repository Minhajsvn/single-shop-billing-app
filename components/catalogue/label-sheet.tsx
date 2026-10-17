"use client";

import { createPortal } from "react-dom";
import { barcodeFor } from "@/lib/catalogue/barcode";
import { formatAED, type Product } from "@/lib/domain";

export type LabelSize = "50x25" | "40x30";
export const LABEL_PAGE_SIZE: Record<LabelSize, string> = { "50x25": "50mm 25mm", "40x30": "40mm 30mm" };
const QUIET_ZONE = 10;

/** Bars as one <rect> per run of "1" modules, with a quiet zone either side so scanners find the edges. */
function BarcodeSvg({ modules, label }: { modules: string; label: string }) {
  const runs: { x: number; width: number }[] = [];
  for (let index = 0; index < modules.length; index++) {
    if (modules[index] !== "1") continue;
    const last = runs[runs.length - 1];
    if (last && last.x + last.width === index + QUIET_ZONE) last.width += 1;
    else runs.push({ x: index + QUIET_ZONE, width: 1 });
  }
  return (
    <svg className="label-barcode" viewBox={`0 0 ${modules.length + QUIET_ZONE * 2} 40`} preserveAspectRatio="none" shapeRendering="crispEdges" role="img" aria-label={label}>
      {runs.map((run) => <rect key={run.x} x={run.x} y={0} width={run.width} height={40} />)}
    </svg>
  );
}

/** The printable labels, mounted directly under <body> so no clipped or positioned ancestor affects printing. */
export function LabelSheet({ items, size }: { items: { product: Product; quantity: number }[]; size: LabelSize }) {
  const labels = items.flatMap(({ product, quantity }) => {
    const code = barcodeFor(product);
    return Array.from({ length: quantity }, (_, copy) => (
      <div className="label" key={`${product.id}-${copy}`}>
        <div className="label-name">{product.name}</div>
        <div className="label-price">{formatAED(product.priceFils)}</div>
        <BarcodeSvg modules={code.modules} label={`Barcode ${code.value}`} />
        <div className="label-code">{code.value}</div>
      </div>
    ));
  });
  return createPortal(<div className={`label-sheet size-${size}`} aria-hidden="true">{labels}</div>, document.body);
}
