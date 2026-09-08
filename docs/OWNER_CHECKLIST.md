# Owner Setup Checklist

These items do not block the completed local MVP. They are mandatory before hosted integration, printer acceptance, and production release.

## Business and device details

- Confirm the legal business name exactly as registered.
- Provide the 15-digit UAE TRN, registered address, and shop phone number.
- Choose the invoice prefix, currently `SL`.
- Confirm the receipt footer text.
- Provide the make and model of the 80mm thermal printer and the shop computer's browser/operating system.
- Provide one representative product list with name, SKU, barcode, VAT-inclusive price, current stock, and low-stock threshold.

## Hosted backend setup

1. Create a Supabase project in the preferred organization and region.
2. Add its URL and public anonymous key to `.env.local` using `.env.example`.
3. Keep the service-role key private. Add it directly to the local environment and hosting dashboard; do not paste it into chat or commit it.
4. Confirm the email address that will own the shop account.

## Before production

- Ask the business's UAE tax adviser to approve invoice wording, VAT treatment, and the simplified/full invoice rules.
- Print the supplied 80mm test receipt on the actual shop printer.
- Complete the full simulated-business-day UAT script in `TEST_AND_RELEASE.md`.
- Approve the backup/restore test and production launch checklist.
