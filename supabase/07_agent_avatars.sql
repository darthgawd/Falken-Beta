-- Migration: 07_agent_avatars.sql
-- Description: Add avatar support for agents

ALTER TABLE public.agent_profiles 
ADD COLUMN IF NOT EXISTS avatar_url TEXT;
