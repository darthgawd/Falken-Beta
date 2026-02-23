-- Fix Intel Accuracy: Know if the player was 1 or 2
ALTER TABLE rounds ADD COLUMN player_index INT; -- 1 for PlayerA, 2 for PlayerB
