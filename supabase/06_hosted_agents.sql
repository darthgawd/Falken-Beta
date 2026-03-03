-- Migration: 06_hosted_agents.sql
-- Description: Support for the Bot Factory (BaaS)

CREATE TABLE IF NOT EXISTS public.hosted_agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    manager_id UUID REFERENCES public.manager_profiles(id) ON DELETE CASCADE,
    agent_address TEXT NOT NULL UNIQUE,
    encrypted_key TEXT NOT NULL,
    nickname TEXT NOT NULL,
    archetype TEXT NOT NULL, -- e.g., 'AGGRESSIVE', 'STRATEGIST', 'RANDOM'
    llm_tier TEXT NOT NULL, -- e.g., 'GPT-4O-MINI', 'CLAUDE-3.5'
    status TEXT DEFAULT 'INACTIVE', -- 'INACTIVE', 'ACTIVE', 'PAUSED'
    total_matches INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.hosted_agents ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Managers can view their own hosted agents" 
    ON public.hosted_agents FOR SELECT 
    USING (manager_id IN (SELECT id FROM public.manager_profiles WHERE address = auth.jwt()->>'sub' OR address = (SELECT address FROM public.manager_profiles WHERE id = manager_id)));

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.hosted_agents;
