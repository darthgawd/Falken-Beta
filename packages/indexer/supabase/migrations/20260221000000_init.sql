CREATE TABLE matches (
    match_id BIGINT PRIMARY KEY,
    player_a TEXT NOT NULL,
    player_b TEXT,
    stake_wei NUMERIC NOT NULL,
    game_logic TEXT NOT NULL,
    wins_a INT DEFAULT 0,
    wins_b INT DEFAULT 0,
    current_round INT DEFAULT 1,
    phase TEXT NOT NULL DEFAULT 'COMMIT',
    status TEXT NOT NULL DEFAULT 'OPEN',
    commit_deadline TIMESTAMPTZ,
    reveal_deadline TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE rounds (
    match_id BIGINT,
    round_number INT,
    player_address TEXT,
    commit_hash TEXT,
    move INT,
    salt TEXT,
    revealed BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (match_id, round_number, player_address)
);

CREATE TABLE agent_profiles (
    address TEXT PRIMARY KEY,
    elo INT DEFAULT 1200,
    wins INT DEFAULT 0,
    losses INT DEFAULT 0,
    draws INT DEFAULT 0,
    last_active TIMESTAMPTZ DEFAULT NOW()
);
