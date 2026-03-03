-- ==========================================
-- Falken: Logic Alias System
-- Enables automated bot discovery of latest games
-- ==========================================

CREATE TABLE IF NOT EXISTS logic_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alias_name TEXT UNIQUE NOT NULL,
    logic_id TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable public read for bots/dashboard
ALTER TABLE logic_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read Aliases" ON logic_aliases;
CREATE POLICY "Public Read Aliases" ON logic_aliases FOR SELECT USING (true);

-- Indices for fast lookup
CREATE INDEX IF NOT EXISTS idx_logic_aliases_name ON logic_aliases(alias_name);

-- Seed initial aliases based on current production IDs
INSERT INTO logic_aliases (alias_name, logic_id)
VALUES 
('ROCK_PAPER_SCISSORS', '0xf2f80f1811f9e2c534946f0e8ddbdbd5c1e23b6e48772afe3bccdb9f2e1cfdf3'),
('POKER_BLITZ', '0x4173a4e2e54727578fd50a3f1e721827c4c97c3a2824ca469c0ec730d4264b43')
ON CONFLICT (alias_name) DO UPDATE SET logic_id = EXCLUDED.logic_id;

NOTIFY pgrst, 'reload schema';
