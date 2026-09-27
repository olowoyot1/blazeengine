-- Landblaze Engine v3.8
-- Separate evidence channels: Sales payment proof, Expense source documents, Finance payment advice/bank receipt.
-- Safe to run repeatedly.

ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'document';

CREATE TABLE IF NOT EXISTS expense_payment_documents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  document_type text NOT NULL DEFAULT 'PAYMENT_ADVICE',
  document_name text NOT NULL,
  uploaded_file_id uuid REFERENCES uploaded_files(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES users(id),
  bank_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expense_payment_docs_expense ON expense_payment_documents(expense_id, created_at);
