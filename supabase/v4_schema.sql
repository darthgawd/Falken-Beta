-- ==========================================
-- FALKEN V4 — MASTER SCHEMA (LEAN)
-- 10 tables. Multi-contract escrow, poker
-- betting, prediction pools, N-player matches.
-- ==========================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- ENUMS
-- ==========================================

CREATE TYPE match_status AS ENUM ('OPEN', 'ACTIVE', 'SETTLED', 'VOIDED');
CREATE TYPE match_phase AS ENUM ('COMMIT', 'BET', 'REVEAL');
CREATE TYPE escrow_type AS ENUM ('FISE', 'POKER');
CREATE TYPE bet_action AS ENUM ('CHECK', 'CALL', 'RAISE', 'FOLD', 'ALL_IN');
CREATE TYPE bet_structure AS ENUM ('NO_LIMIT', 'POT_LIMIT', 'FIXED_LIMIT');
CREATE TYPE pool_status AS ENUM ('OPEN', 'LOCKED', 'RESOLVED', 'REFUNDED');

-- ==========================================
-- 1. MATCHES
-- ==========================================

CREATE TABLE matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escrow_address TEXT NOT NULL,
    escrow_type escrow_type NOT NULL,
    on_chain_id BIGINT NOT NULL,

    -- Game config
    logic_id TEXT NOT NULL,
    stake NUMERIC NOT NULL,
    total_pot NUMERIC NOT NULL DEFAULT 0,
    max_players SMALLINT NOT NULL DEFAULT 2,
    wins_required SMALLINT NOT NULL DEFAULT 3,
    max_rounds SMALLINT NOT NULL DEFAULT 10,

    -- State
    status match_status NOT NULL DEFAULT 'OPEN',
    phase match_phase NOT NULL DEFAULT 'COMMIT',
    current_round SMALLINT NOT NULL DEFAULT 1,
    wins SMALLINT[] NOT NULL DEFAULT '{}',
    draw_counter SMALLINT NOT NULL DEFAULT 0,
    winner TEXT,

    -- Poker (NULL for FISE)
    bet_structure bet_structure,
    max_streets SMALLINT,
    current_street SMALLINT,
    current_bet NUMERIC,
    current_turn_index SMALLINT,
    raise_count SMALLINT,
    active_players SMALLINT,

    -- Deadlines
    commit_deadline TIMESTAMPTZ,
    reveal_deadline TIMESTAMPTZ,
    bet_deadline TIMESTAMPTZ,

    -- Meta
    state_description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(escrow_address, on_chain_id)
);

-- ==========================================
-- 2. MATCH PLAYERS
-- ==========================================

CREATE TABLE match_players (
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_address TEXT NOT NULL,
    player_index SMALLINT NOT NULL,
    contribution NUMERIC NOT NULL DEFAULT 0,
    folded BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (match_id, player_address)
);

-- ==========================================
-- 3. ROUNDS
-- ==========================================

CREATE TABLE rounds (
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    round_number SMALLINT NOT NULL,
    player_address TEXT NOT NULL,
    player_index SMALLINT NOT NULL,

    commit_hash TEXT,
    move TEXT,
    salt TEXT,
    revealed BOOLEAN NOT NULL DEFAULT FALSE,
    folded BOOLEAN NOT NULL DEFAULT FALSE,

    winner_index SMALLINT,

    commit_tx_hash TEXT,
    reveal_tx_hash TEXT,
    commit_timestamp TIMESTAMPTZ,
    reveal_timestamp TIMESTAMPTZ,

    reasoning TEXT,

    PRIMARY KEY (match_id, round_number, player_address)
);

-- ==========================================
-- 4. STREET BETS (POKER)
-- ==========================================

CREATE TABLE street_bets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    round_number SMALLINT NOT NULL,
    street SMALLINT NOT NULL,
    sequence SMALLINT NOT NULL,
    player_address TEXT NOT NULL,
    player_index SMALLINT NOT NULL,
    action bet_action NOT NULL,
    amount NUMERIC NOT NULL DEFAULT 0,
    tx_hash TEXT,
    reasoning TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- 5. PREDICTION POOLS
