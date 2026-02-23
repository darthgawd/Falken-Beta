-- ==========================================
-- BotByte: THE NUCLEAR DATABASE RESET
-- Run this in your Supabase SQL Editor to
-- wipe all data and start from Match #1.
-- ==========================================

-- 1. Disable RLS temporarily to ensure clean wipe
ALTER TABLE matches DISABLE ROW LEVEL SECURITY;
ALTER TABLE rounds DISABLE ROW LEVEL SECURITY;
ALTER TABLE agent_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE manager_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys DISABLE ROW LEVEL SECURITY;

-- 2. TRUNCATE ALL TABLES (Wipes everything)
TRUNCATE TABLE rounds CASCADE;
TRUNCATE TABLE matches CASCADE;
TRUNCATE TABLE agent_profiles CASCADE;
TRUNCATE TABLE manager_profiles CASCADE;
TRUNCATE TABLE api_keys CASCADE;

-- 3. Reset Indexer Progress to Contract Deployment
-- Setting to 37979970 to ensure we catch Match #1
UPDATE sync_state SET last_processed_block = 37979970 WHERE id = 'indexer_main';

-- 4. Re-enable RLS
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE manager_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- 5. Force Refresh Schema Cache
NOTIFY pgrst, 'reload schema';

-- Verification (Should all be 0)
SELECT count(*) as match_count FROM matches;
SELECT last_processed_block FROM sync_state WHERE id = 'indexer_main';
