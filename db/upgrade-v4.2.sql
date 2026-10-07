-- Blaze Engine v4.2
-- Fix the v4.0 sale next-action trigger for production databases.
-- The v4.0 function selected a RECORD without sale_reference but later
-- referenced s.sale_reference when creating notifications.
-- Safe to run repeatedly.

DO $$
DECLARE
  v_def text;
  v_fixed text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_def
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('refresh_sale_next_action(uuid)');

  IF v_def IS NOT NULL
     AND position('s.sale_reference' IN v_def) > 0
     AND position('SELECT id, status, created_by, approved_at, allocation_date, sale_reference' IN v_def) = 0 THEN
    v_fixed := replace(
      v_def,
      'SELECT id, status, created_by, approved_at, allocation_date',
      'SELECT id, status, created_by, approved_at, allocation_date, sale_reference'
    );
    IF v_fixed <> v_def THEN
      EXECUTE v_fixed;
    END IF;
  END IF;
END $$;
