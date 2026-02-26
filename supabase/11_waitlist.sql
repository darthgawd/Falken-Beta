-- ==========================================
-- Falken WAITLIST / MAILING LIST SCHEMA
-- ==========================================

CREATE TABLE IF NOT EXISTS waitlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    source TEXT DEFAULT 'landing_page'
);

-- RLS Policies (Allow anonymous inserts, restrict selects to admin)
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can join waitlist" ON waitlist FOR INSERT WITH CHECK (true);
CREATE POLICY "Only admin can view waitlist" ON waitlist FOR SELECT USING (false); -- Adjust this based on your admin role logic if needed
