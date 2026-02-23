-- ==========================================
-- Migration 005: Indexes + Proper Elo
-- ==========================================

-- 1. Query performance indexes
CREATE INDEX IF NOT EXISTS idx_matches_player_a  ON matches (player_a);
CREATE INDEX IF NOT EXISTS idx_matches_player_b  ON matches (player_b);
CREATE INDEX IF NOT EXISTS idx_matches_status    ON matches (status);
CREATE INDEX IF NOT EXISTS idx_rounds_player     ON rounds (player_address);
CREATE INDEX IF NOT EXISTS idx_rounds_match_round ON rounds (match_id, round_number);

-- 2. Proper Elo rating (K=32, 400-point scale)
--    Replaces the flat +25/-20 update_agent_stats.
--    Updates BOTH players atomically in a single call.
CREATE OR REPLACE FUNCTION settle_match_elo(
  p_player_a    text,
  p_player_b    text,
  p_winner_index int   -- 0 = draw, 1 = player_a wins, 2 = player_b wins
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
  -- Fetch current ratings, defaulting to 1200 for new agents
  SELECT COALESCE(elo, 1200) INTO elo_a FROM agent_profiles WHERE address = p_player_a;
  SELECT COALESCE(elo, 1200) INTO elo_b FROM agent_profiles WHERE address = p_player_b;
  IF elo_a IS NULL THEN elo_a := 1200; END IF;
  IF elo_b IS NULL THEN elo_b := 1200; END IF;

  -- Expected scores
  exp_a := 1.0 / (1.0 + POWER(10.0, (elo_b - elo_a)::float / 400.0));
  exp_b := 1.0 - exp_a;

  -- Actual scores
  IF p_winner_index = 0 THEN
    actual_a := 0.5; actual_b := 0.5;
  ELSIF p_winner_index = 1 THEN
    actual_a := 1.0; actual_b := 0.0;
  ELSE
    actual_a := 0.0; actual_b := 1.0;
  END IF;

  new_elo_a := GREATEST(0, elo_a + ROUND(k * (actual_a - exp_a))::int);
  new_elo_b := GREATEST(0, elo_b + ROUND(k * (actual_b - exp_b))::int);

  -- Upsert player A
  INSERT INTO agent_profiles (address, elo, wins, losses, draws, last_active)
  VALUES (
    p_player_a, new_elo_a,
    CASE WHEN p_winner_index = 1 THEN 1 ELSE 0 END,
    CASE WHEN p_winner_index = 2 THEN 1 ELSE 0 END,
    CASE WHEN p_winner_index = 0 THEN 1 ELSE 0 END,
    NOW()
  )
  ON CONFLICT (address) DO UPDATE SET
    elo     = new_elo_a,
    wins    = agent_profiles.wins    + CASE WHEN p_winner_index = 1 THEN 1 ELSE 0 END,
    losses  = agent_profiles.losses  + CASE WHEN p_winner_index = 2 THEN 1 ELSE 0 END,
    draws   = agent_profiles.draws   + CASE WHEN p_winner_index = 0 THEN 1 ELSE 0 END,
    last_active = NOW();

  -- Upsert player B
  INSERT INTO agent_profiles (address, elo, wins, losses, draws, last_active)
  VALUES (
    p_player_b, new_elo_b,
    CASE WHEN p_winner_index = 2 THEN 1 ELSE 0 END,
    CASE WHEN p_winner_index = 1 THEN 1 ELSE 0 END,
    CASE WHEN p_winner_index = 0 THEN 1 ELSE 0 END,
    NOW()
  )
  ON CONFLICT (address) DO UPDATE SET
    elo     = new_elo_b,
    wins    = agent_profiles.wins    + CASE WHEN p_winner_index = 2 THEN 1 ELSE 0 END,
    losses  = agent_profiles.losses  + CASE WHEN p_winner_index = 1 THEN 1 ELSE 0 END,
    draws   = agent_profiles.draws   + CASE WHEN p_winner_index = 0 THEN 1 ELSE 0 END,
    last_active = NOW();
END;
$$ LANGUAGE plpgsql;
