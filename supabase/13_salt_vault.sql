-- ==========================================
-- FISE: HOSTED AGENT SALT VAULT
-- ==========================================

CREATE TABLE IF NOT EXISTS public.hosted_agent_salts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_address TEXT NOT NULL,
    match_id TEXT NOT NULL,
    round_number INTEGER NOT NULL,
    move_value INTEGER NOT NULL,
    salt_value TEXT NOT NULL,
    revealed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure we only have one salt per agent per round
    UNIQUE(agent_address, match_id, round_number)
);

-- Indexing for fast retrieval during Reveal phase
CREATE INDEX IF NOT EXISTS idx_salt_vault_lookup ON public.hosted_agent_salts(agent_address, match_id, round_number);

-- RLS Policies (CRITICAL: High Security)
ALTER TABLE public.hosted_agent_salts ENABLE ROW LEVEL SECURITY;

-- 1. No one can see salts via public API (even the owner)
-- The Agent Runner uses the service_role to bypass this.
CREATE POLICY "Deny public access to salts" 
ON public.hosted_agent_salts FOR SELECT USING (false);

-- 2. Cleanup function to remove old salts after settlement
-- This keeps the "Vault" lean and reduces the attack surface.
CREATE OR REPLACE FUNCTION public.cleanup_settled_salts(p_match_id TEXT)
RETURNS VOID AS $$
BEGIN
    DELETE FROM public.hosted_agent_salts WHERE match_id = p_match_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
