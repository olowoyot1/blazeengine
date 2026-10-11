-- Blaze Engine v4.3
-- Database convergence: durable next-action state and transaction-specific
-- finance document numbering. Safe to run repeatedly.

-- v4.3: database convergence for durable next-action state and transaction-specific
-- finance document numbering. This is intentionally idempotent so the application
-- can repair older production databases automatically.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS transaction_document_type text;
CREATE INDEX IF NOT EXISTS idx_sales_transaction_document_type ON sales(transaction_document_type);

CREATE TABLE IF NOT EXISTS sale_next_actions(
  sale_id uuid PRIMARY KEY REFERENCES sales(id) ON DELETE CASCADE,
  action_key text NOT NULL,
  title text NOT NULL,
  owner_role text,
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  due_date date,
  source_status text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sale_next_actions_owner ON sale_next_actions(owner_role, owner_user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_sale_next_actions_due ON sale_next_actions(due_date, source_status);

CREATE OR REPLACE FUNCTION sync_sale_transaction_document_numbers()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_type text;
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    RETURN NEW;
  END IF;
  IF NEW.invoice_number LIKE 'RCT-%' THEN
    v_type := 'SALES_RECEIPT';
    NEW.sales_receipt_no := NEW.invoice_number;
    NEW.sales_invoice_no := NULL;
    NEW.sales_order_no := NULL;
  ELSIF NEW.invoice_number LIKE 'INV-%' THEN
    v_type := 'INVOICE';
    NEW.sales_invoice_no := NEW.invoice_number;
    NEW.sales_receipt_no := COALESCE(NEW.sales_receipt_no, 'RCT-' || substring(NEW.invoice_number from 5));
    NEW.sales_order_no := NULL;
  ELSIF NEW.invoice_number LIKE 'SO-%' THEN
    v_type := 'SALES_ORDER';
    NEW.sales_order_no := NEW.invoice_number;
    NEW.sales_receipt_no := COALESCE(NEW.sales_receipt_no, 'RCT-' || substring(NEW.invoice_number from 4));
    NEW.sales_invoice_no := NULL;
  ELSE
    v_type := COALESCE(NEW.transaction_document_type, 'FINANCE_DOCUMENT');
  END IF;
  NEW.transaction_document_type := v_type;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_sale_transaction_document_numbers ON sales;
CREATE TRIGGER trg_sync_sale_transaction_document_numbers
BEFORE INSERT OR UPDATE OF invoice_number, sales_receipt_no, sales_order_no, sales_invoice_no
ON sales FOR EACH ROW EXECUTE FUNCTION sync_sale_transaction_document_numbers();

CREATE OR REPLACE FUNCTION refresh_sale_next_action(p_sale_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  s record; a record;
  v_key text; v_title text; v_role text; v_due date;
  v_old_key text; v_old_role text; v_old_user uuid; v_owner uuid;
BEGIN
  SELECT id, status, created_by, approved_at, allocation_date, sale_reference
    INTO s FROM sales WHERE id=p_sale_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT action_key, owner_role, owner_user_id
    INTO v_old_key, v_old_role, v_old_user
    FROM sale_next_actions WHERE sale_id=p_sale_id;

  IF s.status IN ('CANCELLED','ALLOCATED') THEN
    v_key := CASE s.status WHEN 'CANCELLED' THEN 'CLOSED' ELSE 'COMPLETED' END;
    v_title := CASE s.status WHEN 'CANCELLED' THEN 'Sale closed' ELSE 'Sale completed — allocated' END;
    v_role := NULL; v_due := NULL;
  ELSE
    SELECT step, approver_role, approver_user_id, created_at::date
      INTO a
      FROM approvals
     WHERE entity_type='SALE' AND entity_id=p_sale_id AND status='PENDING'
     ORDER BY round_no, seq, created_at LIMIT 1;

    IF a.step IS NOT NULL THEN
      v_key := 'APPROVAL_' || regexp_replace(upper(a.approver_role), '[^A-Z0-9]+', '_', 'g');
      v_title := a.step; v_role := a.approver_role; v_owner := a.approver_user_id; v_due := NULL;
    ELSE
      v_owner := NULL;
      CASE s.status
        WHEN 'PENDING_SALES_APPROVAL' THEN v_key := 'APPROVE_NEW_SALE'; v_title := 'Approve new sale'; v_role := 'SALES_MANAGER';
        WHEN 'DRAFT' THEN v_key := 'UPLOAD_PAYMENT_PROOF'; v_title := 'Upload payment proof'; v_role := 'SALES';
        WHEN 'PAYMENT_PROOF_SUBMITTED' THEN v_key := 'VERIFY_PAYMENT_GENERATE_DOCUMENT'; v_title := 'Verify payment and generate invoice / sales order'; v_role := 'ACCOUNTANT';
        WHEN 'INVOICE_ENTERED' THEN v_key := 'VERIFY_FINANCE_DOCUMENT'; v_title := 'Verify generated finance document'; v_role := 'SALES_MANAGER';
        WHEN 'SALES_APPROVED' THEN v_key := 'GENERATE_SALE_DOCUMENTS'; v_title := 'Generate Contract + Letter of Acknowledgement'; v_role := 'ACCOUNTANT';
        WHEN 'CONTRACT_PREPARED' THEN v_key := 'APPROVE_SALE_DOCUMENTS'; v_title := 'Review and approve generated sale documents'; v_role := 'SALES_MANAGER';
        WHEN 'ACCOUNT_DOCS_SENT' THEN v_key := 'OPEN_OPERATIONS_PORTAL'; v_title := 'Open Operations portal and start site workflow'; v_role := 'OPERATIONS_MANAGER';
        WHEN 'SITE_NOTIFIED' THEN v_key := 'COMPLETE_SITE_DOCUMENTS'; v_title := 'Complete deed of assignment and survey requirements'; v_role := 'OPERATIONS';
        WHEN 'OPS_DEED_UPLOADED' THEN v_key := 'UPLOAD_SURVEY_PLAN'; v_title := 'Upload survey plan'; v_role := 'SITE_MANAGER';
        WHEN 'OPS_DOCS_UPLOADED' THEN v_key := 'RUN_FINAL_AUDIT'; v_title := 'Run final audit and start approval chain'; v_role := 'SITE_MANAGER';
        WHEN 'IN_APPROVAL' THEN v_key := 'COMPLETE_APPROVAL_CHAIN'; v_title := 'Complete approval chain'; v_role := 'SALES_MANAGER';
        WHEN 'RETURNED' THEN v_key := 'CORRECT_AND_RESUBMIT'; v_title := 'Correct returned items and resubmit'; v_role := 'SALES_MANAGER';
        WHEN 'FULLY_APPROVED' THEN v_key := 'START_PRE_ALLOCATION'; v_title := 'Start pre-allocation'; v_role := 'SITE_MANAGER';
        WHEN 'PRE_ALLOCATION' THEN v_key := 'SET_ALLOCATION_DATE'; v_title := 'Set allocation date'; v_role := 'SITE_MANAGER';
        WHEN 'ALLOCATION_SCHEDULED' THEN v_key := 'CONFIRM_ALLOCATION'; v_title := 'Confirm allocation'; v_role := 'SITE_MANAGER';
        ELSE v_key := 'REVIEW_SALE'; v_title := 'Review sale and determine next workflow action'; v_role := 'SALES_MANAGER';
      END CASE;
    END IF;
    IF s.status='FULLY_APPROVED' AND s.approved_at IS NOT NULL THEN v_due := s.approved_at::date + 30;
    ELSIF s.status='ALLOCATION_SCHEDULED' AND s.allocation_date IS NOT NULL THEN v_due := s.allocation_date;
    END IF;
  END IF;

  IF v_role IS NOT NULL AND v_owner IS NULL THEN
    SELECT id INTO v_owner FROM users WHERE active AND role=v_role ORDER BY created_at LIMIT 1;
  END IF;

  INSERT INTO sale_next_actions(sale_id,action_key,title,owner_role,owner_user_id,due_date,source_status,updated_at)
  VALUES(p_sale_id,v_key,v_title,v_role,v_owner,v_due,s.status,now())
  ON CONFLICT (sale_id) DO UPDATE SET
    action_key=excluded.action_key,title=excluded.title,owner_role=excluded.owner_role,
    owner_user_id=excluded.owner_user_id,due_date=excluded.due_date,source_status=excluded.source_status,updated_at=now();

  IF v_key IS DISTINCT FROM v_old_key OR v_role IS DISTINCT FROM v_old_role OR v_owner IS DISTINCT FROM v_old_user THEN
    IF v_owner IS NOT NULL AND v_owner <> COALESCE(s.created_by, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      INSERT INTO notifications(user_id,title,message,link)
      VALUES(v_owner,'Next action assigned',v_title || ' — ' || COALESCE(s.sale_reference,'Sale'),'/sales/' || p_sale_id::text);
    ELSIF v_role IS NOT NULL THEN
      INSERT INTO notifications(user_id,title,message,link)
      SELECT id,'Next action assigned',v_title || ' — ' || COALESCE(s.sale_reference,'Sale'),'/sales/' || p_sale_id::text
      FROM users WHERE active AND role=v_role
        AND id <> COALESCE(s.created_by, '00000000-0000-0000-0000-000000000000'::uuid);
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION trg_sales_next_action()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM refresh_sale_next_action(NEW.id); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_sales_next_action ON sales;
CREATE TRIGGER trg_sales_next_action
AFTER INSERT OR UPDATE OF status,approved_at,allocation_date ON sales
FOR EACH ROW EXECUTE FUNCTION trg_sales_next_action();

CREATE OR REPLACE FUNCTION trg_approval_next_action()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entity_type='SALE' THEN PERFORM refresh_sale_next_action(NEW.entity_id); END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_approval_next_action ON approvals;
CREATE TRIGGER trg_approval_next_action
AFTER INSERT OR UPDATE OF status,approver_user_id,acted_at ON approvals
FOR EACH ROW EXECUTE FUNCTION trg_approval_next_action();

UPDATE sales SET transaction_document_type = CASE
  WHEN invoice_number LIKE 'RCT-%' THEN 'SALES_RECEIPT'
  WHEN invoice_number LIKE 'INV-%' THEN 'INVOICE'
  WHEN invoice_number LIKE 'SO-%' THEN 'SALES_ORDER'
  ELSE transaction_document_type END
WHERE invoice_number IS NOT NULL;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM sales LOOP PERFORM refresh_sale_next_action(r.id); END LOOP;
END $$;


