-- Landblaze Engine v3.7
-- Expense supporting documents + workflow support.
CREATE TABLE IF NOT EXISTS expense_documents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  document_type text NOT NULL DEFAULT 'SUPPORTING_DOCUMENT',
  document_name text NOT NULL,
  uploaded_file_id uuid REFERENCES uploaded_files(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expense_docs_expense ON expense_documents(expense_id, created_at);

-- Expenses that were already at the old post-CEO state are equivalent to the
-- new fully-approved state and can proceed to Finance/Accounts disbursement.
UPDATE expenses SET status='FULLY_APPROVED', updated_at=now()
WHERE status='EXPENSE_APPROVED';
