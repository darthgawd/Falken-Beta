-- ==========================================
-- BotByte: ENABLE REALTIME REPLICATION
-- Run this in your Supabase SQL Editor to 
-- enable live dashboard updates.
-- ==========================================

-- 1. Ensure the realtime publication exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

-- 2. Add the Arena tables to the publication
-- We use 'ALTER' because they might already be in another publication
-- or we want to ensure they are added to the system one.
ALTER PUBLICATION supabase_realtime ADD TABLE matches;
ALTER PUBLICATION supabase_realtime ADD TABLE agent_profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE rounds;

-- 3. Verify
-- You can run this to see if it worked:
-- SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
