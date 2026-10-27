BEGIN;

CREATE TABLE public.pretrade_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id text,
  linked_trade_id bigint REFERENCES public.trades(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','taken','passed','cancelled')),
  symbol text NOT NULL CHECK (char_length(symbol) BETWEEN 1 AND 40),
  direction text NOT NULL CHECK (direction IN ('Long','Short')),
  setup_type text NOT NULL DEFAULT '',
  planned_at timestamptz NOT NULL DEFAULT now(),
  entry_price numeric,
  stop_price numeric,
  target_price numeric,
  pivot_timeframe text NOT NULL DEFAULT '',
  pivot_name text NOT NULL DEFAULT '',
  pivot_price numeric,
  thesis text NOT NULL DEFAULT '',
  invalidation text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(checklist)='object'),
  score integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  grade text NOT NULL DEFAULT 'Incomplete' CHECK (grade IN ('Incomplete','C','B','A','A+')),
  gate_results jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(gate_results)='object'),
  reward_risk numeric,
  original_snapshot jsonb NOT NULL CHECK (jsonb_typeof(original_snapshot)='object'),
  revisions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(revisions)='array' AND jsonb_array_length(revisions)<=100),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pretrade_plans_owner_updated_idx ON public.pretrade_plans(user_id,updated_at DESC);
CREATE INDEX pretrade_plans_linked_trade_idx ON public.pretrade_plans(linked_trade_id) WHERE linked_trade_id IS NOT NULL;
ALTER TABLE public.pretrade_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY pretrade_plans_owner ON public.pretrade_plans FOR ALL TO authenticated
  USING ((SELECT auth.uid())=user_id)
  WITH CHECK ((SELECT auth.uid())=user_id);
REVOKE ALL ON public.pretrade_plans FROM PUBLIC,anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.pretrade_plans TO authenticated;
GRANT ALL ON public.pretrade_plans TO service_role;

CREATE OR REPLACE FUNCTION public.journal_export_data() RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE names text[] := ARRAY['accounts','trade_tags','strategies','trades','trade_tag_mappings','missed_trades','trade_images','coach_reports','user_preferences','journal_events','pretrade_plans'];
  name text; rows jsonb; tables jsonb := '{}'; schema_hash text; document jsonb;
BEGIN
  FOREACH name IN ARRAY names LOOP
    EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),''[]''::jsonb) FROM public.%I t',name) INTO rows;
    tables := tables || jsonb_build_object(name,rows);
  END LOOP;
  SELECT md5(string_agg(c.relname||':'||a.attname||':'||format_type(a.atttypid,a.atttypmod),'|' ORDER BY c.relname,a.attnum)) INTO schema_hash
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE n.nspname='public' AND c.relname=ANY(names);
  SELECT COALESCE(jsonb_agg(to_jsonb(j) ORDER BY id),'[]'::jsonb) INTO rows FROM public.journal_imports j WHERE source_verified;
  tables:=tables || jsonb_build_object('journal_imports',rows);
  document := jsonb_build_object('schema',schema_hash,'tables',tables);
  IF pg_column_size(document)>20971520 THEN RAISE EXCEPTION 'Journal data exceeds the 20 MB backup limit'; END IF;
  RETURN document || jsonb_build_object('digest',md5(document::text));
END $$;

CREATE OR REPLACE FUNCTION public.journal_restore_data(p_snapshot jsonb,p_expected_digest text,p_safety_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE names text[] := ARRAY['accounts','trade_tags','strategies','trades','trade_tag_mappings','missed_trades','trade_images','coach_reports','user_preferences','journal_events','pretrade_plans'];
  name text; current_snapshot jsonb; i integer; sequence_name text; next_id bigint; revision_floor bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.journal_backups WHERE id=p_safety_id AND kind='export' AND checksum IS NOT NULL) THEN
    RAISE EXCEPTION 'A complete safety backup is required' USING ERRCODE='22023';
  END IF;
  FOREACH name IN ARRAY names LOOP EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',name); END LOOP;
  current_snapshot := public.journal_export_data();
  IF current_snapshot->>'digest' IS DISTINCT FROM p_expected_digest THEN RAISE EXCEPTION 'Journal changed after the preview. Review a fresh preview.' USING ERRCODE='40001'; END IF;
  IF p_snapshot->>'schema' IS DISTINCT FROM current_snapshot->>'schema' THEN RAISE EXCEPTION 'Backup schema is incompatible with this journal version' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_snapshot->'tables') <> 'object' THEN RAISE EXCEPTION 'Invalid backup tables' USING ERRCODE='22023'; END IF;
  FOREACH name IN ARRAY names LOOP
    IF jsonb_typeof(p_snapshot->'tables'->name) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Backup table missing: %',name USING ERRCODE='22023'; END IF;
  END LOOP;
  LOCK TABLE public.journal_imports IN SHARE ROW EXCLUSIVE MODE;
  SELECT COALESCE(max(journal_revision),0)+1 INTO revision_floor FROM public.trades;
  FOR i IN REVERSE array_length(names,1)..1 LOOP EXECUTE format('DELETE FROM public.%I',names[i]); END LOOP;
  FOREACH name IN ARRAY names LOOP
    EXECUTE format('INSERT INTO public.%I OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_recordset(NULL::public.%I,$1)',name,name) USING p_snapshot->'tables'->name;
    sequence_name := NULL;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=name AND column_name='id') THEN
      SELECT pg_get_serial_sequence('public.'||quote_ident(name),'id') INTO sequence_name;
    END IF;
    IF sequence_name IS NOT NULL THEN
      EXECUTE format('SELECT max(id) FROM public.%I',name) INTO next_id;
      PERFORM setval(sequence_name::regclass,GREATEST(COALESCE(next_id,1),COALESCE(pg_sequence_last_value(sequence_name::regclass),1)),true);
    END IF;
  END LOOP;
  DELETE FROM public.journal_imports;
  INSERT INTO public.journal_imports SELECT * FROM jsonb_populate_recordset(NULL::public.journal_imports,COALESCE(p_snapshot->'tables'->'journal_imports','[]'::jsonb));
  UPDATE public.trades SET journal_revision=GREATEST(journal_revision+1,revision_floor);
  INSERT INTO public.journal_events(action,details) VALUES ('restore',jsonb_build_object('safety_backup',p_safety_id,'source_digest',p_snapshot->>'digest'));
  RETURN jsonb_build_object('restored',true,'safety_backup',p_safety_id);
END $$;
REVOKE ALL ON FUNCTION public.journal_export_data(), public.journal_restore_data(jsonb,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.journal_export_data(), public.journal_restore_data(jsonb,text,uuid) TO service_role;

COMMIT;
