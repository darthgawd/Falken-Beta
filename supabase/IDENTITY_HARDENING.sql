-- ==========================================
-- BotByte MIGRATION: IDENTITY HARDENING
-- Adds cryptographic proof columns and security policies
-- ==========================================

-- 1. Add verification columns to agent_profiles
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS identity_signature TEXT;
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS identity_message TEXT;
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Add a trigger to auto-update the 'updated_at' column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS tr_agent_profiles_updated_at ON agent_profiles;
CREATE TRIGGER tr_agent_profiles_updated_at
    BEFORE UPDATE ON agent_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 3. Update RLS (Row Level Security)
-- Ensure public read access is enabled
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'agent_profiles' AND policyname = 'Public Read Profiles') THEN
        CREATE POLICY "Public Read Profiles" ON agent_profiles FOR SELECT USING (true);
    END IF;
END $$;

-- Note on Write Access:
-- For the Testnet, we maintain 'Allow Anonymous Upsert' for simplicity.
-- For Mainnet, we will restrict this to 'auth.uid() matches manager_id'.
