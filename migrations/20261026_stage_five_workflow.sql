BEGIN;
CREATE OR REPLACE FUNCTION public.journal_bulk_tag(p_trades jsonb,p_tag bigint DEFAULT NULL,p_remove boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE tag_key bigint; item jsonb; current_trade public.trades; result jsonb:='[]';
BEGIN
 IF jsonb_typeof(p_trades)<>'array' OR jsonb_array_length(p_trades)<1 OR jsonb_array_length(p_trades)>200 THEN RAISE EXCEPTION 'Select between 1 and 200 trades' USING ERRCODE='22023'; END IF;
 IF (SELECT count(distinct value->>'id') FROM jsonb_array_elements(p_trades))<>jsonb_array_length(p_trades) THEN RAISE EXCEPTION 'Duplicate trade selection' USING ERRCODE='22023'; END IF;
 tag_key:=p_tag;
 IF tag_key IS NULL THEN
  INSERT INTO public.trade_tags(name,category,color,description) VALUES('Reviewed','Journal','#059669','Reviewed in the journal inbox') ON CONFLICT(name) DO NOTHING;
  SELECT id INTO tag_key FROM public.trade_tags WHERE name='Reviewed';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.trade_tags WHERE id=tag_key) THEN RAISE EXCEPTION 'Tag not found' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_trades) ORDER BY (value->>'id')::bigint LOOP
  SELECT * INTO current_trade FROM public.trades WHERE id=(item->>'id')::bigint FOR UPDATE;
  IF NOT FOUND OR current_trade.journal_revision IS DISTINCT FROM (item->>'revision')::bigint THEN RAISE EXCEPTION 'A selected trade changed. Reload and select again.' USING ERRCODE='40001'; END IF;
  IF p_remove THEN DELETE FROM public.trade_tag_mappings WHERE trade_id=current_trade.id AND tag_id=tag_key;
  ELSE INSERT INTO public.trade_tag_mappings(trade_id,tag_id) VALUES(current_trade.id,tag_key) ON CONFLICT DO NOTHING; END IF;
  UPDATE public.trades SET journal_revision=journal_revision+1 WHERE id=current_trade.id RETURNING * INTO current_trade;
  result:=result||jsonb_build_array(to_jsonb(current_trade)||jsonb_build_object('tag_ids',COALESCE((SELECT jsonb_agg(tag_id ORDER BY tag_id) FROM public.trade_tag_mappings WHERE trade_id=current_trade.id),'[]')));
 END LOOP;
 INSERT INTO public.journal_events(action,details) VALUES('bulk_tag',jsonb_build_object('trades',p_trades,'tag_id',tag_key,'removed',p_remove));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.journal_bulk_tag(jsonb,bigint,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.journal_bulk_tag(jsonb,bigint,boolean) TO service_role;
COMMIT;
