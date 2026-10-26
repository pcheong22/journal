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

### Reviewed imports (stage 3)
Apply `migrations/20261026_stage_three_imports.sql` after stage 2. Uploads use scoped signed URLs into private storage, with SHA-256 verification, compressed original exports, a saved preview and a transactional commit. Existing notes and references stay attached to the same trade ID. Any market-data change requires a complete safety backup. Preview expiration or intervening account edits require a fresh preview. Import history offers original downloads and execution-detail retries; use the named pre-import safety copy in Backup & restore for full-journal recovery. Recovery replaces later journal changes too, which the restore preview makes explicit. Legacy `/api/upload` is intentionally disabled so older clients cannot bypass review.

Broker limitations are shown in each preview. PrimeXBT uses time grouping and inferred opens; Extended uses daily grouping; IBKR entries use inferred FIFO and do not certify tax lots. Source totals are export-row checks, not full account reconciliations. Rejected or ambiguous rows prevent commit. Original sources and ledger are included in new full backups; old stage-2 backups remain accepted and restore with an empty import ledger.

### Review workflow (stage 5)
Apply `migrations/20261026_stage_five_workflow.sql`. Bulk tags use a service-only transaction and expected journal revisions, preserving every other tag and note. The Reviewed journal tag is created only when first used. No existing trade is marked reviewed by migration. Selection is limited to 200 trades. The unreviewed inbox and weekly shortcut use the selected accounts/date range. Saved views live in browser preferences and travel with preference-inclusive full backups. Note drafts are local to the browser and are explicitly restored; they are not server-saved notes or part of full backups. A recovered draft from an older journal revision displays a warning. Navigation and tab closing warn about unsaved changes; keyboard navigation is disabled while typing.

### Quiet research ledger redesign

The rollback checkpoint is Git tag `journal-before-redesign-settings-fixed-20261026` at `72a42fc` (working Settings and backup access). A verified full backup was created on 26 October 2026 before this redesign: `journal-before-redesign-full-backup.json`, containing 1,902 trades, 12 accounts and all 11 attachment files. No database migration is required for the visual redesign.

For a visual rollback, revert the redesign merge commit and let the normal production build deploy. This preserves all later trades, notes and tags. Do not restore the database solely to undo the UI. Full-journal restore remains available under the profile menu → Settings & backups, with a preview and typed confirmation; it replaces later journal edits too. The previous immutable Git tags and existing private backups are retained.

`/design-preview` is a public, read-only visual demonstration with generated sample records only. It uses the same workspace components, does not request live journal data, and blocks journal API requests. The normal journal and every data API keep owner authentication. The profile menu replaces the floating Sign out button. Account deletion is under Settings → Account administration and retains the existing typed-confirmation and automatic-backup protections.

Price checks are presentation-only: if reported P&L disagrees with entry-to-exit direction on a back-solved position, display a source-check warning and withhold price-derived return, R and estimated notional. Keep the reported P&L and original saved prices unchanged. A complete original broker export is needed to resolve an inferred opening match; a UI redesign is not evidence for rewriting it.
