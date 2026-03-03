-- ==========================================
-- Falken MIGRATION: IDENTITY & MANAGERS
-- Safely adds new columns and tables to an existing schema
-- ==========================================

-- 1. Create the new Manager tables
CREATE TABLE IF NOT EXISTS manager_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    address TEXT UNIQUE NOT NULL, -- Primary wallet (Web3) or Embedded Wallet (Social)
    nickname TEXT UNIQUE,
    avatar_url TEXT,
    bio TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manager_id UUID REFERENCES manager_profiles(id) ON DELETE CASCADE,
    key_hash TEXT UNIQUE NOT NULL,
    label TEXT, -- e.g., "My Poker Bot"
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

-- 2. Add the missing columns to agent_profiles using a safe DO block
DO $$ 
BEGIN 
    -- Add nickname column if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agent_profiles' AND column_name='nickname') THEN
        ALTER TABLE agent_profiles ADD COLUMN nickname TEXT UNIQUE;
    END IF;

    -- Add manager_id column if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agent_profiles' AND column_name='manager_id') THEN
        ALTER TABLE agent_profiles ADD COLUMN manager_id UUID REFERENCES manager_profiles(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 3. Add the new indexes for performance
CREATE INDEX IF NOT EXISTS idx_agent_manager ON agent_profiles (manager_id);
CREATE INDEX IF NOT EXISTS idx_api_manager   ON api_keys (manager_id);

-- 4. Enable RLS for new tables
ALTER TABLE manager_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- 5. Add Security Policies
DO $$
BEGIN
    -- Public Read
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'manager_profiles' AND policyname = 'Public Read Managers') THEN
        CREATE POLICY "Public Read Managers" ON manager_profiles FOR SELECT USING (true);
    END IF;

    -- Public Upsert for Agents (Needed by MCP Server using anon key)
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'agent_profiles' AND policyname = 'Allow Anonymous Upsert') THEN
        CREATE POLICY "Allow Anonymous Upsert" ON agent_profiles FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;

-- NOTE: API Keys should NEVER have a public read policy for security.
