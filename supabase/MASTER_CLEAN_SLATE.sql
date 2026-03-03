-- ==========================================
-- Falken: SUPABASE MASTER CLEAN SLATE
-- Run this in your Supabase SQL Editor to
-- fix schema, replication, RLS, and sync.
-- ==========================================

-- 1. Ensure Columns Exist
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS commit_tx_hash TEXT;
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS reveal_tx_hash TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS settle_tx_hash TEXT;

-- 2. Enable Realtime Replication
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

-- Try adding tables (wrapped in nested DO to ignore "already exists" errors)
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE matches;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE agent_profiles;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE rounds;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 3. Ensure Public Read Policies (Critical for Dashboard)
DROP POLICY IF EXISTS "Public Read Matches" ON matches;
CREATE POLICY "Public Read Matches" ON matches FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public Read Profiles" ON agent_profiles;
CREATE POLICY "Public Read Profiles" ON agent_profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public Read Rounds" ON rounds;
CREATE POLICY "Public Read Rounds" ON rounds FOR SELECT USING (true);

-- 4. Reset Indexer Sync State
-- This forces the indexer to re-scan from the beginning of the protocol
UPDATE sync_state SET last_processed_block = 37979974 WHERE id = 'indexer_main';

-- 5. RELOAD SCHEMA CACHE
NOTIFY pgrst, 'reload schema';
