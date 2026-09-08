# Printer and PDF Acceptance Matrix

The shop may choose any printer supported by the shop computer. Shop Ledger uses the browser's standard print dialog; it does not require a hard-coded printer model. The physical printer must still pass this matrix.

## Target environment

| Item | Shop value |
| --- | --- |
| Printer make/model | |
| Connection | USB / Network / Bluetooth |
| Paper width | 80mm |
| Computer operating system | |
| Browser and version | Chrome / Edge |
| Printer driver version | |

## Test cases

| Case | 80mm receipt | A4/PDF | Pass criteria |
| --- | --- | --- | --- |
| One short product | | | No clipping; totals readable |
| Long product/customer names | | | Text wraps without overlapping amounts |
| Ten or more lines | | | All lines and totals print |
| Full invoice with buyer TRN | | | Supplier and buyer tax fields visible |
| Walk-in invoice | | | Optional buyer block omitted cleanly |
| Large AED total | | | Digits and currency remain aligned |
| Credit-note reference | | | Document number and negative value readable |
| Reprint historical invoice | | | Matches original snapshot |

Use actual 80mm paper with margins disabled or minimized and scale at 100%. Record the approved printer and driver in the release checklist.
