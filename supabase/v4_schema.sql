-- ==========================================
-- FALKEN V4 — MASTER SCHEMA
-- Multi-contract escrow support, poker betting,
-- prediction pools, N-player matches
-- ==========================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- ENUMS
-- ==========================================

CREATE TYPE match_status AS ENUM ('OPEN', 'ACTIVE', 'SETTLED', 'VOIDED');
CREATE TYPE match_phase AS ENUM ('COMMIT', 'BET', 'REVEAL', 'PLAY', 'SETUP');
CREATE TYPE escrow_type AS ENUM ('FISE', 'POKER', 'TURN_BASED', 'DEALER');
CREATE TYPE bet_action AS ENUM ('CHECK', 'CALL', 'RAISE', 'FOLD', 'ALL_IN');
CREATE TYPE bet_structure AS ENUM ('NO_LIMIT', 'POT_LIMIT', 'FIXED_LIMIT');
CREATE TYPE pool_status AS ENUM ('OPEN', 'LOCKED', 'RESOLVED', 'REFUNDED');
CREATE TYPE submission_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE bounty_status AS ENUM ('OPEN', 'CLAIMED', 'VERIFYING', 'COMPLETED', 'CANCELLED');

-- ==========================================
-- CORE: MATCHES
-- ==========================================
-- One row per match across ALL escrow contracts.
-- escrow_address distinguishes which contract owns it.
-- on_chain_id is the uint256 matchId from that contract.

CREATE TABLE matches (
    -- Composite identity
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escrow_address TEXT NOT NULL,            -- contract address (e.g. FiseEscrowV4, PokerEngine)
    escrow_type escrow_type NOT NULL,        -- which contract type
    on_chain_id BIGINT NOT NULL,             -- matchCounter from contract

    -- Game config
    logic_id TEXT NOT NULL,                  -- bytes32 keccak256(ipfsCid)
    game_name TEXT,                          -- human-readable (from logic_aliases)
    stake NUMERIC NOT NULL,                  -- USDC per player (6 decimals raw)
    total_pot NUMERIC NOT NULL DEFAULT 0,    -- stake * players + raises
    max_players SMALLINT NOT NULL DEFAULT 2,
    wins_required SMALLINT NOT NULL DEFAULT 3,
    max_rounds SMALLINT NOT NULL DEFAULT 10,

    -- Match state
    status match_status NOT NULL DEFAULT 'OPEN',
    phase match_phase NOT NULL DEFAULT 'COMMIT',
    current_round SMALLINT NOT NULL DEFAULT 1,
    wins SMALLINT[] NOT NULL DEFAULT '{}',   -- per-player win count
    draw_counter SMALLINT NOT NULL DEFAULT 0,
    winner TEXT,                             -- primary winner address

    -- Poker-specific (NULL for non-poker)
    bet_structure bet_structure,
    max_streets SMALLINT,                    -- 1=5-Card Draw, 4=Hold'em, 5=Stud
    current_street SMALLINT,
    current_bet NUMERIC,                     -- amount needed to call
    current_turn_index SMALLINT,             -- whose turn to bet (player_index)
    raise_count SMALLINT,                    -- raises this street (max 2)
    active_players SMALLINT,                 -- players who haven't folded

    -- Turn-based specific (NULL for non-turn-based)
    move_count INT,                          -- total moves made
    board_hash TEXT,                          -- current board state hash

    -- Deadlines
    commit_deadline TIMESTAMPTZ,
    reveal_deadline TIMESTAMPTZ,
    bet_deadline TIMESTAMPTZ,
    turn_deadline TIMESTAMPTZ,               -- turn-based games

    -- Transaction hashes (lifecycle events)
    create_tx_hash TEXT,
    settle_tx_hash TEXT,

    -- Metadata
    state_description TEXT,                  -- human-readable state for UI
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Unique: one match per contract per on-chain ID
    UNIQUE(escrow_address, on_chain_id)
);

-- ==========================================
-- CORE: MATCH PLAYERS
-- ==========================================
-- Normalized player list. Replaces player_a/player_b columns.
-- Supports 2-6 players per match.

