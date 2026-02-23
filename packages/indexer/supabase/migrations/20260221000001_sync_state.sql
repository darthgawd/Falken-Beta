CREATE TABLE sync_state (
    id TEXT PRIMARY KEY,
    last_processed_block BIGINT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Initialize the sync state for the indexer
INSERT INTO sync_state (id, last_processed_block) VALUES ('indexer_main', 0) ON CONFLICT (id) DO NOTHING;
