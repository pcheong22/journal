# Secure journal deployment

Stage 1 uses Supabase email links and a single approved owner. Every data API verifies the Supabase user on the server; database and storage access use the private service-role key. The browser receives HttpOnly, Secure, SameSite=Lax session cookies. All mutations require a custom header and the exact configured origin.

## Hosting configuration

Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY for each environment. Never use the public key as a fallback for server database access.

Set JOURNAL_OWNER_EMAIL privately in Vercel. Set JOURNAL_APP_URL to the exact HTTPS origin used to open that deployment (no trailing path). Missing owner/origin configuration blocks access. Preview and production must use separate Supabase projects and matching origins.

## Supabase setup and rollout

1. Inspect the target project, tables, views, functions, storage policies, counts and existing users. This migration assumes a dedicated journal project. Retain a recoverable database and storage backup before changing production settings.
2. Provision the approved owner through Supabase Authentication. Email sign-in is enabled; public signups are disabled after the owner exists. Configure the Site URL and allowed redirect URL to JOURNAL_APP_URL and JOURNAL_APP_URL/auth/callback. Use the standard Supabase confirmation-link email template; the server uses PKCE. Verify email delivery (Supabase default mail is restricted; configure SMTP if necessary). No password is required.
3. Deploy and test the guarded APIs in development first, with service-role credentials. Open the email link in the browser that requested it. Verify owner access and refresh; other emails, anonymous reads/writes, and cross-origin mutations must fail.
4. Apply migrations/20261026_stage_one_access.sql in development, then verify table/view/RPC/storage access is denied for both anon and authenticated roles. Check owner workflows and counts again. API image URLs proxy private storage; historical image URL values remain locators so existing attachments and temporary missed-trade attachments are retained.
5. Deploy the guarded application to production and verify owner sign-in before applying the same production migration. Validate the 1,902-trade / 12-account baseline against current counts (allow for intentional intervening imports). Check attachments, execution drilldowns and a repeated CSV import. Do not test deletion on real accounts.
6. Retire or protect older deployments that still expose the previous unauthenticated APIs and service-role credentials. Revoking anon access does not protect an old server route that uses the service role. This is a production completion gate.

The SQL migration changes grants, policies, bucket privacy and adds a service-only transactional account deletion function. It does not delete journal rows. Never run supabase-reset.sql or drop/recreate tables as an upgrade.

## Resource limits

Trade uploads allow one CSV/XLS/XLSX file up to 20 MB, 100,000 data rows and 300 columns. XLSX archives are checked before parsing with a 40 MB expansion limit. Screenshots allow PNG/JPG/WEBP/GIF up to 10 MB and 40 million pixels. Remote image fetching accepts only fixed HTTPS TradingView snapshot paths, refuses redirects and times out after ten seconds. Other screenshots can be uploaded as files.

## Validation

Run npm ci, npm test, and npm run build with the required environment variables. .env.example contains placeholders only. The lockfile pins deployments. SheetJS uses its official patched distribution because the npm registry version is obsolete. Next.js stays on the latest 14.2 patch for this stage; the unused image optimizer is disabled. The remaining major framework/toolchain upgrade and dependency advisories require a separate reviewed change; this stage does not claim a clean dependency audit.

## Recovery

Keep the previous deploy and an administrator database connection available during the rollout. If owner access fails, repair the email/origin/Auth settings using the administrator dashboard or roll back to a previously verified guarded deployment. Do not restore public policies or redeploy an unauthenticated build to recover access. The migration is idempotent; inspect migration results rather than retrying blindly after a failure.

## Stage 2 data safety

Apply 20261026_stage_two_backup.sql before 20261026_stage_two_notes.sql. The latter records a database checkpoint before adding journal revisions and recomputing R-multiples. Test both migrations in development first. Notes and tag changes use one service-only transaction; omitted tags are preserved, an explicit empty list clears them, and stale revisions return 409. A trigger recomputes R when imported prices, direction or stop change.

Settings → Backup & restore creates a full JSON bundle, stored privately and downloadable through a one-minute signed link. It includes all journal tables, local preferences, screenshots and immutable execution records; authentication credentials and hosting secrets are excluded. Limits are 20 MB of database JSON, 20 MB of source attachments and 50 MB per bundle. Restore uploads go directly to a one-object signed storage URL, avoiding the hosting request-body limit. The file is checked for project/schema compatibility, checksums and referenced screenshots before any restoration.

Restore previews current and backup row counts. It requires RESTORE JOURNAL, saves a complete safety copy, refuses to overwrite an existing file with different contents, and replaces journal tables in one database transaction. Changes made after preview cause a conflict instead of an overwrite. Retained files and managed safety backups remain available; no automatic backup deletion is performed. Recent safety copies can be selected for restoration from Settings. Test restoration in a rolled-back development transaction; never use real production accounts as disposable test data.
