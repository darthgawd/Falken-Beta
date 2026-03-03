-- Atomic Win Increment for Player A (Text ID)
create or replace function increment_wins_a(m_id text) returns void as $$
  update matches set wins_a = wins_a + 1 where match_id = m_id;
$$ language sql;

-- Atomic Win Increment for Player B (Text ID)
create or replace function increment_wins_b(m_id text) returns void as $$
  update matches set wins_b = wins_b + 1 where match_id = m_id;
$$ language sql;
