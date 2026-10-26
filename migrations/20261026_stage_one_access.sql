-- Dedicated journal Supabase project only. Apply after deploying the guarded APIs
-- with a service-role key and verifying owner sign-in. No trade rows are changed.
BEGIN;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('DROP POLICY IF EXISTS journal_deny_direct_access ON public.%I', t.tablename);
    EXECUTE format('CREATE POLICY journal_deny_direct_access ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t.tablename);
  END LOOP;
END $$;
-- Existing public policies cannot override this restrictive bucket policy.
DROP POLICY IF EXISTS journal_private_storage ON storage.objects;
CREATE POLICY journal_private_storage ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (bucket_id NOT IN ('trade-images', 'trade-executions'))
  WITH CHECK (bucket_id NOT IN ('trade-images', 'trade-executions'));
UPDATE storage.buckets SET public = false WHERE id IN ('trade-images', 'trade-executions');

CREATE OR REPLACE FUNCTION public.journal_clear_accounts(p_account_id text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id) THEN
    RAISE EXCEPTION 'Account not found';
  END IF;
  DELETE FROM public.accounts WHERE p_account_id IS NULL OR id = p_account_id;
END $$;
REVOKE ALL ON FUNCTION public.journal_clear_accounts(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.journal_clear_accounts(text) TO service_role;
COMMIT;
