-- ==========================================
-- Falken TERMINAL GATING & USAGE SCHEMA
-- ==========================================

-- 1. Extend Manager Profiles with Tier Info
ALTER TABLE manager_profiles 
ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'STANDARD', -- 'STANDARD', 'PRO'
ADD COLUMN IF NOT EXISTS falk_staked NUMERIC DEFAULT 0;

-- 2. Terminal Request Tracking
CREATE TABLE IF NOT EXISTS terminal_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manager_id UUID REFERENCES manager_profiles(id) ON DELETE CASCADE,
    request_count INT DEFAULT 0,
    last_request_at TIMESTAMPTZ DEFAULT NOW(),
    reset_at TIMESTAMPTZ DEFAULT (CURRENT_DATE + INTERVAL '1 day'),
    UNIQUE(manager_id)
);

-- 3. Terminal Query Logs (For Intel Lens Training)
-- We store what people ask so we can improve the OS response accuracy
CREATE TABLE IF NOT EXISTS terminal_queries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manager_id UUID REFERENCES manager_profiles(id) ON DELETE SET NULL,
    query_text TEXT NOT NULL,
    ai_response TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. RLS Policies
ALTER TABLE terminal_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own usage" ON terminal_usage FOR SELECT USING (auth.uid() = manager_id);

-- 5. Helper Function to increment and check limit
CREATE OR REPLACE FUNCTION check_terminal_limit(p_manager_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_count INT;
    v_tier TEXT;
    v_limit INT := 5; -- Daily free limit
BEGIN
    -- 1. Get user tier
    SELECT tier INTO v_tier FROM manager_profiles WHERE id = p_manager_id;
    
    -- 2. If PRO, no limit
    IF v_tier = 'PRO' THEN
        RETURN TRUE;
    END IF;

    -- 3. Get or Create usage record
    INSERT INTO terminal_usage (manager_id) 
    VALUES (p_manager_id)
    ON CONFLICT (manager_id) DO UPDATE 
    SET request_count = CASE 
        WHEN terminal_usage.reset_at < NOW() THEN 0 
        ELSE terminal_usage.request_count 
    END,
    reset_at = CASE 
        WHEN terminal_usage.reset_at < NOW() THEN (CURRENT_DATE + INTERVAL '1 day')
        ELSE terminal_usage.reset_at 
    END;

    -- 4. Check limit
    SELECT request_count INTO v_count FROM terminal_usage WHERE manager_id = p_manager_id;
    
    IF v_count < v_limit THEN
        UPDATE terminal_usage SET request_count = request_count + 1 WHERE manager_id = p_manager_id;
        RETURN TRUE;
    ELSE
        RETURN FALSE;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
