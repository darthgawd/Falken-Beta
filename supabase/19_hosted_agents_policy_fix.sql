-- Migration: 19_hosted_agents_policy_fix.sql
-- Description: Allow everyone to view hosted agents (telemetry fix)

DROP POLICY IF EXISTS "Managers can view their own hosted agents" ON public.hosted_agents;
CREATE POLICY "Anyone can view hosted agents" ON public.hosted_agents FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can view manager profiles" ON public.manager_profiles;
CREATE POLICY "Anyone can view manager profiles" ON public.manager_profiles FOR SELECT USING (true);
