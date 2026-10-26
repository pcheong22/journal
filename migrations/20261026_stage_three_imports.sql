BEGIN;
CREATE TABLE public.journal_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(),
 filename text NOT NULL, file_sha text NOT NULL CHECK(file_sha ~ '^[a-f0-9]{64}$'), source_path text NOT NULL,
 source_size bigint NOT NULL, source_verified boolean NOT NULL DEFAULT false,
 parser_version text NOT NULL, broker text, account_id text, timezone text,
 status text NOT NULL DEFAULT 'uploaded' CHECK(status IN ('uploaded','preview','committed','rolled_back')),
 plan jsonb, counts jsonb, result jsonb, changes jsonb NOT NULL DEFAULT '[]',
 account_before jsonb, account_after jsonb, safety_backup uuid,
 previewed_at timestamptz, committed_at timestamptz, rolled_back_at timestamptz,
 details_status text NOT NULL DEFAULT 'none', details_error text
);
CREATE INDEX journal_imports_sha_idx ON public.journal_imports(file_sha) WHERE source_verified;
ALTER TABLE public.journal_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.journal_imports FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.journal_imports TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_wallet_identity ON public.accounts(broker,lower(id)) WHERE id ~* '^0x[0-9a-f]{40}$';
DROP POLICY IF EXISTS journal_private_storage ON storage.objects;
CREATE POLICY journal_private_storage ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
 USING(bucket_id NOT IN ('trade-images','trade-executions','journal-backups','journal-imports'))
 WITH CHECK(bucket_id NOT IN ('trade-images','trade-executions','journal-backups','journal-imports'));
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('journal-imports','journal-imports',false,20971520,ARRAY['application/octet-stream','application/gzip'])
 ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=20971520,allowed_mime_types=ARRAY['application/octet-stream','application/gzip'];

CREATE FUNCTION public.journal_import_snapshot(p_account text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE document jsonb;
BEGIN
 document:=jsonb_build_object(
 'account',(SELECT to_jsonb(a) FROM public.accounts a WHERE id=p_account),
 'trades',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.trades t WHERE account_id=p_account),'[]'),
 'tags',COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY trade_id,tag_id) FROM public.trade_tag_mappings m JOIN public.trades t ON t.id=m.trade_id WHERE t.account_id=p_account),'[]'),
 'images',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.trade_images i WHERE i.entity_type='trade' AND EXISTS(SELECT 1 FROM public.trades t WHERE t.account_id=p_account AND t.id::text=i.entity_id)),'[]'));
 RETURN document || jsonb_build_object('digest',md5(document::text));
END $$;

