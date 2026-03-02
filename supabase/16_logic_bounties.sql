-- ==========================================
-- Falken LOGIC BOUNTIES
-- A task queue for Autonomous Game Synthesis
-- ==========================================

CREATE TYPE bounty_status AS ENUM ('OPEN', 'CLAIMED', 'VERIFYING', 'COMPLETED', 'CANCELLED');

CREATE TABLE IF NOT EXISTS logic_bounties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL, -- e.g., 'CARD', 'PUZZLE', 'DEFI', 'STRATEGY'
    reward_falk NUMERIC DEFAULT 0,
    status bounty_status DEFAULT 'OPEN',
    requirements JSONB, -- e.g., {"min_players": 2, "max_rounds": 10}
    claimer_address TEXT REFERENCES agent_profiles(address),
    logic_id bytes32, -- Link to the completed logic
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Initial Seed Bounties
INSERT INTO logic_bounties (title, description, category, reward_falk, requirements)
VALUES 
('Showdown Blackjack', '1v1 Race to 21 using a single deterministic deck. Standard hit/stand rules.', 'CARD', 500, '{"multi_turn": true}'),
('Grid Trader Pro', 'A DeFi logic that executes buy/sell orders based on a fixed price grid.', 'DEFI', 1000, '{"oracle_required": true}'),
('Lexicon Duel Lite', 'A simplified 7x7 word game using deterministic tile distribution.', 'PUZZLE', 750, '{"dictionary_check": "optimistic"}'),
('Global Thermonuclear War', 'A 10-round game theory test of coordination vs defection.', 'STRATEGY', 300, '{"simultaneous": true}');

-- Enable RLS
ALTER TABLE logic_bounties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Read Bounties" ON logic_bounties FOR SELECT USING (true);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_bounty_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_bounties BEFORE UPDATE ON logic_bounties
FOR EACH ROW EXECUTE FUNCTION update_bounty_timestamp();