CREATE TABLE match_players (
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_address TEXT NOT NULL,
    player_index SMALLINT NOT NULL,          -- 0-indexed position
    contribution NUMERIC NOT NULL DEFAULT 0, -- total USDC in (stake + raises)
    folded BOOLEAN NOT NULL DEFAULT FALSE,   -- poker: has this player folded
    bankroll NUMERIC,                        -- poker: remaining chips (NULL for non-poker)
    join_tx_hash TEXT,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (match_id, player_address)
);

-- ==========================================
-- CORE: ROUNDS
-- ==========================================
-- One row per player per round. Tracks commit/reveal cycle.
-- bytes32 moves stored as TEXT (hex-encoded).

CREATE TABLE rounds (
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    round_number SMALLINT NOT NULL,
    player_address TEXT NOT NULL,
    player_index SMALLINT NOT NULL,

    -- Commit/Reveal
    commit_hash TEXT,                        -- bytes32 keccak256(move, salt)
    move TEXT,                               -- bytes32 hex (supports complex moves)
    salt TEXT,                               -- bytes32 hex
    revealed BOOLEAN NOT NULL DEFAULT FALSE,
    folded BOOLEAN NOT NULL DEFAULT FALSE,   -- player folded this round (skips commit/reveal)

    -- Resolution (set once per round, same for all players in that round)
    winner_index SMALLINT,                   -- which player_index won (NULL = not resolved, -1 = draw)

    -- Transaction tracking
    commit_tx_hash TEXT,
    reveal_tx_hash TEXT,
    commit_timestamp TIMESTAMPTZ,
    reveal_timestamp TIMESTAMPTZ,
    gas_used_commit BIGINT,
    gas_used_reveal BIGINT,

    -- AI dataset
    reasoning TEXT,                          -- LLM reasoning for commit move
    bet_reasoning TEXT,                      -- LLM reasoning for bet action (poker)
    elo_at_time INT,

    PRIMARY KEY (match_id, round_number, player_address)
);

-- ==========================================
-- POKER: STREET BETS
-- ==========================================
-- Tracks every bet action in poker matches.
-- One row per action (check, call, raise, fold).
-- Ordered by sequence within a street.

CREATE TABLE street_bets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    round_number SMALLINT NOT NULL,
    street SMALLINT NOT NULL,                -- 0=pre, 1=flop, 2=turn, 3=river
    sequence SMALLINT NOT NULL,              -- order of actions within this street
    player_address TEXT NOT NULL,
    player_index SMALLINT NOT NULL,
    action bet_action NOT NULL,
    amount NUMERIC NOT NULL DEFAULT 0,       -- USDC amount (0 for check/fold)
    pot_after NUMERIC,                       -- pot size after this action
    tx_hash TEXT,
    reasoning TEXT,                          -- LLM reasoning for this bet decision
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- POKER: SIDE POTS
-- ==========================================
-- Tracks side pots for multi-player all-in scenarios.

CREATE TABLE side_pots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    round_number SMALLINT NOT NULL,
    pot_index SMALLINT NOT NULL,             -- 0=main pot, 1+=side pots
    amount NUMERIC NOT NULL,
    eligible_players TEXT[] NOT NULL,         -- addresses eligible to win this pot
    winner TEXT,                             -- resolved winner
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(match_id, round_number, pot_index)
);

-- ==========================================
-- TURN-BASED: MOVES
-- ==========================================
-- Sequential moves for turn-based games (chess, checkers, etc).
-- Stores move history that would be too expensive on-chain.

CREATE TABLE turn_moves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    round_number SMALLINT NOT NULL,          -- which round of the match
    move_number INT NOT NULL,                -- sequential within this round
    player_address TEXT NOT NULL,
    player_index SMALLINT NOT NULL,
    move TEXT NOT NULL,                       -- bytes32 hex
    board_hash TEXT,                          -- keccak256 of board state after move
    tx_hash TEXT,
    reasoning TEXT,                           -- LLM reasoning for this move
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(match_id, round_number, move_number)
);

-- ==========================================
-- PREDICTION POOLS (SPECTATOR BETTING)
-- ==========================================
-- Parimutuel pools. Can be tied to a match or standalone
-- (e.g. "Will Joshua win 5 in a row?").

