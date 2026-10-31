-- Only run against the disposable fixture database created by the test script.
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.taxly_get_ledger(); RAISE EXCEPTION 'Anonymous read allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
DO $$ DECLARE
  r bigint;
  p jsonb := '{"categories":[{"id":"c1","kind":"income","name":"Salary"}],"entries":[{"id":"e1","date":"2026-10-31","category_id":"c1","amount":"100.00","note":"x","tax":null}],"tax":{"years":[{"id":"2026","year":2026,"facts":{"single":true,"under_65":true,"domestic_salary_only":true,"no_special_cases":true,"no_other_deductions":null,"social_security_confirmed":false},"income_complete":false}],"incomes":[{"id":"i1","year":2026,"source_label":"Work","month":1,"kind":"salary","basis":"actual","gross":"30000.00","withholding":null,"note":""}],"deductions":[{"id":"d1","year":2026,"month":1,"basis":"actual","amount":"750.00"}]}}'::jsonb;
BEGIN
  r:=public.taxly_put_ledger(0,p,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  IF r<>1 THEN RAISE EXCEPTION 'First write'; END IF;
  r:=public.taxly_put_ledger(0,p,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  IF r<>1 THEN RAISE EXCEPTION 'Replay'; END IF;
  BEGIN
    PERFORM public.taxly_put_ledger(0,jsonb_set(p,'{entries,0,amount}','"200.00"'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    RAISE EXCEPTION 'Mismatched replay accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.taxly_put_ledger(0,p,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'); RAISE EXCEPTION 'Stale accepted';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
  IF (public.taxly_get_ledger()->>'revision')::bigint<>1 THEN RAISE EXCEPTION 'Own read'; END IF;
  BEGIN PERFORM count(*) FROM public.taxly_sync_receipts; RAISE EXCEPTION 'Receipt read allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.taxly_sync_heads VALUES ('33333333-3333-4333-8333-333333333333',0); RAISE EXCEPTION 'Direct write allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.taxly_put_ledger(1,jsonb_set(p,'{entries,0,date}','"2026-13-01"'),'cccccccc-cccc-4ccc-8ccc-cccccccccccc'); RAISE EXCEPTION 'Date accepted';
  EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '22008' THEN NULL; END;
  BEGIN PERFORM public.taxly_put_ledger(1,jsonb_set(p,'{entries,0,category_id}','"missing"'),'dddddddd-dddd-4ddd-8ddd-dddddddddddd'); RAISE EXCEPTION 'Category accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.taxly_put_ledger(1,jsonb_set(p,'{entries}',(p->'entries')||(p->'entries')),'cccccccc-cccc-4ccc-8ccc-cccccccccccc'); RAISE EXCEPTION 'Duplicate ID accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.taxly_put_ledger(1,jsonb_set(p,'{entries,0,amount}','"92233720368547758.08"'),'cccccccc-cccc-4ccc-8ccc-cccccccccccc'); RAISE EXCEPTION 'Overflow accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.taxly_put_ledger(1,jsonb_set(p,'{categories,0,kind}','"expense"'),'cccccccc-cccc-4ccc-8ccc-cccccccccccc'); RAISE EXCEPTION 'Category kind change accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  -- Tax rows: an outdated client without the tax key, bad rows and duplicates are rejected.
  BEGIN PERFORM public.taxly_put_ledger(1,p-'tax','cccccccc-cccc-4ccc-8ccc-cccccccccccc'); RAISE EXCEPTION 'Missing tax accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.taxly_put_ledger(1,jsonb_set(p,'{tax,years,0,year}','2024'),'cccccccc-cccc-4ccc-8ccc-cccccccccccc'); RAISE EXCEPTION 'Tax year accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.taxly_put_ledger(1,jsonb_set(p,'{tax,incomes,0,year}','2025'),'cccccccc-cccc-4ccc-8ccc-cccccccccccc'); RAISE EXCEPTION 'Income without year accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.taxly_put_ledger(1,jsonb_set(p,'{tax,incomes,0,month}','13'),'cccccccc-cccc-4ccc-8ccc-cccccccccccc'); RAISE EXCEPTION 'Income month accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.taxly_put_ledger(1,jsonb_set(p,'{tax,incomes}',(p->'tax'->'incomes')||jsonb_set(p->'tax'->'incomes'->0,'{id}','"i2"')),'cccccccc-cccc-4ccc-8ccc-cccccccccccc'); RAISE EXCEPTION 'Duplicate salary accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.taxly_put_ledger(1,jsonb_set(p,'{tax,deductions}',(p->'tax'->'deductions')||jsonb_set(p->'tax'->'deductions'->0,'{id}','"d2"')),'cccccccc-cccc-4ccc-8ccc-cccccccccccc'); RAISE EXCEPTION 'Duplicate deduction month accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.taxly_put_ledger(1,jsonb_set(p,'{tax,years,0,facts,single}','"yes"'),'cccccccc-cccc-4ccc-8ccc-cccccccccccc'); RAISE EXCEPTION 'Facts accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  IF public.taxly_get_ledger()->'snapshot'->'tax'->'incomes'->0->>'gross'<>'30000.00' THEN RAISE EXCEPTION 'Tax round trip'; END IF;
END $$;
SET request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
DO $$ BEGIN
  IF (public.taxly_get_ledger()->>'revision')::bigint<>0 THEN RAISE EXCEPTION 'Cross-account RPC read'; END IF;
  IF (SELECT count(*) FROM public.taxly_sync_heads)<>0 OR (SELECT count(*) FROM public.taxly_sync_snapshots)<>0 THEN RAISE EXCEPTION 'Cross-account table read'; END IF;
  IF public.taxly_put_ledger(0,'{"categories":[],"entries":[],"tax":{"years":[],"incomes":[],"deductions":[]}}'::jsonb,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')<>1 THEN RAISE EXCEPTION 'B write'; END IF;
END $$;
SET request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
DO $$ BEGIN
  IF (public.taxly_get_ledger()->>'revision')::bigint<>1 OR jsonb_array_length(public.taxly_get_ledger()->'snapshot'->'entries')<>1 THEN RAISE EXCEPTION 'A changed with B'; END IF;
END $$;
