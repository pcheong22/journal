BEGIN;
-- Some development projects predate these optional journal features.
CREATE TABLE IF NOT EXISTS public.coach_reports (
  id bigserial PRIMARY KEY, period text NOT NULL, date_from text, date_to text,
  trade_count integer, score integer, archetype text, core_edge text, core_weakness text,
  coaching_tip text, insights text, provider text, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  hide_pnl_default boolean DEFAULT true, default_account_ids text[] DEFAULT '{}',
  default_timeframe text DEFAULT 'MTD', updated_at timestamptz DEFAULT now()
);
ALTER VIEW public.strategy_summary SET (security_invoker = true);
ALTER TABLE public.coach_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coach_reports,public.user_preferences FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.coach_reports,public.user_preferences TO service_role;
GRANT ALL ON SEQUENCE public.coach_reports_id_seq TO service_role;
CREATE TABLE IF NOT EXISTS public.journal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS public.journal_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('export','restore_upload')),
  path text NOT NULL UNIQUE,
  checksum text,
  bytes bigint,
  counts jsonb,
  reason text
);
ALTER TABLE public.journal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_backups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.journal_events, public.journal_backups FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.journal_events, public.journal_backups TO service_role;
DROP POLICY IF EXISTS journal_private_storage ON storage.objects;
CREATE POLICY journal_private_storage ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (bucket_id NOT IN ('trade-images','trade-executions','journal-backups'))
WITH CHECK (bucket_id NOT IN ('trade-images','trade-executions','journal-backups'));
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('journal-backups','journal-backups',false,52428800,ARRAY['application/json'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=52428800,allowed_mime_types=ARRAY['application/json'];

CREATE OR REPLACE FUNCTION public.journal_export_data() RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE names text[] := ARRAY['accounts','trade_tags','strategies','trades','trade_tag_mappings','missed_trades','trade_images','coach_reports','user_preferences','journal_events'];
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
  document := jsonb_build_object('schema',schema_hash,'tables',tables);
  IF pg_column_size(document)>20971520 THEN RAISE EXCEPTION 'Journal data exceeds the 20 MB backup limit'; END IF;
  RETURN document || jsonb_build_object('digest',md5(document::text));
END $$;

CREATE OR REPLACE FUNCTION public.journal_restore_data(p_snapshot jsonb,p_expected_digest text,p_safety_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE names text[] := ARRAY['accounts','trade_tags','strategies','trades','trade_tag_mappings','missed_trades','trade_images','coach_reports','user_preferences','journal_events'];
  name text; current_snapshot jsonb; i integer; sequence_name text; next_id bigint; revision_floor bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.journal_backups WHERE id=p_safety_id AND kind='export' AND checksum IS NOT NULL) THEN
    RAISE EXCEPTION 'A complete safety backup is required' USING ERRCODE='22023';
  END IF;
  -- Block writers across all restored tables until the transaction completes.
  FOREACH name IN ARRAY names LOOP EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',name); END LOOP;
  current_snapshot := public.journal_export_data();
  IF current_snapshot->>'digest' IS DISTINCT FROM p_expected_digest THEN RAISE EXCEPTION 'Journal changed after the preview. Review a fresh preview.' USING ERRCODE='40001'; END IF;
  IF p_snapshot->>'schema' IS DISTINCT FROM current_snapshot->>'schema' THEN RAISE EXCEPTION 'Backup schema is incompatible with this journal version' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_snapshot->'tables') <> 'object' THEN RAISE EXCEPTION 'Invalid backup tables' USING ERRCODE='22023'; END IF;
  FOREACH name IN ARRAY names LOOP
    IF jsonb_typeof(p_snapshot->'tables'->name) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Backup table missing: %',name USING ERRCODE='22023'; END IF;
  END LOOP;
  SELECT COALESCE(max(journal_revision),0)+1 INTO revision_floor FROM public.trades;
  FOR i IN REVERSE array_length(names,1)..1 LOOP EXECUTE format('DELETE FROM public.%I',names[i]); END LOOP;
  FOREACH name IN ARRAY names LOOP
    EXECUTE format('INSERT INTO public.%I OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_recordset(NULL::public.%I,$1)',name,name) USING p_snapshot->'tables'->name;
    -- Never move sequences backwards: retained immutable files can reference old IDs.
    sequence_name := NULL;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=name AND column_name='id') THEN
      SELECT pg_get_serial_sequence('public.'||quote_ident(name),'id') INTO sequence_name;
    END IF;
    IF sequence_name IS NOT NULL THEN
      EXECUTE format('SELECT max(id) FROM public.%I',name) INTO next_id;
      PERFORM setval(sequence_name::regclass,GREATEST(COALESCE(next_id,1),COALESCE(pg_sequence_last_value(sequence_name::regclass),1)),true);
    END IF;
  END LOOP;
  UPDATE public.trades SET journal_revision=GREATEST(journal_revision+1,revision_floor);
  INSERT INTO public.journal_events(action,details) VALUES ('restore',jsonb_build_object('safety_backup',p_safety_id,'source_digest',p_snapshot->>'digest'));
  RETURN jsonb_build_object('restored',true,'safety_backup',p_safety_id);
END $$;
REVOKE ALL ON FUNCTION public.journal_export_data(), public.journal_restore_data(jsonb,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.journal_export_data(), public.journal_restore_data(jsonb,text,uuid) TO service_role;
COMMIT;
