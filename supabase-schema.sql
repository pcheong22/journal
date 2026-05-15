-- ============================================================
-- Trading Journal — Supabase Schema v3
-- Full tag library: ~100 tags across 5 categories
-- Sourced from post-trade journaling preset screenshots
--
-- HOW TO RUN:
--   1. supabase.com → your project → SQL Editor
--   2. If upgrading, run first:
--        DROP TABLE IF EXISTS trade_tag_mappings CASCADE;
--        DROP TABLE IF EXISTS trade_tags CASCADE;
--        DROP TABLE IF EXISTS missed_trades CASCADE;
--        DROP TABLE IF EXISTS trades CASCADE;
--        DROP TABLE IF EXISTS accounts CASCADE;
--   3. Paste this file and click Run
-- ============================================================

-- ── ACCOUNTS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id         TEXT PRIMARY KEY,
  broker     TEXT NOT NULL DEFAULT 'PrimeXBT',
  label      TEXT,
  currency   TEXT DEFAULT 'USD',
  color      TEXT DEFAULT '#1a56db',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── TRADES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trades (
  id            BIGSERIAL PRIMARY KEY,
  position_id   TEXT NOT NULL,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  broker        TEXT NOT NULL DEFAULT 'PrimeXBT',
  entry_time    TIMESTAMPTZ NOT NULL,
  exit_time     TIMESTAMPTZ,
  symbol        TEXT NOT NULL,
  direction     TEXT NOT NULL CHECK (direction IN ('Long','Short')),
  size          NUMERIC,
  entry_price   NUMERIC,
  exit_price    NUMERIC,
  notional_usd  NUMERIC,
  pnl           NUMERIC NOT NULL,
  pct_gain      NUMERIC,
  fee           NUMERIC DEFAULT 0,
  duration_mins NUMERIC,
  currency      TEXT DEFAULT 'USD',
  session       TEXT,
  day_of_week   TEXT,
  tv_symbol     TEXT,
  raw_direction TEXT,
  order_type    TEXT,
  stop_loss            NUMERIC,
  r_multiple           NUMERIC,
  notes                TEXT,
  note_entry_reason    TEXT,
  note_management      TEXT,
  note_lessons         TEXT,
  note_emotional_state TEXT,
  streak_id            TEXT,
  UNIQUE (account_id, position_id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── TRADE TAGS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_tags (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  category    TEXT NOT NULL CHECK (category IN ('Psychology','Setup','Risk','Journal','Market','Custom')),
  color       TEXT NOT NULL DEFAULT '#6b7280',
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trade_tag_mappings (
  trade_id  BIGINT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  tag_id    BIGINT NOT NULL REFERENCES trade_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (trade_id, tag_id)
);

-- ── MISSED TRADES ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS missed_trades (
  id               BIGSERIAL PRIMARY KEY,
  account_id       TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  symbol           TEXT NOT NULL,
  direction        TEXT CHECK (direction IN ('Long','Short')),
  entry_time       TIMESTAMPTZ NOT NULL,
  exit_time        TIMESTAMPTZ,
  entry_price      NUMERIC,
  exit_price       NUMERIC,
  hypothetical_pnl NUMERIC,
  reason_missed    TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS trades_account_idx     ON trades(account_id);
CREATE INDEX IF NOT EXISTS trades_entry_time_idx  ON trades(entry_time);
CREATE INDEX IF NOT EXISTS trades_symbol_idx      ON trades(symbol);
CREATE INDEX IF NOT EXISTS trades_session_idx     ON trades(session);
CREATE INDEX IF NOT EXISTS trades_pnl_idx         ON trades(pnl);
CREATE INDEX IF NOT EXISTS tag_mappings_trade_idx ON trade_tag_mappings(trade_id);
CREATE INDEX IF NOT EXISTS tag_mappings_tag_idx   ON trade_tag_mappings(tag_id);

-- ── ROW LEVEL SECURITY ────────────────────────────────────
ALTER TABLE trades             ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_tags         ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_tag_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE missed_trades      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on trades"             ON trades             FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on accounts"           ON accounts           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on trade_tags"         ON trade_tags         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on trade_tag_mappings" ON trade_tag_mappings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on missed_trades"      ON missed_trades      FOR ALL USING (true) WITH CHECK (true);

-- ── SEED TAGS ─────────────────────────────────────────────
-- ~100 tags from post-trade journaling presets
-- emotional→Psychology | technical→Setup | risk→Risk | journal→Journal | market→Market

INSERT INTO trade_tags (name, category, color, description) VALUES

  -- PSYCHOLOGY
  ('FOMO Entry',              'Psychology', '#ea580c', 'Entering out of Fear of Missing Out'),
  ('Confidence Level',        'Psychology', '#0891b2', 'How confident are you in this trade?'),
  ('Fear/Greed Assessment',   'Psychology', '#7c3aed', 'What is your dominant emotion?'),
  ('Overconfidence Check',    'Psychology', '#d97706', 'Do you feel like you cannot lose?'),
  ('Mental Clarity',          'Psychology', '#0369a1', 'How clear is your thinking right now?'),
  ('Discipline Score',        'Psychology', '#059669', 'How well are you following your rules today?'),
  ('Stress Level',            'Psychology', '#dc2626', 'Current stress level while trading'),
  ('Energy Level',            'Psychology', '#16a34a', 'Current energy and alertness level'),
  ('Gut Feeling',             'Psychology', '#7c3aed', 'What does your intuition say?'),
  ('Revenge Trading',         'Psychology', '#dc2626', 'Entering to recover from recent losses'),
  ('Sleep Quality',           'Psychology', '#0891b2', 'How well did you sleep last night?'),
  ('Post-Trade Emotion',      'Psychology', '#059669', 'How do you feel after this trade?'),
  ('Impulsive Decision',      'Psychology', '#ea580c', 'Was this trade impulsive?'),
  ('Fear of Being Wrong',     'Psychology', '#dc2626', 'Are you afraid of being proven wrong?'),
  ('Attachment to Position',  'Psychology', '#be185d', 'How emotionally attached are you to this trade?'),
  ('Emotional State',         'Psychology', '#7c3aed', 'Select all emotions you are currently feeling'),
  ('Pressure Level',          'Psychology', '#d97706', 'How much pressure do you feel right now?'),
  ('Outside Influence',       'Psychology', '#9ca3af', 'Are you influenced by others on this trade?'),
  ('Second-Guessing',         'Psychology', '#d97706', 'Are you second-guessing your decision?'),
  ('Regret Anticipation',     'Psychology', '#ea580c', 'Entering to avoid future regret?'),
  ('Patience Level',          'Psychology', '#059669', 'Are you being patient or forcing trades?'),
  ('Bias Acknowledgment',     'Psychology', '#7c3aed', 'What biases might be affecting this decision?'),

  -- SETUP
  ('Trend Follow',            'Setup',      '#1a56db', 'Trading in direction of prevailing trend'),
  ('Pullback',                'Setup',      '#7c3aed', 'Entry on retracement within a trend'),
  ('Counter-Trend',           'Setup',      '#be185d', 'Trading against the prevailing trend'),
  ('Breakout/Breakdown',      'Setup',      '#059669', 'Is this a breakout or breakdown?'),
  ('Chart Pattern',           'Setup',      '#1a56db', 'What chart pattern(s) do you see?'),
  ('Candlestick Pattern',     'Setup',      '#0891b2', 'What candlestick pattern formed?'),
  ('Previous High',           'Setup',      '#059669', 'What was the previous high price level?'),
  ('Previous Low',            'Setup',      '#059669', 'What was the previous low price level?'),
  ('Timeframe Alignment',     'Setup',      '#1a56db', 'Are multiple timeframes aligned?'),
  ('Confluence Factors',      'Setup',      '#7c3aed', 'What factors are converging?'),
  ('Price Target',            'Setup',      '#059669', 'Expected price target for this trade'),
  ('Target Hit',              'Setup',      '#059669', 'Did you hit your price target?'),
  ('Execution Quality',       'Setup',      '#1a56db', 'How well executed was this trade?'),
  ('Trailing Stop',           'Setup',      '#d97706', 'Using a trailing stop on this trade?'),
  ('Key Moving Averages',     'Setup',      '#0891b2', 'Which moving averages are relevant?'),
  ('Support Level',           'Setup',      '#059669', 'Key support price level'),
  ('Resistance Level',        'Setup',      '#dc2626', 'Key resistance price level'),
  ('Volume Analysis',         'Setup',      '#1a56db', 'Volume confirmation for this move'),
  ('Indicator Signals',       'Setup',      '#0891b2', 'Which indicators are confirming the setup?'),
  ('RSI Level',               'Setup',      '#7c3aed', 'Current RSI reading at entry'),
  ('Gap Analysis',            'Setup',      '#d97706', 'Are there any gaps to fill?'),
  ('Order Flow',              'Setup',      '#1a56db', 'What does order flow indicate?'),
  ('Momentum Strength',       'Setup',      '#1a56db', 'How strong is the current momentum?'),
  ('Fibonacci Levels',        'Setup',      '#7c3aed', 'Relevant Fibonacci retracement levels'),
  ('Key Levels Mapped',       'Setup',      '#0891b2', 'Have you mapped out the key price levels?'),
  ('Trend Direction',         'Setup',      '#1a56db', 'What is the prevailing trend direction?'),
  ('Price Action Notes',      'Setup',      '#059669', 'Describe the price action observed'),
  ('Pivot Points',            'Setup',      '#9ca3af', 'Are you using pivot points?'),
  ('Catalyst',                'Setup',      '#ea580c', 'What is the catalyst for this move?'),
  ('Setup Quality',           'Setup',      '#1a56db', 'Overall setup quality rating'),
  ('Volatility Level',        'Setup',      '#ea580c', 'Current volatility environment'),
  ('Entered Too Soon',        'Setup',      '#ea580c', 'Did you enter the trade too early?'),
  ('Entered Too Late',        'Setup',      '#d97706', 'Did you enter the trade too late?'),
  ('Exited Too Soon',         'Setup',      '#ea580c', 'Did you exit the trade too early?'),
  ('Exited Too Late',         'Setup',      '#d97706', 'Did you exit the trade too late?'),

  -- RISK
  ('Account Risk %',          'Risk',       '#dc2626', 'Total account % risked on this trade'),
  ('Maximum Risk $',          'Risk',       '#dc2626', 'Max dollar amount at risk'),
  ('Position Size %',         'Risk',       '#d97706', 'Position size as % of total account'),
  ('Maximum Loss Acceptable', 'Risk',       '#dc2626', 'What loss would you accept on this trade?'),
  ('Risk vs Plan',            'Risk',       '#d97706', 'Are you following your risk management rules?'),
  ('Stop Loss Hit',           'Risk',       '#dc2626', 'Did your stop loss trigger?'),
  ('Break-Even Plan',         'Risk',       '#059669', 'When will you move stop to break-even?'),
  ('Risk/Reward Ratio',       'Risk',       '#0891b2', 'Expected R:R ratio before entry'),
  ('Scaling Plan',            'Risk',       '#1a56db', 'Will you scale in or out of this trade?'),
  ('Position Sizing Logic',   'Risk',       '#d97706', 'How did you calculate your position size?'),
  ('Profit Goal',             'Risk',       '#059669', 'Expected profit target in dollar amount'),
  ('Exit Strategy',           'Risk',       '#1a56db', 'Detailed exit plan for this trade'),
  ('Contingency Plan',        'Risk',       '#d97706', 'What is your plan if price goes against you?'),
  ('Maximum Holding Time',    'Risk',       '#9ca3af', 'Maximum time you will hold this trade'),

  -- JOURNAL
  ('Trade Thesis',            'Journal',    '#1a56db', 'What was your trading thesis?'),
  ('What Went Well',          'Journal',    '#059669', 'What did you do right on this trade?'),
  ('What Went Wrong',         'Journal',    '#dc2626', 'What mistakes were made on this trade?'),
  ('Key Lesson Learned',      'Journal',    '#7c3aed', 'Main takeaway from this trade'),
  ('Next Time Action',        'Journal',    '#1a56db', 'Specific action to take on next similar trade'),
  ('Overall Grade',           'Journal',    '#d97706', 'Grade this trade from A to F'),
  ('Plan Adherence',          'Journal',    '#059669', 'How well did you follow your trading plan?'),
  ('Rules Followed',          'Journal',    '#059669', 'Which trading rules did you follow?'),
  ('Rules Broken',            'Journal',    '#dc2626', 'Which trading rules did you break?'),
  ('Trade Not in Plan',       'Journal',    '#ea580c', 'Was this trade outside your trading plan?'),
  ('Pre-Trade Checklist',     'Journal',    '#1a56db', 'Did you complete your pre-trade checklist?'),
  ('Would Take Again',        'Journal',    '#059669', 'Would you take this exact trade again?'),
  ('Pattern Recognition',     'Journal',    '#7c3aed', 'Do you see patterns in your trading behavior?'),
  ('Improvement Notes',       'Journal',    '#0891b2', 'How can you improve on this type of trade?'),
  ('Edge Identified',         'Journal',    '#059669', 'What edge did you identify for this trade?'),
  ('Decision Quality',        'Journal',    '#1a56db', 'Was this decision rational or emotional?'),
  ('What Happened',           'Journal',    '#9ca3af', 'Describe what happened in this trade'),
  ('Free-Form Notes',         'Journal',    '#6b7280', 'Additional thoughts or observations'),
  ('Missed Planned Trade',    'Journal',    '#d97706', 'Did you miss a trade that was in your plan?'),
  ('Daily Goal Progress',     'Journal',    '#059669', 'Progress toward your daily trading goal'),
  ('Trade Frequency Today',   'Journal',    '#d97706', 'How many trades have you taken today?'),
  ('Gratitude Note',          'Journal',    '#059669', 'What are you grateful for today?'),
  ('Profit Achieved',         'Journal',    '#059669', 'Actual profit or loss on the trade'),
  ('Sentiment Indicator',     'Journal',    '#7c3aed', 'Market sentiment reading at time of trade'),
  ('Diversification Check',   'Journal',    '#0891b2', 'Is this trade diversifying your portfolio?'),

  -- MARKET
  ('Market Condition',        'Market',     '#1a56db', 'Overall market environment at time of trade'),
  ('Market Trend',            'Market',     '#1a56db', 'Broader market direction'),
  ('News Events',             'Market',     '#d97706', 'Relevant news or events affecting this trade'),
  ('Sector Strength',         'Market',     '#0891b2', 'How is the sector performing?'),
  ('Unusual Activity',        'Market',     '#ea580c', 'Any unusual market behavior observed?'),
  ('Institutional Activity',  'Market',     '#7c3aed', 'Signs of institutional buying or selling?'),
  ('Liquidity Assessment',    'Market',     '#0891b2', 'How liquid is this instrument?'),
  ('Spread Analysis',         'Market',     '#9ca3af', 'Bid-ask spread observation'),
  ('Intermarket Analysis',    'Market',     '#1a56db', 'How are correlated markets performing?'),
  ('Breadth Analysis',        'Market',     '#0891b2', 'Market breadth advance/decline ratio'),
  ('Options Flow',            'Market',     '#7c3aed', 'Unusual options activity observed'),
  ('Economic Data',           'Market',     '#d97706', 'Important economic releases today'),
  ('Volatility (VIX)',        'Market',     '#ea580c', 'VIX level and volatility environment'),
  ('Day of Week Impact',      'Market',     '#9ca3af', 'Does the day of week affect this trade?'),
  ('Seasonality',             'Market',     '#059669', 'Seasonal trends affecting this instrument?'),
  ('Correlation Check',       'Market',     '#1a56db', 'Related instruments confirming the move?'),
  ('Portfolio Correlation',   'Market',     '#7c3aed', 'Correlation with existing open positions'),
  ('Market Cap',              'Market',     '#9ca3af', 'Market capitalization category of this asset')

ON CONFLICT (name) DO NOTHING;
