# Shop Ledger Operating Guide

## Start the day

1. Open Shop Ledger on the registered shop computer.
2. Confirm the sidebar says the device is ready or working offline.
3. Open **Register**, count the physical drawer cash, and enter the opening balance.
4. Review **Inventory** for low-stock items before selling.

## Make a sale

1. Open **New sale** and search by name, SKU, barcode, or press `/` to focus search.
2. Add products and confirm quantities and the VAT-inclusive total.
3. Leave the customer as Walk-in for a simplified invoice, or select a saved business customer for a full tax invoice.
4. Select Cash or Card. Keyboard operators may press `F2` for Cash or `F3` for Card.
5. Print the 80mm receipt or save/print the A4 invoice from the completed invoice screen.

Card payments are recorded only after the external card terminal confirms payment. Shop Ledger does not charge the card itself.

## Process a return

1. Find the original invoice under **Sales**.
2. Select **Return items**, enter the returned quantity, and issue the credit note.
3. Refund through the original payment method. Stock items are restored automatically.
4. Never edit or delete the original invoice; the credit note is the audit record.

## Work during a short outage

- Keep the application open. A ready cached till can continue checkout locally.
- Do not clear browser data, uninstall the app, or switch computers.
- Pending operations appear in the sidebar and Settings outbox.
- When connectivity returns, wait for **Device ready · synced** before closing the browser.
- If a sync item fails, preserve the invoice and download a backup before troubleshooting.

## Close the day

1. Review **Reports** for the Dubai business date and export the CSV.
2. In **Register**, count physical cash and close the register. Review any variance.
3. In **Settings**, download the JSON backup and store it outside the shop computer.
4. Keep the daily CSV, JSON backup, and any signed reconciliation record according to the business retention policy.

## Recovery rules

- Restore only a Shop Ledger JSON backup with schema version 3.
- Restoring replaces the local device state. Download the current state first when possible.
- After restore, compare the latest invoice number, product stock, register status, and report totals with the backup source.
- Hosted production recovery must follow the managed Supabase restore procedure; local JSON restore is not a replacement for database backups.
