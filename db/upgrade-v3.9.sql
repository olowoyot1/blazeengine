-- Blaze Engine v3.9
-- Financial records are append-only. Corrections/cancellations must use the
-- existing workflow/reversal mechanisms; direct DELETE is prohibited at DB level.
-- Safe to run repeatedly.

ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES users(id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS void_reason text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES users(id);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS void_reason text;

CREATE OR REPLACE FUNCTION prevent_financial_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Financial transactions are append-only; use the reversal or cancellation workflow instead.'
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_sales_delete ON sales;
CREATE TRIGGER trg_prevent_sales_delete
BEFORE DELETE ON sales
FOR EACH ROW EXECUTE FUNCTION prevent_financial_delete();

DROP TRIGGER IF EXISTS trg_prevent_expenses_delete ON expenses;
CREATE TRIGGER trg_prevent_expenses_delete
BEFORE DELETE ON expenses
FOR EACH ROW EXECUTE FUNCTION prevent_financial_delete();
