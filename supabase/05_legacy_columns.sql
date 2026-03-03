-- ==========================================
-- Falken: ADD MISSING COLUMNS FOR TRANSPARENCY
-- Run this in your Supabase SQL Editor to 
-- enable transaction hash tracking.
-- ==========================================

ALTER TABLE rounds ADD COLUMN IF NOT EXISTS commit_tx_hash TEXT;
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS reveal_tx_hash TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS settle_tx_hash TEXT;

-- This helps the API recognize new columns immediately
NOTIFY pgrst, 'reload schema';