CREATE TABLE prediction_pools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_chain_id BIGINT,                    -- on-chain poolId from PredictionPool contract
    pool_address TEXT NOT NULL,              -- PredictionPool contract address

    -- Match link (NULL for standalone/meta predictions)
    escrow_address TEXT,                     -- which escrow the match is on
    match_id UUID REFERENCES matches(id),   -- FK to our matches table (NULL for meta pools)
    on_chain_match_id BIGINT,               -- on-chain matchId (NULL for meta pools)

    -- Pool config
    title TEXT,                              -- "Joshua vs David - Poker Blitz" or "Will Joshua win 5 in a row?"
    outcome_count SMALLINT NOT NULL DEFAULT 2,
    outcome_labels TEXT[] NOT NULL,          -- ['Joshua wins', 'David wins'] or ['Yes', 'No']
    betting_deadline TIMESTAMPTZ NOT NULL,
    min_bet NUMERIC NOT NULL DEFAULT 100000, -- 0.10 USDC

    -- Pool state
    status pool_status NOT NULL DEFAULT 'OPEN',
    total_pool NUMERIC NOT NULL DEFAULT 0,
    outcome_totals NUMERIC[] NOT NULL DEFAULT '{}',
    winning_outcome SMALLINT,                -- NULL until resolved
    rake_amount NUMERIC,                     -- 5% of pool on resolution
    create_tx_hash TEXT,
    resolve_tx_hash TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,

    UNIQUE(pool_address, pool_chain_id)
);

-- ==========================================
-- SPECTATOR BETS
-- ==========================================

CREATE TABLE spectator_bets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_id UUID NOT NULL REFERENCES prediction_pools(id) ON DELETE CASCADE,
    bettor_address TEXT NOT NULL,
    outcome_index SMALLINT NOT NULL,         -- which outcome they bet on
    amount NUMERIC NOT NULL,                 -- USDC amount
    bet_tx_hash TEXT,                        -- transaction that placed the bet
    claimed BOOLEAN NOT NULL DEFAULT FALSE,  -- has winner claimed payout
    claim_tx_hash TEXT,                      -- transaction that claimed winnings
    payout NUMERIC,                          -- calculated on resolution
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One bet per bettor per outcome per pool
    UNIQUE(pool_id, bettor_address, outcome_index)
);

-- ==========================================
-- AGENT PROFILES
-- ==========================================
-- Per-game Elo and stats. An agent can have different ratings
-- per game type (poker elo != RPS elo).

CREATE TABLE agent_profiles (
    address TEXT NOT NULL,
    game_type TEXT NOT NULL DEFAULT 'global', -- 'global', 'rps', 'poker', 'liars_dice', etc.
    nickname TEXT,
    avatar_url TEXT,
    bio TEXT,
    elo INT NOT NULL DEFAULT 1200,
    wins INT NOT NULL DEFAULT 0,
    losses INT NOT NULL DEFAULT 0,
    draws INT NOT NULL DEFAULT 0,
    total_wagered NUMERIC NOT NULL DEFAULT 0,    -- lifetime USDC wagered
    total_won NUMERIC NOT NULL DEFAULT 0,        -- lifetime USDC won
    win_streak INT NOT NULL DEFAULT 0,           -- current consecutive wins
    best_streak INT NOT NULL DEFAULT 0,          -- all-time best win streak
    last_active TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (address, game_type)
);

-- Global nickname uniqueness (only one nickname per address across game types)
CREATE UNIQUE INDEX idx_agent_nickname ON agent_profiles (nickname) WHERE nickname IS NOT NULL AND game_type = 'global';

-- ==========================================
-- MANAGER PROFILES (HUMAN OWNERS)
-- ==========================================

CREATE TABLE manager_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    address TEXT UNIQUE NOT NULL,
    nickname TEXT UNIQUE,
    avatar_url TEXT,
    bio TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- API KEYS
-- ==========================================

CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manager_id UUID NOT NULL REFERENCES manager_profiles(id) ON DELETE CASCADE,
    key_hash TEXT UNIQUE NOT NULL,            -- SHA256(api_key)
    label TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

-- ==========================================
-- HOSTED AGENTS (BOT FACTORY)
-- ==========================================

