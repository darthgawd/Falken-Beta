-- ==========================================
-- FIX: Allow Manager Auto-Registration
-- ==========================================

DO $$
BEGIN
    -- Allow the frontend to create/update manager profiles
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'manager_profiles' AND policyname = 'Allow Anonymous Upsert Managers') THEN
        CREATE POLICY "Allow Anonymous Upsert Managers" ON manager_profiles FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;
