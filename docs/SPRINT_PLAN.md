# Sprint Plan

Team: one full-stack developer  
Cadence: four two-week delivery sprints after the five-day planning phase  
Estimation: small (up to half day), medium (one to two days), large (three to four days)

## Definition of Ready

- User story links to a PRD requirement.
- Acceptance criteria include success, validation, empty, error, and offline behavior where relevant.
- Required data fields and permission rules are known.
- Design state and dependencies are identified.
- Work fits within four developer-days or is split.

## Sprint 1 — Foundation and inventory

Goal: securely configure one shop and maintain auditable stock.

- Project scaffold, quality gates, environment templates, and preview deployment — M.
- Supabase schema/migrations, owner authentication, RLS, and audit foundation — L.
- Shop onboarding, settings, till registration, and PIN shell — L.
- Application shell, navigation, responsive layout, and shared UI primitives — M.
- Product CRUD, SKU/barcode rules, active state, and low-stock threshold — L.
- Stock receipt/correction workflow and immutable movement history — L.
- Seed/demo fixtures and foundational tests — M.

Exit: the deployed preview supports secure setup, products, and auditable inventory.

## Sprint 2 — Register, checkout, and invoices

Goal: complete online Cash/Card sales with correct stock, VAT, and fiscal output.

- Register opening, cash adjustments, closing, and variance — L.
- POS catalog/search/barcode/cart and custom lines — L.
- VAT calculation library and invoice snapshot types — M.
- Transactional checkout, payment, stock deduction, and audit — L.
- Invoice-number reservation — M.
- 80mm print layout and A4 PDF — L.
- Checkout/register integration and end-to-end tests — M.

Exit: online sales reconcile across invoice, payment, inventory, and register records.

## Sprint 3 — Customers, returns, and offline

Goal: support customer history, auditable corrections, and short outages.

Status: implemented in the local-first application on 30 August 2026; hosted batch synchronization is schema-ready and awaits Supabase credentials/server RPC deployment.

- Customer CRUD, TRN validation, and purchase history — M.
- Full business invoice selection and layout — M.
- Partial/full credit-note workflow and stock/payment reversal — L.
- PWA shell, IndexedDB schema, encryption, and bootstrap cache — L.
- Offline register/POS operations and reserved numbering — L.
- Idempotent batch synchronization, retry UI, and conflict diagnostics — L.
- Offline/reconnect automated tests — M.

Exit: core till work continues offline and synchronizes exactly once.

## Sprint 4 — Reports, hardening, and launch

Goal: deliver a production-ready operational MVP.

Status: local application implementation and launch documentation completed on 31 August 2026. Production promotion remains gated by Supabase/hosting configuration, printer acceptance, tax-adviser approval, backup drill, and owner UAT.

- Overview metrics, daily report, VAT/payment breakdowns, and low-stock panel — L.
- CSV/print exports — M.
- Accessibility, keyboard checkout, performance, and responsive hardening — M.
- RLS/security validation and error observability — M.
- Printer/PDF matrix and complete business-day regression — M.
- Backup/restore drill, operating guide, and UAT fixes — L.
- Production deployment, release checklist, and rollback validation — M.

Exit: UAT and release gates pass; the approved build is ready for the registered shop device.

## Risks tracked from Sprint 1

- Thermal printer browser differences: validate the target printer during Sprint 1, not at release.
- Offline fiscal numbering: reserve and test ranges before enabling offline checkout.
- VAT/legal interpretation: obtain adviser sign-off before production.
- OneDrive development path: watch for file locking and long-path issues; relocate only if they materially affect tooling.
- Scope growth: new accounting, supplier, multi-till, or gateway features enter a post-MVP backlog.