CREATE TABLE hosted_agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manager_id UUID REFERENCES manager_profiles(id) ON DELETE CASCADE,
    agent_address TEXT NOT NULL UNIQUE,
    encrypted_key TEXT NOT NULL,              -- encrypted private key (service_role only)
    nickname TEXT NOT NULL,
    archetype TEXT NOT NULL,                  -- AGGRESSIVE, STRATEGIST, RANDOM, etc.
    llm_tier TEXT NOT NULL,                   -- GPT-4O-MINI, CLAUDE-SONNET, etc.
    status TEXT NOT NULL DEFAULT 'INACTIVE',  -- INACTIVE, ACTIVE, PAUSED
    total_matches INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- AGENT DIRECTIVES (MANAGER → BOT COMMANDS)
-- ==========================================
-- Allows managers to send runtime commands to their bots.

CREATE TABLE agent_directives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_address TEXT NOT NULL,
    manager_address TEXT NOT NULL,
    command TEXT NOT NULL,                    -- FOLD, STAY, AGGRESSIVE, PAUSE, etc.
    payload JSONB,                           -- optional structured data
    status TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING, EXECUTED, EXPIRED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    executed_at TIMESTAMPTZ
);

-- ==========================================
-- SALT VAULT (HOSTED AGENT SECRETS)
-- ==========================================
-- Stores commit salts for hosted agents. Service_role only.

CREATE TABLE salt_vault (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_address TEXT NOT NULL,
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    round_number SMALLINT NOT NULL,
    move_value TEXT NOT NULL,                 -- bytes32 hex (supports complex moves)
    salt_value TEXT NOT NULL,
    revealed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(agent_address, match_id, round_number)
);

-- ==========================================
-- SOFT MOVES (GASLESS MODE)
-- ==========================================

CREATE TABLE soft_moves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    round_number SMALLINT NOT NULL,
    player_address TEXT NOT NULL,
    move_value TEXT NOT NULL,                 -- bytes32 hex
    salt TEXT NOT NULL,
    signature TEXT NOT NULL,                  -- EIP-712 signature
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(match_id, round_number, player_address)
);

-- ==========================================
-- LOGIC REGISTRY (GAME CATALOG)
-- ==========================================

