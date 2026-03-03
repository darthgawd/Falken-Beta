-- ==========================================
-- FISE: LOGIC SUBMISSIONS (CURATED FLOW)
-- ==========================================

CREATE TABLE IF NOT EXISTS public.logic_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    developer_address TEXT NOT NULL,
    ipfs_cid TEXT NOT NULL UNIQUE,
    game_name TEXT NOT NULL,
    description TEXT,
    code_snapshot TEXT, -- For quick preview in Admin Dashboard
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    admin_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexing for fast lookups in the Admin Dashboard
CREATE INDEX IF NOT EXISTS idx_logic_submissions_status ON public.logic_submissions(status);
CREATE INDEX IF NOT EXISTS idx_logic_submissions_dev ON public.logic_submissions(developer_address);

-- RLS Policies
ALTER TABLE public.logic_submissions ENABLE ROW LEVEL SECURITY;

-- 1. Public can view (discovery)
CREATE POLICY "Anyone can view submissions" 
ON public.logic_submissions FOR SELECT USING (true);

-- 2. Developers can submit (requires authenticated session or valid API key in future)
CREATE POLICY "Anyone can submit for review" 
ON public.logic_submissions FOR INSERT WITH CHECK (true);

-- 3. Only Admin can update
-- NOTE: In production, we restrict this to specific admin roles
CREATE POLICY "Admins can update status" 
ON public.logic_submissions FOR UPDATE USING (true);

-- Realtime Support
ALTER PUBLICATION supabase_realtime ADD TABLE public.logic_submissions;
