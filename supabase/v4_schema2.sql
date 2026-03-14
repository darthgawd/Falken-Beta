-- ==========================================
-- FALKEN PROTOCOL: V4 PROPOSED SCHEMA (V2.1 - CORRECTED)
-- Focus: Multi-street support, correct indexing, and improved RLS.
-- ==========================================

-- 1. SYNC STATE
CREATE TABLE IF NOT EXISTS sync_state (
    id TEXT PRIMARY KEY,
    last_processed_block BIGINT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. LOGIC REGISTRY (Aliases)
CREATE TABLE IF NOT EXISTS logic_aliases (
    logic_id TEXT PRIMARY KEY,
    alias_name TEXT UNIQUE,
    betting_enabled BOOLEAN DEFAULT FALSE,
    max_streets INTEGER DEFAULT 1, -- Default changed to 1
    is_active BOOLEAN DEFAULT TRUE,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. AGENT PROFILES
CREATE TABLE IF NOT EXISTS agent_profiles (
    address TEXT PRIMARY KEY,
    nickname TEXT,
    elo INTEGER DEFAULT 1200,
    matches_played INTEGER DEFAULT 0,
    matches_won INTEGER DEFAULT 0,
    total_payout_wei NUMERIC DEFAULT 0, -- Changed to NUMERIC for safety
    last_active TIMESTAMPTZ DEFAULT NOW()
);

-- 4. MATCHES
CREATE TABLE IF NOT EXISTS matches (
    match_id TEXT PRIMARY KEY, -- Format: {escrow_address}-{on_chain_id}
    escrow_address TEXT, -- Extracted for easier filtering
    players TEXT[] DEFAULT '{}',
    stake_wei BIGINT NOT NULL,
    total_pot BIGINT DEFAULT 0,
    game_logic TEXT NOT NULL,
    wins INTEGER[] DEFAULT '{}',
    current_round INTEGER DEFAULT 1,
    current_street INTEGER DEFAULT 0,
    draw_counter INTEGER DEFAULT 0,
    wins_required INTEGER DEFAULT 3,
    max_rounds INTEGER DEFAULT 5,
    status TEXT DEFAULT 'OPEN', -- OPEN, ACTIVE, SETTLED, VOIDED
    phase TEXT DEFAULT 'COMMIT', -- COMMIT, BET, REVEAL
    winner TEXT, -- address
    state_description TEXT,
    settle_tx_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. ROUNDS (The Intelligence Layer)
CREATE TABLE IF NOT EXISTS rounds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id TEXT REFERENCES matches(match_id) ON DELETE CASCADE,
    round_number INTEGER NOT NULL,
    street INTEGER DEFAULT 0, -- V4 Multi-street support
    player_address TEXT NOT NULL,
    player_index INTEGER,
    move_bytes32 TEXT, -- V4 standard
    move_decoded TEXT, -- Human readable version (e.g. "Discard 3")
    salt TEXT,
    revealed BOOLEAN DEFAULT FALSE,
    winner INTEGER, -- 0=Draw, 1=P1, 2=P2 (DB Convention)
    commit_tx_hash TEXT,
    reveal_tx_hash TEXT,
    reasoning TEXT, -- AI Strategic Monologue
    taunt TEXT, -- AI Trash Talk
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(match_id, round_number, street, player_address)
);

-- 6. MATCH ACTIONS (Betting History)
CREATE TABLE IF NOT EXISTS match_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id TEXT REFERENCES matches(match_id) ON DELETE CASCADE,
    round_number INTEGER NOT NULL,
    street INTEGER DEFAULT 0, -- V4 Multi-street support
    player_address TEXT NOT NULL,
    action_type TEXT NOT NULL, -- RAISE, CALL, CHECK, FOLD
    amount BIGINT DEFAULT 0,
    tx_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. PREDICTION POOLS
CREATE TABLE IF NOT EXISTS prediction_pools (
    pool_id TEXT PRIMARY KEY, -- Format: {pool_contract_address}-{on_chain_id}
    escrow_address TEXT, -- Linked match escrow
    match_id TEXT, -- Linked match ID (internal format)
    title TEXT NOT NULL,
    outcome_labels TEXT[] NOT NULL,
    outcome_totals BIGINT[] DEFAULT '{}',
    total_pool BIGINT DEFAULT 0,
    betting_deadline TIMESTAMPTZ NOT NULL,
    resolved BOOLEAN DEFAULT FALSE,
    winning_outcome INTEGER,
    is_draw BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. SPECTATOR BETS
CREATE TABLE IF NOT EXISTS spectator_bets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pool_id TEXT REFERENCES prediction_pools(pool_id) ON DELETE CASCADE,
    bettor_address TEXT NOT NULL,
    outcome_index INTEGER NOT NULL,
    amount BIGINT NOT NULL,
    tx_hash TEXT,
    claimed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_escrow ON matches(escrow_address);
CREATE INDEX IF NOT EXISTS idx_rounds_match_street ON rounds(match_id, round_number, street);
CREATE INDEX IF NOT EXISTS idx_bets_pool ON spectator_bets(pool_id);
CREATE INDEX IF NOT EXISTS idx_actions_match_street ON match_actions(match_id, round_number, street);

-- Enable Realtime & RLS
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE spectator_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE logic_aliases ENABLE ROW LEVEL SECURITY;

-- Public Read Policies
CREATE POLICY "Public Read Matches" ON matches FOR SELECT USING (true);
CREATE POLICY "Public Read Rounds" ON rounds FOR SELECT USING (true);
CREATE POLICY "Public Read Actions" ON match_actions FOR SELECT USING (true);
CREATE POLICY "Public Read Pools" ON prediction_pools FOR SELECT USING (true);
CREATE POLICY "Public Read Bets" ON spectator_bets FOR SELECT USING (true);
CREATE POLICY "Public Read Agents" ON agent_profiles FOR SELECT USING (true);
CREATE POLICY "Public Read Aliases" ON logic_aliases FOR SELECT USING (true);

-- Realtime Publication
DROP PUBLICATION IF EXISTS supabase_realtime;
CREATE PUBLICATION supabase_realtime FOR TABLE matches, rounds, match_actions, prediction_pools, spectator_bets, agent_profiles;
