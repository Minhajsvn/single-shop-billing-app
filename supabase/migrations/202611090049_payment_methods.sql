-- Stage 2B: bank transfer as a payment method, and "split" as a sale's or refund's summary when it was paid by more
-- than one method. Kept in its own migration: a new enum value cannot be used in the transaction that adds it.
alter type public.payment_method add value if not exists 'transfer';
alter type public.payment_method add value if not exists 'split';
