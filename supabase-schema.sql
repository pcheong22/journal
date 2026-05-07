-- Run this in your Supabase SQL editor to set up the database
-- Go to: https://supabase.com → Your Project → SQL Editor

-- Trades table
CREATE TABLE IF NOT EXISTS trades (
  id BIGSERIAL PRIMARY KEY,
  position_id TEXT UNIQUE NOT NULL,          -- broker position ID (deduplication key)
  entry_time TIMESTAMPTZ NOT NULL,
  exit_time TIMESTAMPTZ,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('Long', 'Short')),
  size NUMERIC,
  entry_price NUMERIC,
  exit_price NUMERIC,
  notional_usd NUMERIC,
  pnl NUMERIC NOT NULL,
  pct_gain NUMERIC,
  duration_mins NUMERIC,
  session TEXT,
  day_of_week TEXT,
  tv_symbol TEXT,
  raw_direction TEXT,                        -- original broker Buy/Sell label
  created_at TIMESTAMPTZ DEFAULT NOW(),
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast queries
CREATE INDEX IF NOT EXISTS trades_entry_time_idx ON trades(entry_time);
CREATE INDEX IF NOT EXISTS trades_symbol_idx ON trades(symbol);
CREATE INDEX IF NOT EXISTS trades_session_idx ON trades(session);
CREATE INDEX IF NOT EXISTS trades_direction_idx ON trades(direction);

-- Enable Row Level Security (keeps data private)
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

-- Allow all operations (since this is a personal single-user app)
-- For multi-user you'd add auth here
CREATE POLICY "Allow all" ON trades FOR ALL USING (true) WITH CHECK (true);

-- Helpful view for dashboard stats
CREATE OR REPLACE VIEW trade_stats AS
SELECT
  COUNT(*) as total_trades,
  SUM(pnl) as total_pnl,
  AVG(CASE WHEN pnl > 0 THEN 1.0 ELSE 0.0 END) as win_rate,
  AVG(CASE WHEN pnl > 0 THEN pnl END) as avg_win,
  AVG(CASE WHEN pnl < 0 THEN pnl END) as avg_loss,
  MAX(pnl) as best_trade,
  MIN(pnl) as worst_trade,
  MIN(entry_time) as first_trade,
  MAX(entry_time) as last_trade
FROM trades;
