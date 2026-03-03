-- ==========================================
-- Falken MASTER SCHEMA SETUP (V2)
-- Paste this into Supabase SQL Editor
-- ==========================================

-- 1. Tables
CREATE TABLE IF NOT EXISTS matches (
    match_id TEXT PRIMARY KEY, 
    player_a TEXT NOT NULL,
    player_b TEXT,
    stake_wei NUMERIC NOT NULL,
    payout_wei NUMERIC,
    game_logic TEXT NOT NULL,
    wins_a INT DEFAULT 0,
    wins_b INT DEFAULT 0,
    current_round INT DEFAULT 1,
    phase TEXT NOT NULL DEFAULT 'COMMIT',
    status TEXT NOT NULL DEFAULT 'OPEN',
    winner TEXT,
    commit_deadline TIMESTAMPTZ,
    reveal_deadline TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rounds (
    match_id TEXT REFERENCES matches(match_id) ON DELETE CASCADE,
    round_number INT,
    player_address TEXT,
    player_index INT, -- 1 for A, 2 for B
    commit_hash TEXT,
    move INT,
    salt TEXT,
    revealed BOOLEAN DEFAULT FALSE,
    winner INT, -- 0=Draw, 1=PlayerA, 2=PlayerB
    commit_tx_hash TEXT,
    reveal_tx_hash TEXT,
    commit_timestamp TIMESTAMPTZ,
    reveal_timestamp TIMESTAMPTZ,
    gas_used_commit BIGINT,
    gas_used_reveal BIGINT,
    elo_at_time INT,
    PRIMARY KEY (match_id, round_number, player_address)
);

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

CREATE TABLE IF NOT EXISTS agent_profiles (
    address TEXT PRIMARY KEY,
    manager_id UUID REFERENCES manager_profiles(id) ON DELETE SET NULL,
    nickname TEXT UNIQUE,
    elo INT DEFAULT 1200,
    wins INT DEFAULT 0,
    losses INT DEFAULT 0,
    draws INT DEFAULT 0,
    last_active TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_state (
    id TEXT PRIMARY KEY,
    last_processed_block BIGINT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_matches_player_a   ON matches (player_a);
CREATE INDEX IF NOT EXISTS idx_matches_player_b   ON matches (player_b);
CREATE INDEX IF NOT EXISTS idx_matches_status     ON matches (status);
CREATE INDEX IF NOT EXISTS idx_rounds_player      ON rounds (player_address);
CREATE INDEX IF NOT EXISTS idx_rounds_match_round ON rounds (match_id, round_number);
CREATE INDEX IF NOT EXISTS idx_agent_manager      ON agent_profiles (manager_id);
CREATE INDEX IF NOT EXISTS idx_api_manager        ON api_keys (manager_id);

-- 3. Initialization
INSERT INTO sync_state (id, last_processed_block) VALUES ('indexer_main', 0) ON CONFLICT (id) DO NOTHING;

-- 4. Atomic RPC Functions
-- ... (existing RPCs) ...

-- 5. Enable RLS
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE manager_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public Read Matches" ON matches FOR SELECT USING (true);
CREATE POLICY "Public Read Profiles" ON agent_profiles FOR SELECT USING (true);
CREATE POLICY "Public Read Rounds" ON rounds FOR SELECT USING (true);

-- 6. Enable Realtime Replication
-- Check if the publication exists, if not create it, then add tables
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE matches;
ALTER PUBLICATION supabase_realtime ADD TABLE agent_profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE rounds;
CREATE POLICY "Public Read Managers" ON manager_profiles FOR SELECT USING (true);
-- API Keys should NOT have public read policy for security

CREATE OR REPLACE FUNCTION decrement_wins_a(m_id text) RETURNS void AS $$
  UPDATE matches SET wins_a = GREATEST(0, wins_a - 1) WHERE match_id = m_id;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION decrement_wins_b(m_id text) RETURNS void AS $$
  UPDATE matches SET wins_b = GREATEST(0, wins_b - 1) WHERE match_id = m_id;
$$ LANGUAGE sql;

-- Proper Elo (K=32, 400-point scale). Updates both players atomically.
-- p_winner_index: 0=draw, 1=player_a wins, 2=player_b wins
CREATE OR REPLACE FUNCTION settle_match_elo(
  p_player_a    text,
  p_player_b    text,
  p_winner_index int
) RETURNS void AS $$
DECLARE
  elo_a      int;
  elo_b      int;
  exp_a      float;
  exp_b      float;
  actual_a   float;
  actual_b   float;
  k          int := 32;
  new_elo_a  int;
  new_elo_b  int;
BEGIN
  SELECT COALESCE(elo, 1200) INTO elo_a FROM agent_profiles WHERE address = p_player_a;
  SELECT COALESCE(elo, 1200) INTO elo_b FROM agent_profiles WHERE address = p_player_b;
  IF elo_a IS NULL THEN elo_a := 1200; END IF;
  IF elo_b IS NULL THEN elo_b := 1200; END IF;

  exp_a := 1.0 / (1.0 + POWER(10.0, (elo_b - elo_a)::float / 400.0));
  exp_b := 1.0 - exp_a;

  IF p_winner_index = 0 THEN
    actual_a := 0.5; actual_b := 0.5;
  ELSIF p_winner_index = 1 THEN
    actual_a := 1.0; actual_b := 0.0;
  ELSE
    actual_a := 0.0; actual_b := 1.0;
  END IF;

  new_elo_a := GREATEST(0, elo_a + ROUND(k * (actual_a - exp_a))::int);
  new_elo_b := GREATEST(0, elo_b + ROUND(k * (actual_b - exp_b))::int);

  INSERT INTO agent_profiles (address, elo, wins, losses, draws, last_active)
  VALUES (p_player_a, new_elo_a,
    CASE WHEN p_winner_index = 1 THEN 1 ELSE 0 END,
    CASE WHEN p_winner_index = 2 THEN 1 ELSE 0 END,
    CASE WHEN p_winner_index = 0 THEN 1 ELSE 0 END, NOW())
  ON CONFLICT (address) DO UPDATE SET
    elo    = new_elo_a,
    wins   = agent_profiles.wins   + CASE WHEN p_winner_index = 1 THEN 1 ELSE 0 END,
    losses = agent_profiles.losses + CASE WHEN p_winner_index = 2 THEN 1 ELSE 0 END,
    draws  = agent_profiles.draws  + CASE WHEN p_winner_index = 0 THEN 1 ELSE 0 END,
    last_active = NOW();

  INSERT INTO agent_profiles (address, elo, wins, losses, draws, last_active)
  VALUES (p_player_b, new_elo_b,
    CASE WHEN p_winner_index = 2 THEN 1 ELSE 0 END,
    CASE WHEN p_winner_index = 1 THEN 1 ELSE 0 END,
    CASE WHEN p_winner_index = 0 THEN 1 ELSE 0 END, NOW())
  ON CONFLICT (address) DO UPDATE SET
    elo    = new_elo_b,
    wins   = agent_profiles.wins   + CASE WHEN p_winner_index = 2 THEN 1 ELSE 0 END,
    losses = agent_profiles.losses + CASE WHEN p_winner_index = 1 THEN 1 ELSE 0 END,
    draws  = agent_profiles.draws  + CASE WHEN p_winner_index = 0 THEN 1 ELSE 0 END,
    last_active = NOW();
END;
$$ LANGUAGE plpgsql;

-- 4. Enable RLS
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public Read Matches" ON matches FOR SELECT USING (true);
CREATE POLICY "Public Read Profiles" ON agent_profiles FOR SELECT USING (true);
CREATE POLICY "Public Read Rounds" ON rounds FOR SELECT USING (true);

-- 6. Enable Realtime Replication
-- Check if the publication exists, if not create it, then add tables
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE matches;
ALTER PUBLICATION supabase_realtime ADD TABLE agent_profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE rounds;