-- ==========================================

CREATE TABLE prediction_pools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_chain_id BIGINT,
    pool_address TEXT NOT NULL,
    escrow_address TEXT,
    match_id UUID REFERENCES matches(id),
    on_chain_match_id BIGINT,

    title TEXT,
    outcome_count SMALLINT NOT NULL DEFAULT 2,
    outcome_labels TEXT[] NOT NULL,
    betting_deadline TIMESTAMPTZ NOT NULL,
    min_bet NUMERIC NOT NULL DEFAULT 100000,

    status pool_status NOT NULL DEFAULT 'OPEN',
    total_pool NUMERIC NOT NULL DEFAULT 0,
    outcome_totals NUMERIC[] NOT NULL DEFAULT '{}',
    winning_outcome SMALLINT,
    rake_amount NUMERIC,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,

    UNIQUE(pool_address, pool_chain_id)
);

-- ==========================================
-- 6. SPECTATOR BETS
-- ==========================================

CREATE TABLE spectator_bets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_id UUID NOT NULL REFERENCES prediction_pools(id) ON DELETE CASCADE,
    bettor_address TEXT NOT NULL,
    outcome_index SMALLINT NOT NULL,
    amount NUMERIC NOT NULL,
    tx_hash TEXT,
    claimed BOOLEAN NOT NULL DEFAULT FALSE,
    payout NUMERIC,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(pool_id, bettor_address, outcome_index)
);

-- ==========================================
-- 7. AGENT PROFILES
-- ==========================================

CREATE TABLE agent_profiles (
    address TEXT NOT NULL,
    game_type TEXT NOT NULL DEFAULT 'global',
    nickname TEXT,
    avatar_url TEXT,
    bio TEXT,
    elo INT NOT NULL DEFAULT 1200,
    wins INT NOT NULL DEFAULT 0,
    losses INT NOT NULL DEFAULT 0,
    draws INT NOT NULL DEFAULT 0,
    total_wagered NUMERIC NOT NULL DEFAULT 0,
    total_won NUMERIC NOT NULL DEFAULT 0,
    win_streak INT NOT NULL DEFAULT 0,
    best_streak INT NOT NULL DEFAULT 0,
    last_active TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (address, game_type)
);

CREATE UNIQUE INDEX idx_agent_nickname ON agent_profiles (nickname)
    WHERE nickname IS NOT NULL AND game_type = 'global';

-- ==========================================
-- 8. SALT VAULT
-- ==========================================

CREATE TABLE salt_vault (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_address TEXT NOT NULL,
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    round_number SMALLINT NOT NULL,
    move_value TEXT NOT NULL,
    salt_value TEXT NOT NULL,
    revealed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(agent_address, match_id, round_number)
);

-- ==========================================
-- 9. SETTLEMENTS
-- ==========================================

CREATE TABLE settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id),
    player_address TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    is_rake BOOLEAN NOT NULL DEFAULT FALSE,
    tx_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- 10. SYNC STATE
-- ==========================================

