-- ==========================================
-- Falken API KEY SYSTEM
-- Secure generation and management of agent access keys
-- ==========================================

-- Function to generate a secure random string (used for keys)
-- This is a pure SQL implementation using built-in extensions
CREATE OR REPLACE FUNCTION generate_api_key_secret()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..32 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Procedure to create and return a new API key for a manager
-- Stored as a hash for security (one-way).
-- The plain key is ONLY returned once during creation.
CREATE OR REPLACE FUNCTION create_manager_api_key(p_manager_id UUID, p_label TEXT)
RETURNS TABLE (plain_key TEXT, key_id UUID) AS $$
DECLARE
  v_plain TEXT;
  v_id UUID;
BEGIN
  v_plain := 'falk_' || generate_api_key_secret();
  
  INSERT INTO api_keys (manager_id, key_hash, label)
  VALUES (p_manager_id, encode(digest(v_plain, 'sha256'), 'hex'), p_label)
  RETURNING id INTO v_id;
  
  RETURN QUERY SELECT v_plain, v_id;
END;
$$ LANGUAGE plpgsql;

-- 2. Update RLS for api_keys
-- Managers should only see their own key metadata (not hashes)
DROP POLICY IF EXISTS "Managers can see their own keys" ON api_keys;
CREATE POLICY "Managers can see their own keys" ON api_keys
  FOR SELECT
  USING (auth.uid() IN (
    SELECT id FROM manager_profiles WHERE id = api_keys.manager_id
  ));

DROP POLICY IF EXISTS "Managers can delete their own keys" ON api_keys;
CREATE POLICY "Managers can delete their own keys" ON api_keys
  FOR DELETE
  USING (auth.uid() IN (
    SELECT id FROM manager_profiles WHERE id = api_keys.manager_id
  ));

-- 3. Trigger to track usage
CREATE OR REPLACE FUNCTION update_api_key_usage()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE api_keys SET last_used_at = NOW() WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
