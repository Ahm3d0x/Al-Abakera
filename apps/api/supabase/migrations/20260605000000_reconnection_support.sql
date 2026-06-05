-- ==========================================
-- Mind Race — Reconnection Grace Period Support
-- ==========================================

-- 1. Add disconnected_at column to room_participants for grace-period tracking
ALTER TABLE room_participants ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Index for efficient cleanup queries on disconnected players
CREATE INDEX IF NOT EXISTS idx_room_participants_disconnected_at
  ON room_participants(disconnected_at)
  WHERE disconnected_at IS NOT NULL;

-- 3. RLS: Allow participants to update their own disconnected_at (already covered by existing policies via service role)
-- No additional RLS needed since all disconnect/reconnect logic uses supabaseAdmin (service role).

-- 4. Cleanup function: Remove stale disconnected players older than 60 seconds
-- Can be called by a cron job or manually
CREATE OR REPLACE FUNCTION cleanup_stale_disconnects()
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM room_participants
  WHERE disconnected_at IS NOT NULL
    AND disconnected_at < NOW() - INTERVAL '60 seconds';
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