CREATE TABLE logic_registry (
    logic_id TEXT PRIMARY KEY,               -- bytes32 keccak256(ipfsCid)
    ipfs_cid TEXT NOT NULL,
    game_name TEXT NOT NULL,
    escrow_type escrow_type NOT NULL,        -- which contract type this game runs on
    description TEXT,
    developer_address TEXT,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    betting_enabled BOOLEAN NOT NULL DEFAULT FALSE,  -- poker flag
    max_streets SMALLINT,                    -- poker: number of betting streets
    default_max_rounds SMALLINT,             -- suggested max rounds for this game
    default_wins_required SMALLINT,          -- suggested wins required
    total_volume NUMERIC NOT NULL DEFAULT 0, -- lifetime USDC
    total_matches INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- LOGIC ALIASES (HUMAN-READABLE NAMES)
-- ==========================================

CREATE TABLE logic_aliases (
    logic_id TEXT PRIMARY KEY REFERENCES logic_registry(logic_id),
    alias_name TEXT UNIQUE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- LOGIC SUBMISSIONS (DEVELOPER GAME PIPELINE)
-- ==========================================

CREATE TABLE developer_profiles (
    address TEXT PRIMARY KEY,
    nickname TEXT,
    bio TEXT,
    total_games_submitted INT NOT NULL DEFAULT 0,
    total_games_approved INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active TIMESTAMPTZ
);

CREATE TABLE logic_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    developer_address TEXT NOT NULL REFERENCES developer_profiles(address),
    ipfs_cid TEXT UNIQUE NOT NULL,
    game_name TEXT NOT NULL,
    escrow_type escrow_type NOT NULL,
    description TEXT,
    code_snapshot TEXT,                       -- JS source at time of submission
    status submission_status NOT NULL DEFAULT 'PENDING',
    admin_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- LOGIC BOUNTIES
-- ==========================================

CREATE TABLE logic_bounties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,                  -- CARD, PUZZLE, STRATEGY, etc.
    reward_description TEXT,                 -- "500 FALK tokens" or "$50 USDC"
    status bounty_status NOT NULL DEFAULT 'OPEN',
    requirements JSONB,
    claimer_address TEXT,
    submission_id UUID REFERENCES logic_submissions(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- SETTLEMENTS (PAYOUT LOG)
-- ==========================================
-- Immutable log of every settlement for auditing.

CREATE TABLE settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id),
    player_address TEXT NOT NULL,
    amount NUMERIC NOT NULL,                 -- USDC paid out
    is_rake BOOLEAN NOT NULL DEFAULT FALSE,  -- true = treasury payment
    is_refund BOOLEAN NOT NULL DEFAULT FALSE, -- true = void/timeout refund
    tx_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- MATCH EVENTS (ON-CHAIN TX LOG)
-- ==========================================
-- Every on-chain transaction related to a match.
-- Audit trail + debugging tool for the pipeline.

CREATE TABLE match_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,                -- MatchCreated, PlayerJoined, MoveCommitted, MoveRevealed,
                                             -- RoundResolved, BetPlaced, PlayerFolded, MatchSettled,
                                             -- MatchVoided, TimeoutClaimed, MatchActivated
    player_address TEXT,                     -- who triggered (NULL for system events)
    tx_hash TEXT NOT NULL,
    block_number BIGINT NOT NULL,
    log_index INT,
    event_data JSONB,                        -- raw decoded event args
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- SYNC STATE (INDEXER CURSORS)
-- ==========================================
-- One row per contract being indexed.

CREATE TABLE sync_state (
    id TEXT PRIMARY KEY,                     -- 'fise_0x8e80...', 'poker_0xABC...'
    escrow_address TEXT NOT NULL,
    escrow_type escrow_type,
    last_processed_block BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- INDEXES
-- ==========================================

-- Matches
CREATE INDEX idx_matches_escrow ON matches (escrow_address);
CREATE INDEX idx_matches_status ON matches (status);
CREATE INDEX idx_matches_escrow_status ON matches (escrow_address, status);
CREATE INDEX idx_matches_escrow_type_status ON matches (escrow_type, status);
CREATE INDEX idx_matches_logic_id ON matches (logic_id);
CREATE INDEX idx_matches_winner ON matches (winner) WHERE winner IS NOT NULL;
CREATE INDEX idx_matches_created ON matches (created_at DESC);

-- Match Players
CREATE INDEX idx_match_players_address ON match_players (player_address);
CREATE INDEX idx_match_players_match ON match_players (match_id);

-- Rounds
CREATE INDEX idx_rounds_match_round ON rounds (match_id, round_number);
CREATE INDEX idx_rounds_player ON rounds (player_address);
CREATE INDEX idx_rounds_unresolved ON rounds (match_id) WHERE winner_index IS NULL AND revealed = TRUE;

-- Street Bets
CREATE INDEX idx_street_bets_match ON street_bets (match_id, round_number, street);
CREATE INDEX idx_street_bets_player ON street_bets (player_address);
CREATE INDEX idx_street_bets_sequence ON street_bets (match_id, round_number, street, sequence);

-- Turn Moves
CREATE INDEX idx_turn_moves_match ON turn_moves (match_id, round_number);

-- Prediction Pools
CREATE INDEX idx_pools_match ON prediction_pools (match_id) WHERE match_id IS NOT NULL;
CREATE INDEX idx_pools_status ON prediction_pools (status);

-- Spectator Bets
CREATE INDEX idx_spectator_bets_pool ON spectator_bets (pool_id);
CREATE INDEX idx_spectator_bets_bettor ON spectator_bets (bettor_address);
CREATE INDEX idx_spectator_bets_unclaimed ON spectator_bets (pool_id) WHERE claimed = FALSE AND payout > 0;

-- Salt Vault
CREATE INDEX idx_salt_vault_lookup ON salt_vault (agent_address, match_id, round_number);

-- Settlements
CREATE INDEX idx_settlements_match ON settlements (match_id);
CREATE INDEX idx_settlements_player ON settlements (player_address);

-- Match Events
CREATE INDEX idx_match_events_match ON match_events (match_id);
CREATE INDEX idx_match_events_type ON match_events (event_type);
CREATE INDEX idx_match_events_tx ON match_events (tx_hash);
CREATE INDEX idx_match_events_block ON match_events (block_number);

-- Agent Profiles
CREATE INDEX idx_agent_elo ON agent_profiles (game_type, elo DESC);
CREATE INDEX idx_agent_address ON agent_profiles (address);
CREATE INDEX idx_agent_streak ON agent_profiles (game_type, win_streak DESC);

-- Agent Directives
CREATE INDEX idx_directives_agent ON agent_directives (agent_address, status);

-- Logic Submissions
CREATE INDEX idx_submissions_status ON logic_submissions (status);
CREATE INDEX idx_submissions_developer ON logic_submissions (developer_address);

-- ==========================================
-- ROW LEVEL SECURITY
-- ==========================================

ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE street_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE side_pots ENABLE ROW LEVEL SECURITY;
ALTER TABLE turn_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE spectator_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE manager_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_directives ENABLE ROW LEVEL SECURITY;
ALTER TABLE salt_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE soft_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE logic_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE logic_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE logic_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE logic_bounties ENABLE ROW LEVEL SECURITY;
ALTER TABLE developer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;

-- Public read policies (game data is public)
CREATE POLICY "Public read" ON matches FOR SELECT USING (true);
CREATE POLICY "Public read" ON match_players FOR SELECT USING (true);
CREATE POLICY "Public read" ON rounds FOR SELECT USING (true);
CREATE POLICY "Public read" ON street_bets FOR SELECT USING (true);
CREATE POLICY "Public read" ON side_pots FOR SELECT USING (true);
CREATE POLICY "Public read" ON turn_moves FOR SELECT USING (true);
CREATE POLICY "Public read" ON prediction_pools FOR SELECT USING (true);
CREATE POLICY "Public read" ON spectator_bets FOR SELECT USING (true);
CREATE POLICY "Public read" ON agent_profiles FOR SELECT USING (true);
CREATE POLICY "Public read" ON manager_profiles FOR SELECT USING (true);
CREATE POLICY "Public read" ON logic_registry FOR SELECT USING (true);
CREATE POLICY "Public read" ON logic_aliases FOR SELECT USING (true);
CREATE POLICY "Public read" ON logic_submissions FOR SELECT USING (true);
CREATE POLICY "Public read" ON logic_bounties FOR SELECT USING (true);
CREATE POLICY "Public read" ON developer_profiles FOR SELECT USING (true);
CREATE POLICY "Public read" ON settlements FOR SELECT USING (true);
CREATE POLICY "Public read" ON match_events FOR SELECT USING (true);
CREATE POLICY "Public read" ON agent_directives FOR SELECT USING (true);

-- Soft moves: public read, anon insert (signature verified in VM)
CREATE POLICY "Public read" ON soft_moves FOR SELECT USING (true);
CREATE POLICY "Anon insert" ON soft_moves FOR INSERT TO anon, authenticated WITH CHECK (true);

-- DENY public access to secrets
CREATE POLICY "Deny public" ON salt_vault FOR SELECT USING (false);
CREATE POLICY "Deny public" ON hosted_agents FOR SELECT USING (false);
CREATE POLICY "Deny public" ON api_keys FOR SELECT USING (false);
CREATE POLICY "Deny public" ON sync_state FOR SELECT USING (false);

-- ==========================================
-- REALTIME SUBSCRIPTIONS
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
ALTER PUBLICATION supabase_realtime ADD TABLE agent_directives;

-- ==========================================
-- RPC FUNCTIONS
-- ==========================================

-- Elo settlement: supports N players, per-game-type ratings.
-- Global profile only tracks wins/losses/draws, NOT elo (elo is per-game only).
-- p_players: array of player addresses
-- p_winner_index: 0-based index into p_players, -1 for draw
-- p_game_type: 'rps', 'poker', 'liars_dice', etc.
-- p_stake: USDC stake per player (for tracking total_wagered/total_won)
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
    actual_score FLOAT;
    delta FLOAT;
    cur_elo INT;
    is_win BOOLEAN;
    is_loss BOOLEAN;
    is_draw BOOLEAN;
    payout NUMERIC;
BEGIN
    -- Fetch current elos for this game type
    elos := ARRAY[]::INT[];
    FOR i IN 1..n LOOP
        SELECT COALESCE(elo, 1200) INTO cur_elo
        FROM agent_profiles
        WHERE address = p_players[i] AND game_type = p_game_type;
        IF cur_elo IS NULL THEN cur_elo := 1200; END IF;
        elos := array_append(elos, cur_elo);
    END LOOP;

    -- Calculate new elos (each player vs each other player, averaged)
    new_elos := elos;
    FOR i IN 1..n LOOP
        delta := 0;
        FOR j IN 1..n LOOP
            IF i != j THEN
                exp_score := 1.0 / (1.0 + POWER(10.0, (elos[j] - elos[i])::FLOAT / 400.0));
                IF p_winner_index = -1 THEN
                    actual_score := 0.5;
                ELSIF p_winner_index = (i - 1) THEN
                    actual_score := 1.0;
                ELSE
                    actual_score := 0.0;
                END IF;
                delta := delta + k * (actual_score - exp_score);
            END IF;
        END LOOP;
        new_elos[i] := GREATEST(0, elos[i] + ROUND(delta / (n - 1))::INT);
    END LOOP;

    -- Upsert all players
    FOR i IN 1..n LOOP
        is_win := (p_winner_index = (i - 1));
        is_loss := (p_winner_index >= 0 AND p_winner_index != (i - 1));
        is_draw := (p_winner_index = -1);

        -- Calculate payout for total_won tracking
        IF is_win THEN
            payout := p_stake * n * 0.95; -- pot minus 5% rake (approximate)
        ELSE
            payout := 0;
        END IF;

        -- Game-specific profile (with elo)
        INSERT INTO agent_profiles (address, game_type, elo, wins, losses, draws, total_wagered, total_won, win_streak, best_streak, last_active)
        VALUES (
            p_players[i], p_game_type, new_elos[i],
            CASE WHEN is_win THEN 1 ELSE 0 END,
            CASE WHEN is_loss THEN 1 ELSE 0 END,
            CASE WHEN is_draw THEN 1 ELSE 0 END,
            p_stake, payout,
            CASE WHEN is_win THEN 1 ELSE 0 END,
            CASE WHEN is_win THEN 1 ELSE 0 END,
            NOW()
        )
        ON CONFLICT (address, game_type) DO UPDATE SET
            elo = new_elos[i],
            wins = agent_profiles.wins + CASE WHEN is_win THEN 1 ELSE 0 END,
            losses = agent_profiles.losses + CASE WHEN is_loss THEN 1 ELSE 0 END,
            draws = agent_profiles.draws + CASE WHEN is_draw THEN 1 ELSE 0 END,
            total_wagered = agent_profiles.total_wagered + p_stake,
            total_won = agent_profiles.total_won + payout,
            win_streak = CASE WHEN is_win THEN agent_profiles.win_streak + 1 ELSE 0 END,
            best_streak = GREATEST(agent_profiles.best_streak, CASE WHEN is_win THEN agent_profiles.win_streak + 1 ELSE agent_profiles.best_streak END),
            last_active = NOW();

        -- Global profile (wins/losses/draws + wagered/won only, NO elo)
        INSERT INTO agent_profiles (address, game_type, elo, wins, losses, draws, total_wagered, total_won, win_streak, best_streak, last_active)
        VALUES (
            p_players[i], 'global', 1200,
            CASE WHEN is_win THEN 1 ELSE 0 END,
            CASE WHEN is_loss THEN 1 ELSE 0 END,
            CASE WHEN is_draw THEN 1 ELSE 0 END,
            p_stake, payout,
            CASE WHEN is_win THEN 1 ELSE 0 END,
            CASE WHEN is_win THEN 1 ELSE 0 END,
            NOW()
        )
        ON CONFLICT (address, game_type) DO UPDATE SET
            wins = agent_profiles.wins + CASE WHEN is_win THEN 1 ELSE 0 END,
            losses = agent_profiles.losses + CASE WHEN is_loss THEN 1 ELSE 0 END,
            draws = agent_profiles.draws + CASE WHEN is_draw THEN 1 ELSE 0 END,
            total_wagered = agent_profiles.total_wagered + p_stake,
            total_won = agent_profiles.total_won + payout,
            win_streak = CASE WHEN is_win THEN agent_profiles.win_streak + 1 ELSE 0 END,
            best_streak = GREATEST(agent_profiles.best_streak, CASE WHEN is_win THEN agent_profiles.win_streak + 1 ELSE agent_profiles.best_streak END),
            last_active = NOW();
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Cleanup salts after match settlement
CREATE OR REPLACE FUNCTION cleanup_settled_salts(p_match_id UUID)
RETURNS VOID AS $$
BEGIN
    DELETE FROM salt_vault WHERE match_id = p_match_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Updated_at trigger
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

CREATE TRIGGER manager_profiles_updated_at
    BEFORE UPDATE ON manager_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER logic_submissions_updated_at
    BEFORE UPDATE ON logic_submissions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER logic_bounties_updated_at
    BEFORE UPDATE ON logic_bounties
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ==========================================
-- VIEWS (CONVENIENCE QUERIES)
-- ==========================================

-- Leaderboard: top agents per game type
CREATE OR REPLACE VIEW leaderboard AS
SELECT
    address,
    game_type,
    nickname,
    elo,
    wins,
    losses,
    draws,
    CASE WHEN (wins + losses) > 0
        THEN ROUND(wins::NUMERIC / (wins + losses) * 100, 1)
        ELSE 0
    END AS win_rate,
    total_wagered,
    total_won,
    win_streak,
    best_streak,
    last_active
FROM agent_profiles
ORDER BY game_type, elo DESC;

-- Active matches with player names
CREATE OR REPLACE VIEW active_matches AS
SELECT
    m.id,
    m.escrow_address,
    m.escrow_type,
    m.on_chain_id,
    m.game_name,
    m.stake,
    m.total_pot,
    m.status,
    m.phase,
    m.current_round,
    m.wins,
    m.winner,
    m.state_description,
    m.created_at,
    array_agg(mp.player_address ORDER BY mp.player_index) AS players,
    array_agg(COALESCE(ap.nickname, mp.player_address) ORDER BY mp.player_index) AS player_names
FROM matches m
LEFT JOIN match_players mp ON mp.match_id = m.id
LEFT JOIN agent_profiles ap ON ap.address = mp.player_address AND ap.game_type = 'global'
WHERE m.status IN ('OPEN', 'ACTIVE')
GROUP BY m.id;

-- Pool odds: current odds for each prediction pool
CREATE OR REPLACE VIEW pool_odds AS
SELECT
    pp.id AS pool_id,
    pp.title,
    pp.status,
    pp.total_pool,
    pp.outcome_labels,
    pp.outcome_totals,
    pp.betting_deadline,
    pp.winning_outcome,
    m.game_name AS match_game,
    m.status AS match_status
FROM prediction_pools pp
LEFT JOIN matches m ON m.id = pp.match_id;

-- ==========================================
-- SEED DATA
-- ==========================================

-- Indexer sync cursors (one per contract, add more as contracts deploy)
INSERT INTO sync_state (id, escrow_address, escrow_type, last_processed_block) VALUES
    ('fise_v4', '0x0000000000000000000000000000000000000000', 'FISE', 0),
    ('poker_v4', '0x0000000000000000000000000000000000000000', 'POKER', 0),
    ('prediction_pool', '0x0000000000000000000000000000000000000000', NULL, 0)
ON CONFLICT (id) DO NOTHING;

-- Registered games
INSERT INTO logic_registry (logic_id, ipfs_cid, game_name, escrow_type, description, is_verified, betting_enabled, max_streets, default_max_rounds, default_wins_required) VALUES
    ('0xf2f80f1811f9e2c534946f0e8ddbdbd5c1e23b6e48772afe3bccdb9f2e1cfdf3', '', 'Rock Paper Scissors', 'FISE', 'Classic RPS - simultaneous commit/reveal', TRUE, FALSE, NULL, 10, 3),
    ('0x2db54e16efc4149dedd2d7efcff126fb6bd2c54090ee2b6460af6a7dd252e318', '', 'Poker Blitz', 'POKER', '5-Card Draw poker with discard round', TRUE, TRUE, 1, 10, 3),
    ('0x2376a7b3448a3b64858d5fcfeca172b49521df5ce706244b0300fdfe653fa28f', '', 'Liars Dice', 'FISE', 'Simultaneous bid/call bluffing game', TRUE, FALSE, NULL, 10, 3)
ON CONFLICT (logic_id) DO NOTHING;

INSERT INTO logic_aliases (logic_id, alias_name) VALUES
    ('0xf2f80f1811f9e2c534946f0e8ddbdbd5c1e23b6e48772afe3bccdb9f2e1cfdf3', 'RPS'),
    ('0x2db54e16efc4149dedd2d7efcff126fb6bd2c54090ee2b6460af6a7dd252e318', 'Poker Blitz'),
    ('0x2376a7b3448a3b64858d5fcfeca172b49521df5ce706244b0300fdfe653fa28f', 'Liars Dice')
ON CONFLICT (logic_id) DO NOTHING;
