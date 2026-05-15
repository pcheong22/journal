-- ============================================================
-- STEP 1: Run this first to fix the existing tables
-- ============================================================

-- Drop everything cleanly so the schema can rebuild from scratch
DROP TABLE IF EXISTS trade_tag_mappings CASCADE;
DROP TABLE IF EXISTS trade_tags CASCADE;
DROP TABLE IF EXISTS missed_trades CASCADE;
DROP TABLE IF EXISTS trades CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;

-- ============================================================
-- STEP 2: Then run supabase-schema.sql in full
-- ============================================================