CREATE FUNCTION public.journal_apply_import(p_id uuid,p_safety uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE job public.journal_imports; plan jsonb; operation jsonb; row_before public.trades; row_after public.trades;
 v_changes jsonb:='[]'; coverage jsonb:='[]'; v_counts jsonb; v_account_before jsonb;
BEGIN
 SELECT * INTO job FROM public.journal_imports WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Import not found' USING ERRCODE='P0002'; END IF;
 IF job.status='committed' THEN RETURN job.result; END IF;
 IF job.status<>'preview' OR job.previewed_at<now()-interval '30 minutes' OR job.plan IS NULL THEN RAISE EXCEPTION 'Refresh this import preview before continuing' USING ERRCODE='40001'; END IF;
 plan:=job.plan;
 IF (plan->'counts'->>'blocked')::integer>0 THEN RAISE EXCEPTION 'Resolve ambiguous source records before importing' USING ERRCODE='22023'; END IF;
 LOCK TABLE public.accounts,public.trades,public.trade_tag_mappings,public.trade_images IN SHARE ROW EXCLUSIVE MODE;
 IF (public.journal_import_snapshot(job.account_id)->>'digest') IS DISTINCT FROM plan->>'accountDigest' THEN RAISE EXCEPTION 'Account changed after preview. Review a fresh preview.' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(plan->'operations') op WHERE op->>'kind'<>'coverage') OR (plan->>'accountChanged')::boolean THEN
  IF NOT EXISTS(SELECT 1 FROM public.journal_backups WHERE id=p_safety AND kind='export' AND checksum IS NOT NULL) THEN RAISE EXCEPTION 'A complete safety backup is required' USING ERRCODE='22023'; END IF;
 END IF;
 SELECT to_jsonb(a) INTO v_account_before FROM public.accounts a WHERE id=job.account_id;
 IF v_account_before IS NULL THEN
  INSERT INTO public.accounts(id,broker,label,currency,color) SELECT x.id,x.broker,x.label,x.currency,x.color FROM jsonb_populate_record(NULL::public.accounts,plan->'account') x;
 ELSIF (plan->>'accountCurrencyCorrection')::boolean THEN
  UPDATE public.accounts SET currency=plan->'account'->>'currency' WHERE id=job.account_id;
 END IF;
 IF (SELECT broker FROM public.accounts WHERE id=job.account_id)<>job.broker THEN RAISE EXCEPTION 'Account belongs to another broker'; END IF;
 v_counts:=jsonb_build_object('inserted',0,'updated',0,'removed',0,'skipped',plan->'counts'->'skipped');
 -- Free duplicate keys before any identity-preserving update.
 FOR operation IN SELECT value FROM jsonb_array_elements(plan->'operations') WHERE value->>'kind'='delete' LOOP
  SELECT * INTO row_before FROM public.trades WHERE id=(operation->'before'->>'id')::bigint AND account_id=job.account_id;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.trade_tag_mappings WHERE trade_id=row_before.id) OR EXISTS(SELECT 1 FROM public.trade_images WHERE entity_type='trade' AND entity_id=row_before.id::text) OR row_before.strategy_id IS NOT NULL OR row_before.stop_loss IS NOT NULL OR concat_ws('',row_before.notes,row_before.note_entry_reason,row_before.note_management,row_before.note_lessons,row_before.note_emotional_state)<>'' THEN RAISE EXCEPTION 'Duplicate has journal data; nothing changed'; END IF;
  DELETE FROM public.trades WHERE id=row_before.id;
  v_changes:=v_changes||jsonb_build_array(jsonb_build_object('kind','delete','before',to_jsonb(row_before)));
  v_counts:=jsonb_set(v_counts,'{removed}',to_jsonb((v_counts->>'removed')::integer+1));
 END LOOP;
 FOR operation IN SELECT value FROM jsonb_array_elements(plan->'operations') WHERE value->>'kind'<>'delete' LOOP
  IF operation->>'kind'='coverage' THEN
   coverage:=coverage||jsonb_build_array(jsonb_build_object('trade_id',operation->'before'->'id','source_ids',operation->'sourceIds','incoming_position',operation->'incomingPosition','position_id',operation->'before'->'position_id'));
   CONTINUE;
  END IF;
  row_after:=jsonb_populate_record(NULL::public.trades,operation->'after');
  IF row_after.account_id<>job.account_id OR row_after.broker<>job.broker THEN RAISE EXCEPTION 'Import account mismatch'; END IF;
  IF operation->>'kind'='insert' THEN
   INSERT INTO public.trades(position_id,account_id,broker,entry_time,exit_time,symbol,direction,size,entry_price,exit_price,notional_usd,notional_method,pnl,pct_gain,fee,duration_mins,currency,session,day_of_week,tv_symbol,raw_direction,order_type)
    VALUES(row_after.position_id,row_after.account_id,row_after.broker,row_after.entry_time,row_after.exit_time,row_after.symbol,row_after.direction,row_after.size,row_after.entry_price,row_after.exit_price,row_after.notional_usd,row_after.notional_method,row_after.pnl,row_after.pct_gain,row_after.fee,row_after.duration_mins,row_after.currency,row_after.session,row_after.day_of_week,row_after.tv_symbol,row_after.raw_direction,row_after.order_type) RETURNING * INTO row_after;
   v_changes:=v_changes||jsonb_build_array(jsonb_build_object('kind','insert','after',to_jsonb(row_after)));
   v_counts:=jsonb_set(v_counts,'{inserted}',to_jsonb((v_counts->>'inserted')::integer+1));
  ELSIF operation->>'kind'='update' THEN
   SELECT * INTO row_before FROM public.trades WHERE id=(operation->'before'->>'id')::bigint AND account_id=job.account_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Saved trade disappeared'; END IF;
   UPDATE public.trades SET position_id=row_after.position_id,entry_time=row_after.entry_time,exit_time=row_after.exit_time,symbol=row_after.symbol,direction=row_after.direction,size=row_after.size,entry_price=row_after.entry_price,exit_price=row_after.exit_price,notional_usd=row_after.notional_usd,notional_method=row_after.notional_method,pnl=row_after.pnl,pct_gain=row_after.pct_gain,fee=row_after.fee,duration_mins=row_after.duration_mins,currency=row_after.currency,session=row_after.session,day_of_week=row_after.day_of_week,tv_symbol=row_after.tv_symbol,raw_direction=row_after.raw_direction,order_type=row_after.order_type WHERE id=row_before.id RETURNING * INTO row_after;
   v_changes:=v_changes||jsonb_build_array(jsonb_build_object('kind','update','before',to_jsonb(row_before),'after',to_jsonb(row_after)));
   v_counts:=jsonb_set(v_counts,'{updated}',to_jsonb((v_counts->>'updated')::integer+1));
  ELSE RAISE EXCEPTION 'Unsupported import operation'; END IF;
  coverage:=coverage||jsonb_build_array(jsonb_build_object('trade_id',row_after.id,'source_ids',operation->'sourceIds','incoming_position',operation->'incomingPosition','position_id',row_after.position_id));
 END LOOP;
 UPDATE public.journal_imports SET status='committed',committed_at=now(),counts=v_counts,changes=v_changes,safety_backup=p_safety,account_before=v_account_before,account_after=(SELECT to_jsonb(a) FROM public.accounts a WHERE id=job.account_id),result=v_counts||jsonb_build_object('id',p_id,'coverage',coverage,'accountId',job.account_id,'broker',job.broker) WHERE id=p_id RETURNING result INTO v_counts;
 INSERT INTO public.journal_events(action,details) VALUES('import',jsonb_build_object('id',p_id,'counts',v_counts-'coverage','safety_backup',p_safety));
 RETURN v_counts;
END $$;
REVOKE ALL ON FUNCTION public.journal_import_snapshot(text),public.journal_apply_import(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.journal_import_snapshot(text),public.journal_apply_import(uuid,uuid) TO service_role;
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
  SELECT COALESCE(jsonb_agg(to_jsonb(j) ORDER BY id),'[]'::jsonb) INTO rows FROM public.journal_imports j WHERE source_verified;
  tables:=tables || jsonb_build_object('journal_imports',rows);
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
  LOCK TABLE public.journal_imports IN SHARE ROW EXCLUSIVE MODE;
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
  DELETE FROM public.journal_imports;
  INSERT INTO public.journal_imports SELECT * FROM jsonb_populate_recordset(NULL::public.journal_imports,COALESCE(p_snapshot->'tables'->'journal_imports','[]'::jsonb));
  UPDATE public.trades SET journal_revision=GREATEST(journal_revision+1,revision_floor);
  INSERT INTO public.journal_events(action,details) VALUES ('restore',jsonb_build_object('safety_backup',p_safety_id,'source_digest',p_snapshot->>'digest'));
  RETURN jsonb_build_object('restored',true,'safety_backup',p_safety_id);
END $$;

COMMIT;
