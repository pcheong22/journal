# Trading Journal v4 — Deployment Guide
# PrimeXBT · Phase 1 Features · AI Stub Ready

============================================================
WHAT'S NEW IN V4
============================================================

✓ Supabase schema v3 — tags, notes, stop_loss, R-Multiple, streaks
✓ Trade tagging system — Setup / Psychology / Execution (21 default tags)
✓ Per-trade notes — structured template + free-text
✓ R-Multiple — optional, auto-calculates when stop loss entered
✓ Win/Loss Streaks — dedicated Streaks tab with visualisation
✓ Date range filter — YTD default, presets + custom picker (server-side)
✓ Privacy toggle — eye icon blurs all P&L values + chart Y-axis
✓ AI coach stub — /api/ai-coach.js ready, activate with QWEN_API_KEY
✓ Modular broker parsers — lib/parsers/primexbt.js (easily add more)
✓ Unified parseDate() — handles all date formats across brokers

============================================================
STEP 1 — SUPABASE SCHEMA (run once)
============================================================

1. Go to supabase.com → your project → SQL Editor

2. If upgrading from a previous version, clear old tables first:

     DROP TABLE IF EXISTS trade_tag_mappings CASCADE;
     DROP TABLE IF EXISTS trade_tags CASCADE;
     DROP TABLE IF EXISTS missed_trades CASCADE;
     DROP TABLE IF EXISTS trades CASCADE;
     DROP TABLE IF EXISTS accounts CASCADE;

3. Open supabase-schema.sql from this zip.
   Copy all contents → paste into SQL Editor → click Run.

4. The schema creates:
   - accounts         (one row per broker sub-account)
   - trades           (all trade data + notes + stop_loss)
   - trade_tags       (21 default tags pre-seeded)
   - trade_tag_mappings (many-to-many trades ↔ tags)
   - missed_trades    (manually logged missed opportunities)

5. Verify: click Table Editor — you should see all 5 tables.

6. Get your API keys:
   Settings → API:
   - Project URL         → NEXT_PUBLIC_SUPABASE_URL
   - anon/public key     → NEXT_PUBLIC_SUPABASE_ANON_KEY
   - service_role key    → SUPABASE_SERVICE_ROLE_KEY

============================================================
STEP 2 — GITHUB (upload files)
============================================================

Go to your GitHub repo, click Add file → Upload files.
Open this zip, open the trading-journal folder inside,
select ALL contents and drag onto GitHub. Commit.

Key new/changed files:
  supabase-schema.sql              ← v3 schema (run in Supabase first)
  lib/tradeUtils.js                ← master router + stats + simulation
  lib/parserUtils.js               ← shared date/symbol/session utils
  lib/parsers/primexbt.js          ← PrimeXBT-specific parser
  pages/api/upload.js              ← upload with streak computation
  pages/api/trades.js              ← server-side date + account filter
  pages/api/trade-notes.js         ← save notes, tags, stop loss
  pages/api/ai-coach.js            ← AI stub (activate with QWEN_API_KEY)
  pages/index.js                   ← full dashboard with Phase 1 features
  components/Charts.js             ← all charts incl. streaks
  components/TradeModal.js         ← trade detail with notes + tags
  styles/globals.css               ← privacy mode + tag + streak styles

Vercel auto-deploys within ~30 seconds of any GitHub push.

============================================================
STEP 3 — VERCEL ENVIRONMENT VARIABLES
============================================================

In Vercel → your project → Settings → Environment Variables:

  NEXT_PUBLIC_SUPABASE_URL      = https://xxxxx.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJhbGci...
  SUPABASE_SERVICE_ROLE_KEY     = eyJhbGci...
  QWEN_API_KEY                  = (leave blank for stub mode)

If you already had these set, no change needed.
Add QWEN_API_KEY when you're ready to activate AI coaching.

============================================================
STEP 4 — UPLOADING TRADES
============================================================

PrimeXBT:
  Orders → Closed Orders → Export CSV
  Filename: DATE_ACCOUNTID_CURRENCY_orders.csv
  e.g. 2026-05-08_L259832_USDC_orders.csv

Each upload:
  - Auto-detects PrimeXBT format from filename + headers
  - Extracts account ID and currency from filename
  - Deduplicates by position_id per account
  - Computes win/loss streaks across all trades on import
  - Creates account entry automatically if new

============================================================
PHASE 1 FEATURES — HOW TO USE
============================================================

DATE RANGE FILTER (bar below header):
  Defaults to YTD (Jan 1 of current year → today)
  Presets: 7D · 30D · 3M · 6M · YTD · 1Y · All
  Custom: pick any start and end date
  All charts + stats update instantly, server-side filtering

PRIVACY TOGGLE (eye icon in header):
  Click 👁 to blur all P&L values and chart Y-axes
  Click again to reveal
  Useful for screenshots or sharing screen

TRADE TAGGING (in trade detail modal):
  Click any trade row → Tags section at bottom
  Select from 21 pre-built tags across Setup / Psychology / Execution
  Tags are colour-coded and saved to database
  Filter trade log by tag (coming in filter bar)
  Upload your own tag reference list to extend defaults

PER-TRADE NOTES (in trade detail modal):
  Structured template:
    - Why did you enter this trade?
    - How did you manage it?
    - What would you do differently?
    - Emotional state during trade
  Plus free-text notes field below
  All saved to Supabase, visible on next load

R-MULTIPLE (in trade detail modal):
  Enter your stop loss price → R-Multiple auto-calculates
  Formula: (exit - entry) / (entry - stop) for Long
           (entry - exit) / (stop - entry) for Short
  Optional — only shown when stop loss is entered
  Saved to database

WIN/LOSS STREAKS (Streaks tab):
  Visual timeline of consecutive wins/losses
  Shows current streak, max win streak, max loss streak
  Computed on upload, updated on each import

AI COACH (stub mode):
  Trade detail modal → "Get AI Analysis" button
  Returns stub message until QWEN_API_KEY is set
  When activated: analyses trade + notes and returns
  insights, coaching tip, pattern flags, rule compliance

============================================================
ADDING MORE BROKERS LATER
============================================================

1. Create lib/parsers/yourbroker.js
   Export: parseBroker(rows, accountId) → trade[]
   Export: extractBrokerMeta(filename) → { accountId, currency }

2. Add detection logic in lib/parserUtils.js → detectBroker()

3. Add routing in lib/tradeUtils.js → parseTradeFile()

That's it. Each parser is fully isolated.

============================================================
REMINDER — PENDING ITEMS
============================================================

- Tag list screenshots: upload when ready to extend default tags
- Extended/Generic format: add when you have the file with
  entry_time and exit_time separated
- Bybit / Hyperliquid / IBKR: parsers ready to add when needed
- AI activation: set QWEN_API_KEY in Vercel when you have key
