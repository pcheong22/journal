BEGIN;
DO $checkpoint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.journal_events WHERE action='migration_checkpoint' AND details ? 'before_notes_migration') THEN
    INSERT INTO public.journal_events(action,details) VALUES ('migration_checkpoint',jsonb_build_object('before_notes_migration',public.journal_export_data()));
  END IF;
END $checkpoint$;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS journal_revision bigint NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION public.journal_derive_r() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE risk numeric; reward numeric;
BEGIN
  NEW.r_multiple := NULL;
  IF NEW.entry_price > 0 AND NEW.exit_price > 0 AND NEW.stop_loss > 0 AND NEW.direction IN ('Long','Short') THEN
    risk := CASE WHEN NEW.direction = 'Long' THEN NEW.entry_price - NEW.stop_loss ELSE NEW.stop_loss - NEW.entry_price END;
    reward := CASE WHEN NEW.direction = 'Long' THEN NEW.exit_price - NEW.entry_price ELSE NEW.entry_price - NEW.exit_price END;
    IF risk > 0 THEN NEW.r_multiple := round(reward/risk, 2); END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN NEW.journal_revision := GREATEST(NEW.journal_revision,OLD.journal_revision + 1); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS journal_derive_r ON public.trades;
CREATE TRIGGER journal_derive_r BEFORE INSERT OR UPDATE ON public.trades FOR EACH ROW EXECUTE FUNCTION public.journal_derive_r();
-- Recompute derived fields without changing the source prices, stop or notes.
UPDATE public.trades SET r_multiple = r_multiple;

CREATE OR REPLACE FUNCTION public.journal_save_trade(p_trade_id bigint, p_patch jsonb, p_tag_ids bigint[] DEFAULT NULL, p_expected_revision bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE t public.trades; sl numeric; previous jsonb; previous_tags jsonb;
BEGIN
  SELECT * INTO t FROM public.trades WHERE id = p_trade_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trade not found' USING ERRCODE = 'P0002'; END IF;
  previous := to_jsonb(t);
  SELECT COALESCE(jsonb_agg(tag_id ORDER BY tag_id),'[]'::jsonb) INTO previous_tags FROM public.trade_tag_mappings WHERE trade_id=p_trade_id;
  IF p_expected_revision IS NULL OR p_expected_revision <> t.journal_revision THEN
    RAISE EXCEPTION 'This trade changed in another window. Reload it before saving.' USING ERRCODE = '40001';
  END IF;
  IF jsonb_typeof(p_patch) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k NOT IN ('notes','note_entry_reason','note_management','note_lessons','note_emotional_state','stop_loss')) THEN
    RAISE EXCEPTION 'Invalid note fields' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'stop_loss' THEN
    sl := (p_patch->>'stop_loss')::numeric;
    IF sl IS NOT NULL AND (sl <= 0 OR (t.entry_price IS NOT NULL AND (CASE WHEN t.direction = 'Long' THEN sl >= t.entry_price ELSE sl <= t.entry_price END))) THEN
      RAISE EXCEPTION 'Stop price must be below entry for a long trade and above entry for a short trade.' USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE public.trades SET
    notes = CASE WHEN p_patch ? 'notes' THEN p_patch->>'notes' ELSE t.notes END,
    note_entry_reason = CASE WHEN p_patch ? 'note_entry_reason' THEN p_patch->>'note_entry_reason' ELSE t.note_entry_reason END,
    note_management = CASE WHEN p_patch ? 'note_management' THEN p_patch->>'note_management' ELSE t.note_management END,
    note_lessons = CASE WHEN p_patch ? 'note_lessons' THEN p_patch->>'note_lessons' ELSE t.note_lessons END,
    note_emotional_state = CASE WHEN p_patch ? 'note_emotional_state' THEN p_patch->>'note_emotional_state' ELSE t.note_emotional_state END,
    stop_loss = CASE WHEN p_patch ? 'stop_loss' THEN sl ELSE t.stop_loss END
    WHERE id = p_trade_id RETURNING * INTO t;
  IF p_tag_ids IS NOT NULL THEN
    IF cardinality(p_tag_ids) > 200 OR EXISTS (SELECT 1 FROM unnest(p_tag_ids) supplied(value) WHERE supplied.value IS NULL OR NOT EXISTS (SELECT 1 FROM public.trade_tags tag WHERE tag.id = supplied.value)) THEN
      RAISE EXCEPTION 'A selected tag no longer exists' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.trade_tag_mappings WHERE trade_id = p_trade_id;
    INSERT INTO public.trade_tag_mappings(trade_id,tag_id) SELECT DISTINCT p_trade_id, unnest(p_tag_ids);
  END IF;
  INSERT INTO public.journal_events(action,details) VALUES ('trade_saved',jsonb_build_object('trade_id',p_trade_id,'before',previous,'after',to_jsonb(t),'tags_before',previous_tags,'tags_after',(SELECT COALESCE(jsonb_agg(tag_id ORDER BY tag_id),'[]'::jsonb) FROM public.trade_tag_mappings WHERE trade_id=p_trade_id)));
  RETURN to_jsonb(t) || jsonb_build_object('tag_ids', COALESCE((SELECT jsonb_agg(tag_id ORDER BY tag_id) FROM public.trade_tag_mappings WHERE trade_id=p_trade_id),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.journal_derive_r() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.journal_save_trade(bigint,jsonb,bigint[],bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.journal_derive_r(), public.journal_save_trade(bigint,jsonb,bigint[],bigint) TO service_role;
COMMIT;
