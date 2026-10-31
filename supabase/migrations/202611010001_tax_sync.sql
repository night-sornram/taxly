-- Tax sync: snapshots now carry tax years, manual incomes and social security
-- deductions next to the ledger. Run once after 202610310001_ledger_sync.sql.
CREATE OR REPLACE FUNCTION public.taxly_get_ledger() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT coalesce((SELECT jsonb_build_object('revision',h.revision,'snapshot',s.snapshot)
    FROM public.taxly_sync_heads h JOIN public.taxly_sync_snapshots s ON s.owner_id=h.owner_id
    WHERE h.owner_id=(SELECT auth.uid())), '{"revision":0,"snapshot":{"categories":[],"entries":[],"tax":{"years":[],"incomes":[],"deductions":[]}}}'::jsonb);
$$;

CREATE OR REPLACE FUNCTION public.taxly_put_ledger(expected_revision bigint, next_snapshot jsonb, operation_id uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  owner uuid := auth.uid();
  current_revision bigint;
  receipt_revision bigint;
  receipt_expected bigint;
  receipt_hash bytea;
  request_hash bytea;
  category jsonb;
  entry jsonb;
  tax jsonb;
  category_ids text[] := '{}';
  category_kinds jsonb := '{}'::jsonb;
  names text[] := '{}';
  key text;
  category_kind text;
  tax_year jsonb;
  income jsonb;
  deduction jsonb;
  years int[] := '{}';
  salary_keys text[] := '{}';
  deduction_months text[] := '{}';
  tax_ids text[] := '{}';
BEGIN
  IF owner IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF operation_id IS NULL OR expected_revision IS NULL OR expected_revision < 0 OR expected_revision >= 9007199254740991
    OR next_snapshot IS NULL OR jsonb_typeof(next_snapshot) <> 'object'
    OR jsonb_typeof(next_snapshot->'categories') IS DISTINCT FROM 'array'
    OR jsonb_typeof(next_snapshot->'entries') IS DISTINCT FROM 'array'
    -- The tax key is required so an outdated client cannot silently drop tax rows.
    OR (SELECT count(*) FROM jsonb_object_keys(next_snapshot)) <> 3
    OR jsonb_typeof(next_snapshot->'tax') IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(next_snapshot->'tax')) <> 3
    OR jsonb_typeof(next_snapshot->'tax'->'years') IS DISTINCT FROM 'array'
    OR jsonb_typeof(next_snapshot->'tax'->'incomes') IS DISTINCT FROM 'array'
    OR jsonb_typeof(next_snapshot->'tax'->'deductions') IS DISTINCT FROM 'array'
    OR jsonb_array_length(next_snapshot->'tax'->'years') > 20
    OR jsonb_array_length(next_snapshot->'tax'->'incomes') > 50000
    OR jsonb_array_length(next_snapshot->'tax'->'deductions') > 1000
    OR octet_length(next_snapshot::text) > 20971520
    OR jsonb_array_length(next_snapshot->'categories') > 1000
    OR jsonb_array_length(next_snapshot->'entries') > 200000 THEN
    RAISE EXCEPTION 'Invalid ledger snapshot' USING ERRCODE='22023';
  END IF;
  request_hash := pg_catalog.sha256(pg_catalog.convert_to(next_snapshot::text,'UTF8'));
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(next_snapshot->'entries') e GROUP BY e->>'id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate entry ID' USING ERRCODE='22023';
  END IF;
  FOR category IN SELECT value FROM jsonb_array_elements(next_snapshot->'categories') LOOP
    IF jsonb_typeof(category) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(category)) <> 3
      OR jsonb_typeof(category->'id') IS DISTINCT FROM 'string'
      OR length(btrim(category->>'id')) NOT BETWEEN 1 AND 128
      OR (category->>'id') ~ '[[:cntrl:]]'
      OR category->>'kind' IS NULL OR category->>'kind' NOT IN ('income','expense')
      OR jsonb_typeof(category->'name') IS DISTINCT FROM 'string'
      OR length(btrim(category->>'name')) NOT BETWEEN 1 AND 50
      OR category->>'id' = ANY(category_ids) THEN
      RAISE EXCEPTION 'Invalid ledger category' USING ERRCODE='22023';
    END IF;
    key := (category->>'kind') || ':' || btrim(category->>'name');
    IF key = ANY(names) THEN RAISE EXCEPTION 'Duplicate category name' USING ERRCODE='22023'; END IF;
    names := array_append(names,key);
    category_ids := array_append(category_ids,category->>'id');
    category_kinds := category_kinds || jsonb_build_object(category->>'id',category->>'kind');
  END LOOP;
  FOR entry IN SELECT value FROM jsonb_array_elements(next_snapshot->'entries') LOOP
    IF jsonb_typeof(entry) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(entry)) <> 6
      OR jsonb_typeof(entry->'id') IS DISTINCT FROM 'string'
      OR length(btrim(entry->>'id')) NOT BETWEEN 1 AND 128 OR (entry->>'id') ~ '[[:cntrl:]]'
      OR entry->>'category_id' IS NULL OR NOT (category_kinds ? (entry->>'category_id'))
      OR jsonb_typeof(entry->'amount') IS DISTINCT FROM 'string'
      OR (entry->>'amount') !~ '^[0-9]+([.][0-9]{1,2})?$'
      OR length(entry->>'amount') > 20
      OR jsonb_typeof(entry->'date') IS DISTINCT FROM 'string'
      OR (entry->>'date') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$|^2100-[0-9]{2}-[0-9]{2}$'
      OR jsonb_typeof(entry->'note') IS DISTINCT FROM 'string' OR length(entry->>'note') > 500 THEN
      RAISE EXCEPTION 'Invalid ledger entry' USING ERRCODE='22023';
    END IF;
    IF (entry->>'amount')::numeric <= 0 OR (entry->>'amount')::numeric * 100 > 9223372036854775807
      OR to_char((entry->>'date')::date,'YYYY-MM-DD') <> entry->>'date' THEN
      RAISE EXCEPTION 'Invalid amount or date' USING ERRCODE='22023';
    END IF;
    tax := entry->'tax';
    IF tax IS NULL THEN RAISE EXCEPTION 'Missing tax option' USING ERRCODE='22023'; END IF;
    IF tax <> 'null'::jsonb THEN
      category_kind := category_kinds->>(entry->>'category_id');
      IF jsonb_typeof(tax) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(tax)) <> 3
        OR category_kind <> 'income' OR left(entry->>'date',4) NOT IN ('2025','2026')
        OR tax->>'kind' IS NULL OR tax->>'kind' NOT IN ('salary','bonus','other')
        OR jsonb_typeof(tax->'source_label') IS DISTINCT FROM 'string'
        OR length(btrim(tax->>'source_label')) NOT BETWEEN 1 AND 100
        OR tax->'withholding' IS NULL THEN RAISE EXCEPTION 'Invalid tax option' USING ERRCODE='22023'; END IF;
      IF tax->'withholding' <> 'null'::jsonb THEN
        IF jsonb_typeof(tax->'withholding') IS DISTINCT FROM 'string' OR (tax->>'withholding') !~ '^[0-9]+([.][0-9]{1,2})?$'
          OR length(tax->>'withholding') > 20 THEN RAISE EXCEPTION 'Invalid withholding' USING ERRCODE='22023'; END IF;
        IF (tax->>'withholding')::numeric * 100 > 9223372036854775807 THEN RAISE EXCEPTION 'Withholding overflow' USING ERRCODE='22023'; END IF;
      END IF;
    END IF;
  END LOOP;
  FOR tax_year IN SELECT value FROM jsonb_array_elements(next_snapshot->'tax'->'years') LOOP
    IF jsonb_typeof(tax_year) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(tax_year)) <> 4
      OR jsonb_typeof(tax_year->'year') IS DISTINCT FROM 'number'
      OR tax_year->>'year' NOT IN ('2025','2026') OR tax_year->>'id' IS DISTINCT FROM tax_year->>'year'
      OR jsonb_typeof(tax_year->'income_complete') IS DISTINCT FROM 'boolean'
      OR jsonb_typeof(tax_year->'facts') IS DISTINCT FROM 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(tax_year->'facts')) <> 6
      OR jsonb_typeof(tax_year->'facts'->'social_security_confirmed') IS DISTINCT FROM 'boolean'
      OR EXISTS (SELECT 1 FROM unnest(ARRAY['single','under_65','domestic_salary_only','no_special_cases','no_other_deductions']) f
        WHERE coalesce(jsonb_typeof(tax_year->'facts'->f),'missing') NOT IN ('boolean','null'))
      OR (tax_year->>'year')::int = ANY(years) THEN
      RAISE EXCEPTION 'Invalid tax year' USING ERRCODE='22023';
    END IF;
    years := array_append(years,(tax_year->>'year')::int);
  END LOOP;
  FOR income IN SELECT value FROM jsonb_array_elements(next_snapshot->'tax'->'incomes') LOOP
    IF jsonb_typeof(income) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(income)) <> 9
      OR jsonb_typeof(income->'id') IS DISTINCT FROM 'string'
      OR length(btrim(income->>'id')) NOT BETWEEN 1 AND 128 OR (income->>'id') ~ '[[:cntrl:]]'
      OR income->>'id' = ANY(tax_ids)
      OR jsonb_typeof(income->'year') IS DISTINCT FROM 'number' OR NOT ((income->>'year')::numeric = ANY(years))
      OR jsonb_typeof(income->'source_label') IS DISTINCT FROM 'string'
      OR length(btrim(income->>'source_label')) NOT BETWEEN 1 AND 100
      OR jsonb_typeof(income->'month') IS DISTINCT FROM 'number' OR (income->>'month') !~ '^([1-9]|1[0-2])$'
      OR income->>'kind' IS NULL OR income->>'kind' NOT IN ('salary','bonus','other')
      OR income->>'basis' IS NULL OR income->>'basis' NOT IN ('actual','forecast')
      OR jsonb_typeof(income->'gross') IS DISTINCT FROM 'string'
      OR (income->>'gross') !~ '^[0-9]+([.][0-9]{1,2})?$' OR length(income->>'gross') > 20
      OR income->'withholding' IS NULL
      OR (income->'withholding' <> 'null'::jsonb AND (jsonb_typeof(income->'withholding') <> 'string'
        OR (income->>'withholding') !~ '^[0-9]+([.][0-9]{1,2})?$' OR length(income->>'withholding') > 20))
      OR jsonb_typeof(income->'note') IS DISTINCT FROM 'string' OR length(income->>'note') > 500 THEN
      RAISE EXCEPTION 'Invalid tax income' USING ERRCODE='22023';
    END IF;
    IF (income->>'gross')::numeric * 100 > 9223372036854775807
      OR coalesce((income->>'withholding')::numeric,0) * 100 > 9223372036854775807 THEN
      RAISE EXCEPTION 'Tax income overflow' USING ERRCODE='22023';
    END IF;
    IF income->>'kind' = 'salary' THEN
      key := (income->>'year') || ':' || btrim(income->>'source_label') || ':' || (income->>'month');
      IF key = ANY(salary_keys) THEN RAISE EXCEPTION 'Duplicate salary month' USING ERRCODE='22023'; END IF;
      salary_keys := array_append(salary_keys,key);
    END IF;
    tax_ids := array_append(tax_ids,income->>'id');
  END LOOP;
  tax_ids := '{}';
  FOR deduction IN SELECT value FROM jsonb_array_elements(next_snapshot->'tax'->'deductions') LOOP
    IF jsonb_typeof(deduction) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(deduction)) <> 5
      OR jsonb_typeof(deduction->'id') IS DISTINCT FROM 'string'
      OR length(btrim(deduction->>'id')) NOT BETWEEN 1 AND 128 OR (deduction->>'id') ~ '[[:cntrl:]]'
      OR deduction->>'id' = ANY(tax_ids)
      OR jsonb_typeof(deduction->'year') IS DISTINCT FROM 'number' OR NOT ((deduction->>'year')::numeric = ANY(years))
      OR jsonb_typeof(deduction->'month') IS DISTINCT FROM 'number' OR (deduction->>'month') !~ '^([1-9]|1[0-2])$'
      OR deduction->>'basis' IS NULL OR deduction->>'basis' NOT IN ('actual','forecast')
      OR jsonb_typeof(deduction->'amount') IS DISTINCT FROM 'string'
      OR (deduction->>'amount') !~ '^[0-9]+([.][0-9]{1,2})?$' OR length(deduction->>'amount') > 20
      OR ((deduction->>'year') || ':' || (deduction->>'month')) = ANY(deduction_months) THEN
      RAISE EXCEPTION 'Invalid tax deduction' USING ERRCODE='22023';
    END IF;
    IF (deduction->>'amount')::numeric * 100 > 9223372036854775807 THEN
      RAISE EXCEPTION 'Tax deduction overflow' USING ERRCODE='22023';
    END IF;
    deduction_months := array_append(deduction_months,(deduction->>'year') || ':' || (deduction->>'month'));
    tax_ids := array_append(tax_ids,deduction->>'id');
  END LOOP;
  INSERT INTO public.taxly_sync_heads(owner_id) VALUES(owner) ON CONFLICT DO NOTHING;
  SELECT revision INTO current_revision FROM public.taxly_sync_heads WHERE owner_id=owner FOR UPDATE;
  SELECT r.revision,r.expected_revision,r.request_hash INTO receipt_revision,receipt_expected,receipt_hash FROM public.taxly_sync_receipts r
    WHERE r.owner_id=owner AND r.operation_id=taxly_put_ledger.operation_id;
  IF receipt_revision IS NOT NULL THEN
    IF receipt_expected <> expected_revision OR receipt_hash <> request_hash THEN
      RAISE EXCEPTION 'Operation ID reused with a different request' USING ERRCODE='22023';
    END IF;
    RETURN receipt_revision;
  END IF;
  IF current_revision <> expected_revision THEN RAISE EXCEPTION 'SyncConflict' USING ERRCODE='40001'; END IF;
  -- A category's kind is immutable while its identity exists.
  IF EXISTS (SELECT 1 FROM public.taxly_sync_snapshots s,
      jsonb_array_elements(s.snapshot->'categories') old,
      jsonb_array_elements(next_snapshot->'categories') fresh
      WHERE s.owner_id=owner AND old->>'id'=fresh->>'id' AND old->>'kind'<>fresh->>'kind') THEN
    RAISE EXCEPTION 'Category kind cannot change' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.taxly_sync_snapshots(owner_id,snapshot) VALUES(owner,next_snapshot)
    ON CONFLICT(owner_id) DO UPDATE SET snapshot=excluded.snapshot,updated_at=now();
  UPDATE public.taxly_sync_heads SET revision=current_revision+1 WHERE owner_id=owner;
  INSERT INTO public.taxly_sync_receipts(owner_id,operation_id,revision,expected_revision,request_hash)
    VALUES(owner,operation_id,current_revision+1,expected_revision,request_hash);
  RETURN current_revision+1;
END;
$$;
