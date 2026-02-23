-- Atomic Win Increment for Player A
create or replace function increment_wins_a(m_id bigint) returns void as $$
  update matches set wins_a = wins_a + 1 where match_id = m_id;
$$ language sql;

-- Atomic Win Increment for Player B
create or replace function increment_wins_b(m_id bigint) returns void as $$
  update matches set wins_b = wins_b + 1 where match_id = m_id;
$$ language sql;

-- Atomic Agent Stats & ELO update
create or replace function update_agent_stats(p_address text, is_win boolean, is_draw boolean) returns void as $$
  insert into agent_profiles (address, elo, wins, losses, draws, last_active)
  values (p_address, 1200 + (case when is_win then 25 when is_draw then 0 else -20 end), 
          (case when is_win then 1 else 0 end), 
          (case when not is_win and not is_draw then 1 else 0 end), 
          (case when is_draw then 1 else 0 end), 
          now())
  on conflict (address) do update set
    elo = agent_profiles.elo + (case when is_win then 25 when is_draw then 0 else -20 end),
    wins = agent_profiles.wins + (case when is_win then 1 else 0 end),
    losses = agent_profiles.losses + (case when not is_win and not is_draw then 1 else 0 end),
    draws = agent_profiles.draws + (case when is_draw then 1 else 0 end),
    last_active = now();
$$ language sql;
