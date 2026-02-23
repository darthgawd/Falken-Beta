-- Migration 006: Add decrement_wins_a/b for reorg recovery
-- handleReorg calls these on RoundResolved reorgs; without them the call silently fails.
CREATE OR REPLACE FUNCTION decrement_wins_a(m_id text) RETURNS void AS $$
  UPDATE matches SET wins_a = GREATEST(0, wins_a - 1) WHERE match_id = m_id;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION decrement_wins_b(m_id text) RETURNS void AS $$
  UPDATE matches SET wins_b = GREATEST(0, wins_b - 1) WHERE match_id = m_id;
$$ LANGUAGE sql;