CREATE TABLE sync_state (
    id TEXT PRIMARY KEY,
    escrow_address TEXT NOT NULL,
    last_processed_block BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- INDEXES
-- ==========================================

CREATE INDEX idx_matches_escrow_status ON matches (escrow_address, status);
CREATE INDEX idx_matches_status ON matches (status);
CREATE INDEX idx_matches_logic_id ON matches (logic_id);
CREATE INDEX idx_matches_created ON matches (created_at DESC);

CREATE INDEX idx_match_players_address ON match_players (player_address);

CREATE INDEX idx_rounds_match_round ON rounds (match_id, round_number);
CREATE INDEX idx_rounds_player ON rounds (player_address);

CREATE INDEX idx_street_bets_match ON street_bets (match_id, round_number, street, sequence);

CREATE INDEX idx_pools_match ON prediction_pools (match_id) WHERE match_id IS NOT NULL;
CREATE INDEX idx_pools_status ON prediction_pools (status);

CREATE INDEX idx_spectator_bets_pool ON spectator_bets (pool_id);
CREATE INDEX idx_spectator_bets_bettor ON spectator_bets (bettor_address);

CREATE INDEX idx_agent_elo ON agent_profiles (game_type, elo DESC);
CREATE INDEX idx_agent_address ON agent_profiles (address);

CREATE INDEX idx_salt_vault_lookup ON salt_vault (agent_address, match_id, round_number);

CREATE INDEX idx_settlements_match ON settlements (match_id);

-- ==========================================
-- ROW LEVEL SECURITY
-- ==========================================

ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE street_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE spectator_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE salt_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;

-- Public read
CREATE POLICY "Public read" ON matches FOR SELECT USING (true);
CREATE POLICY "Public read" ON match_players FOR SELECT USING (true);
CREATE POLICY "Public read" ON rounds FOR SELECT USING (true);
CREATE POLICY "Public read" ON street_bets FOR SELECT USING (true);
CREATE POLICY "Public read" ON prediction_pools FOR SELECT USING (true);
CREATE POLICY "Public read" ON spectator_bets FOR SELECT USING (true);
CREATE POLICY "Public read" ON agent_profiles FOR SELECT USING (true);
CREATE POLICY "Public read" ON settlements FOR SELECT USING (true);

-- Secrets: deny public
CREATE POLICY "Deny public" ON salt_vault FOR SELECT USING (false);
CREATE POLICY "Deny public" ON sync_state FOR SELECT USING (false);

-- ==========================================
-- REALTIME
-- ==========================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE matches;
ALTER PUBLICATION supabase_realtime ADD TABLE match_players;
ALTER PUBLICATION supabase_realtime ADD TABLE rounds;
ALTER PUBLICATION supabase_realtime ADD TABLE street_bets;
ALTER PUBLICATION supabase_realtime ADD TABLE prediction_pools;
ALTER PUBLICATION supabase_realtime ADD TABLE spectator_bets;
ALTER PUBLICATION supabase_realtime ADD TABLE agent_profiles;

-- ==========================================
-- RPC FUNCTIONS
-- ==========================================

CREATE OR REPLACE FUNCTION settle_match_elo(
    p_players TEXT[],
    p_winner_index INT,
    p_game_type TEXT,
    p_stake NUMERIC DEFAULT 0
) RETURNS void AS $$
DECLARE
    k INT := 32;
    n INT := array_length(p_players, 1);
    elos INT[];
    new_elos INT[];
    i INT;
    j INT;
    exp_score FLOAT;
    delta FLOAT;
    cur_elo INT;
    is_win BOOLEAN;
    is_loss BOOLEAN;
    is_draw BOOLEAN;
    payout NUMERIC;
BEGIN
    elos := ARRAY[]::INT[];
    FOR i IN 1..n LOOP
        SELECT COALESCE(elo, 1200) INTO cur_elo
        FROM agent_profiles
        WHERE address = p_players[i] AND game_type = p_game_type;
        IF cur_elo IS NULL THEN cur_elo := 1200; END IF;
        elos := array_append(elos, cur_elo);
    END LOOP;

    new_elos := elos;
    FOR i IN 1..n LOOP
        delta := 0;
        FOR j IN 1..n LOOP
            IF i != j THEN
                exp_score := 1.0 / (1.0 + POWER(10.0, (elos[j] - elos[i])::FLOAT / 400.0));
                IF p_winner_index = -1 THEN
                    delta := delta + k * (0.5 - exp_score);
                ELSIF p_winner_index = (i - 1) THEN
                    delta := delta + k * (1.0 - exp_score);
                ELSE
                    delta := delta + k * (0.0 - exp_score);
                END IF;
            END IF;
        END LOOP;
        new_elos[i] := GREATEST(0, elos[i] + ROUND(delta / (n - 1))::INT);
    END LOOP;

    FOR i IN 1..n LOOP
        is_win := (p_winner_index = (i - 1));
        is_loss := (p_winner_index >= 0 AND p_winner_index != (i - 1));
        is_draw := (p_winner_index = -1);
        payout := CASE WHEN is_win THEN p_stake * n * 0.95 ELSE 0 END;

        -- Game-specific profile
        INSERT INTO agent_profiles (address, game_type, elo, wins, losses, draws, total_wagered, total_won, win_streak, best_streak, last_active)
        VALUES (p_players[i], p_game_type, new_elos[i],
            CASE WHEN is_win THEN 1 ELSE 0 END,
            CASE WHEN is_loss THEN 1 ELSE 0 END,
            CASE WHEN is_draw THEN 1 ELSE 0 END,
            p_stake, payout,
            CASE WHEN is_win THEN 1 ELSE 0 END,
            CASE WHEN is_win THEN 1 ELSE 0 END,
            NOW())
        ON CONFLICT (address, game_type) DO UPDATE SET
            elo = new_elos[i],
            wins = agent_profiles.wins + CASE WHEN is_win THEN 1 ELSE 0 END,
            losses = agent_profiles.losses + CASE WHEN is_loss THEN 1 ELSE 0 END,
            draws = agent_profiles.draws + CASE WHEN is_draw THEN 1 ELSE 0 END,
            total_wagered = agent_profiles.total_wagered + p_stake,
            total_won = agent_profiles.total_won + payout,
            win_streak = CASE WHEN is_win THEN agent_profiles.win_streak + 1 ELSE 0 END,
            best_streak = GREATEST(agent_profiles.best_streak,
                CASE WHEN is_win THEN agent_profiles.win_streak + 1 ELSE agent_profiles.best_streak END),
            last_active = NOW();

        -- Global profile (no elo, just aggregate stats)
        INSERT INTO agent_profiles (address, game_type, wins, losses, draws, total_wagered, total_won, win_streak, best_streak, last_active)
        VALUES (p_players[i], 'global',
            CASE WHEN is_win THEN 1 ELSE 0 END,
            CASE WHEN is_loss THEN 1 ELSE 0 END,
            CASE WHEN is_draw THEN 1 ELSE 0 END,
            p_stake, payout,
            CASE WHEN is_win THEN 1 ELSE 0 END,
            CASE WHEN is_win THEN 1 ELSE 0 END,
            NOW())
        ON CONFLICT (address, game_type) DO UPDATE SET
            wins = agent_profiles.wins + CASE WHEN is_win THEN 1 ELSE 0 END,
            losses = agent_profiles.losses + CASE WHEN is_loss THEN 1 ELSE 0 END,
            draws = agent_profiles.draws + CASE WHEN is_draw THEN 1 ELSE 0 END,
            total_wagered = agent_profiles.total_wagered + p_stake,
            total_won = agent_profiles.total_won + payout,
            win_streak = CASE WHEN is_win THEN agent_profiles.win_streak + 1 ELSE 0 END,
            best_streak = GREATEST(agent_profiles.best_streak,
                CASE WHEN is_win THEN agent_profiles.win_streak + 1 ELSE agent_profiles.best_streak END),
            last_active = NOW();
    END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_settled_salts(p_match_id UUID)
RETURNS VOID AS $$
BEGIN
    DELETE FROM salt_vault WHERE match_id = p_match_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER matches_updated_at
    BEFORE UPDATE ON matches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ==========================================
-- SEED DATA
-- ==========================================

INSERT INTO sync_state (id, escrow_address, last_processed_block) VALUES
    ('fise_v4', '0x0000000000000000000000000000000000000000', 0),
    ('poker_v4', '0x0000000000000000000000000000000000000000', 0),
    ('prediction_pool', '0x0000000000000000000000000000000000000000', 0)
ON CONFLICT (id) DO NOTHING;
