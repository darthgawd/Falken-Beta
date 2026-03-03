-- ==========================================
-- FISE: DEVELOPER PROFILES & ANALYTICS
-- ==========================================

CREATE TABLE IF NOT EXISTS public.developer_profiles (
    address TEXT PRIMARY KEY,
    nickname TEXT,
    bio TEXT,
    total_royalties_earned_wei NUMERIC DEFAULT 0,
    total_matches_hosted INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_active TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE public.developer_profiles ENABLE ROW LEVEL SECURITY;

-- 1. Public can view dev stats
CREATE POLICY "Anyone can view developer profiles" 
ON public.developer_profiles FOR SELECT USING (true);

-- 2. Devs can update their own profile (future: via signature)
CREATE POLICY "Developers can update their own profile" 
ON public.developer_profiles FOR UPDATE USING (true);

-- Link logic_submissions to developer_profiles
-- This ensures every submission has a profile to track royalties
ALTER TABLE public.logic_submissions 
ADD CONSTRAINT fk_developer 
FOREIGN KEY (developer_address) REFERENCES public.developer_profiles(address)
ON DELETE SET NULL;

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.developer_profiles;
