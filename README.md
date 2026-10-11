# Shop Ledger UAE

Single-shop sales, VAT billing, inventory, customer history, and daily cash-register management.

## Current state

All four MVP implementation sprints are complete in the local-first application. The current build includes daily reports and CSV/print export, customer and credit-note workflows, encrypted offline storage, portable JSON backup/restore, keyboard checkout, secure response headers, runtime recovery, mobile navigation, and production release documentation. Supabase migrations and RLS foundations are included, but real hosted synchronization and production promotion remain disabled until credentials, server transaction functions, and release approvals are configured.

The browser demo keeps its working state in this device. Installability and service-worker offline reloads should be validated with `npm run build` followed by `npm start`; Next.js development mode is not a reliable PWA test environment.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Configuration

Copy `.env.example` to `.env.local` and add Supabase project values when the hosted backend is available.

## Planning documents

- [Product overview and marketing brief](docs/PRODUCT_OVERVIEW_AND_MARKETING.md)
- [Product requirements](docs/PRD.md)
- [Product design](docs/PRODUCT_DESIGN.md)
- [Technical design](docs/TECHNICAL_DESIGN.md)
- [Test and release plan](docs/TEST_AND_RELEASE.md)
- [Sprint plan](docs/SPRINT_PLAN.md)
- [Owner setup checklist](docs/OWNER_CHECKLIST.md)
- [Operating guide](docs/OPERATING_GUIDE.md)
- [Backup/restore drill](docs/BACKUP_RESTORE_DRILL.md)
- [Printer test matrix](docs/PRINTER_TEST_MATRIX.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
