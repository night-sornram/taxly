-- Private per-account snapshots. Only the small revision row is broadcast.
CREATE TABLE public.taxly_sync_heads (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0 AND revision <= 9007199254740991)
);
CREATE TABLE public.taxly_sync_snapshots (
  owner_id uuid PRIMARY KEY REFERENCES public.taxly_sync_heads(owner_id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.taxly_sync_receipts (
  owner_id uuid NOT NULL REFERENCES public.taxly_sync_heads(owner_id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  revision bigint NOT NULL,
  expected_revision bigint NOT NULL,
  request_hash bytea NOT NULL,
  PRIMARY KEY(owner_id,operation_id)
);
ALTER TABLE public.taxly_sync_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxly_sync_receipts FROM anon, authenticated;
ALTER TABLE public.taxly_sync_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxly_sync_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxly_sync_heads, public.taxly_sync_snapshots FROM anon, authenticated;
GRANT SELECT ON public.taxly_sync_heads, public.taxly_sync_snapshots TO authenticated;
CREATE POLICY own_head ON public.taxly_sync_heads FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE POLICY own_snapshot ON public.taxly_sync_snapshots FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));

CREATE FUNCTION public.taxly_get_ledger() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT coalesce((SELECT jsonb_build_object('revision',h.revision,'snapshot',s.snapshot)
    FROM public.taxly_sync_heads h JOIN public.taxly_sync_snapshots s ON s.owner_id=h.owner_id
    WHERE h.owner_id=(SELECT auth.uid())), '{"revision":0,"snapshot":{"categories":[],"entries":[]}}'::jsonb);
$$;
REVOKE ALL ON FUNCTION public.taxly_get_ledger() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.taxly_get_ledger() TO authenticated;

-- Definer is necessary: clients may read their own snapshot but cannot bypass
-- validation/revision checks with direct INSERT/UPDATE/DELETE.
CREATE FUNCTION public.taxly_put_ledger(expected_revision bigint, next_snapshot jsonb, operation_id uuid)
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
BEGIN
  IF owner IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF operation_id IS NULL OR expected_revision IS NULL OR expected_revision < 0 OR expected_revision >= 9007199254740991
    OR next_snapshot IS NULL OR jsonb_typeof(next_snapshot) <> 'object'
    OR jsonb_typeof(next_snapshot->'categories') IS DISTINCT FROM 'array'
    OR jsonb_typeof(next_snapshot->'entries') IS DISTINCT FROM 'array'
    OR (SELECT count(*) FROM jsonb_object_keys(next_snapshot)) <> 2
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
REVOKE ALL ON FUNCTION public.taxly_put_ledger(bigint,jsonb,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.taxly_put_ledger(bigint,jsonb,uuid) TO authenticated;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.taxly_sync_heads;
  END IF;
END $$;
