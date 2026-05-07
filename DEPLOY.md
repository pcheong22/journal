# Trading Journal — Deployment Guide
# Live on Vercel + Supabase in ~15 minutes, completely free

============================================================
STEP 1 — SET UP SUPABASE (your database)
============================================================

1. Go to https://supabase.com and click "Start your project" (free, no card needed)

2. Create a new project:
   - Name: trading-journal
   - Database password: choose a strong password (save it)
   - Region: pick the one closest to you

3. Wait ~2 minutes for the project to spin up

4. Go to the SQL Editor (left sidebar) and run the contents of:
   supabase-schema.sql
   (copy-paste the whole file and click Run)

5. Collect your API keys:
   - Go to Settings → API
   - Copy "Project URL" → this is NEXT_PUBLIC_SUPABASE_URL
   - Copy "anon public" key → this is NEXT_PUBLIC_SUPABASE_ANON_KEY
   - Copy "service_role" key → this is SUPABASE_SERVICE_ROLE_KEY
     ⚠️  Keep the service role key secret — never put it in frontend code

============================================================
STEP 2 — SET UP GITHUB (to connect to Vercel)
============================================================

1. Create a free account at https://github.com if you don't have one

2. Create a new repository called "trading-journal" (private is fine)

3. Upload all the project files to the repo:
   - Click "Add file" → "Upload files"
   - Drag the entire trading-journal folder contents
   - OR use Git if you're comfortable:
     git init
     git add .
     git commit -m "Initial trading journal"
     git remote add origin https://github.com/YOUR_USERNAME/trading-journal.git
     git push -u origin main

============================================================
STEP 3 — DEPLOY TO VERCEL
============================================================

1. Go to https://vercel.com and sign up with your GitHub account

2. Click "Add New Project" → "Import Git Repository"

3. Select your "trading-journal" repo

4. On the configuration screen:
   - Framework Preset: Next.js (auto-detected)
   - Root Directory: leave as /
   - Build Command: leave as default (npm run build)

5. Click "Environment Variables" and add these three:
   
   Name: NEXT_PUBLIC_SUPABASE_URL
   Value: https://your-project-id.supabase.co   (from Step 1)
   
   Name: NEXT_PUBLIC_SUPABASE_ANON_KEY
   Value: your-anon-key                         (from Step 1)
   
   Name: SUPABASE_SERVICE_ROLE_KEY
   Value: your-service-role-key                 (from Step 1)

6. Click "Deploy"

7. Wait ~60 seconds. Your app is live at:
   https://trading-journal-YOUR_USERNAME.vercel.app

============================================================
STEP 4 — UPLOAD YOUR TRADES
============================================================

1. Visit your live URL

2. Use the upload bar at the top of the page

3. Drag your broker export (Excel or CSV) onto it

4. It will:
   - Parse all trades
   - Skip any duplicates (by Position ID)
   - Show you a count of new trades imported
   - Instantly refresh the dashboard

5. Every future upload will only add NEW trades — safe to re-upload
   the same file multiple times, nothing duplicates

============================================================
UPDATING THE SITE IN FUTURE
============================================================

If I make changes to your code:
1. Download the new files
2. Update them in your GitHub repo (drag-and-drop upload, replace files)
3. Vercel auto-deploys within ~30 seconds of any GitHub push

That's it — no servers to manage, no ongoing costs for personal use.

============================================================
COSTS
============================================================

Vercel Hobby (free):
- Unlimited deployments
- 100GB bandwidth/month
- Serverless functions included
- Custom domain supported

Supabase Free:
- 500MB database storage
- Unlimited API requests
- Enough for 100,000+ trades

Both are free for personal use indefinitely.

============================================================
OPTIONAL — CUSTOM DOMAIN
============================================================

1. In Vercel dashboard → Your project → Settings → Domains
2. Add your domain (e.g. trades.yourdomain.com)
3. Follow DNS instructions
4. SSL certificate is automatic and free

============================================================
TROUBLESHOOTING
============================================================

"No trades showing after upload"
→ Check Vercel logs: Dashboard → Your project → Functions tab
→ Verify Supabase environment variables are set correctly

"Upload says 0 trades imported"
→ The file format may differ from expected. Check the column names match:
  Position ID, Direction, Entry time (GMT), Exit/Transfer Time (GMT),
  Symbol, Size, Entry price, Exit price, Notional (USD), Profit/Loss

"Build fails on Vercel"
→ Check the build logs for the specific error
→ Most common: missing environment variable

For any issues, the Vercel and Supabase dashboards both have
excellent free support via their community forums.
