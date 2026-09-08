# Backup and Restore Drill

Run this in a non-production browser profile before launch and once per quarter.

## Procedure

1. Complete a Cash invoice, a Card invoice, and one partial return.
2. Record invoice count, gross report total, current stock, register status, and latest invoice number.
3. Download the JSON backup from **Settings → Backup and recovery**.
4. Copy the file to a separate encrypted location and verify it is non-empty.
5. Open a clean non-production browser profile and restore the backup.
6. Verify customer history, invoices, credit notes, stock, register values, and the daily report against step 2.
7. Complete one new invoice and confirm numbering continues without collision.

## Evidence

| Field | Result |
| --- | --- |
| Drill date | |
| Operator | |
| Backup filename | |
| Invoice/report totals matched | Pass / Fail |
| Stock matched | Pass / Fail |
| Register matched | Pass / Fail |
| New invoice number unique | Pass / Fail |
| Issues and resolution | |

A failed comparison blocks production release until the cause is corrected and the entire drill passes.
