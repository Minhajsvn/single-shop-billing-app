-- Stage 1D: spreadsheet imports record stock counts. Kept in its own migration because a new enum
-- value cannot be used inside the transaction that adds it.
alter type public.stock_movement_type add value if not exists 'import_count';
