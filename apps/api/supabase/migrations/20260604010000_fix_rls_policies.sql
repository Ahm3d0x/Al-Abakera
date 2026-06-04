-- ============================================================
-- Mind Race — Fix Row-Level Security (RLS) Policies
-- Allow proper updates/deletes for multiplayer game flow
-- ============================================================

-- 1. Drop existing restrictive delete policy on room_participants
DROP POLICY IF EXISTS "room_participants_delete_self" ON room_participants;

-- 2. Add/Fix Room Participants policies (supporting host cleanup and self updates)
DROP POLICY IF EXISTS "room_participants_update_host_or_self" ON room_participants;
CREATE POLICY "room_participants_update_host_or_self"
  ON room_participants FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid() OR 
    EXISTS (
      SELECT 1 FROM rooms 
      WHERE rooms.id = room_participants.room_id AND rooms.host_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid() OR 
    EXISTS (
      SELECT 1 FROM rooms 
      WHERE rooms.id = room_participants.room_id AND rooms.host_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "room_participants_delete_host_or_self" ON room_participants;
CREATE POLICY "room_participants_delete_host_or_self"
  ON room_participants FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid() OR 
    EXISTS (
      SELECT 1 FROM rooms 
      WHERE rooms.id = room_participants.room_id AND rooms.host_id = auth.uid()
    )
  );

-- 3. Add Matches update policy (needed to set status = 'ENDED' at match completion)
DROP POLICY IF EXISTS "matches_update_authenticated" ON matches;
CREATE POLICY "matches_update_authenticated"
  ON matches FOR UPDATE
  TO authenticated
  USING (true);

-- 4. Add Match Rounds update policy (needed to claim buzzer and end rounds)
DROP POLICY IF EXISTS "match_rounds_update_authenticated" ON match_rounds;
CREATE POLICY "match_rounds_update_authenticated"
  ON match_rounds FOR UPDATE
  TO authenticated
  USING (true);

-- 5. Add Round Answers update policy
DROP POLICY IF EXISTS "round_answers_update_self" ON round_answers;
CREATE POLICY "round_answers_update_self"
  ON round_answers FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 6. Add Match Participants update policy
DROP POLICY IF EXISTS "match_participants_update_self" ON match_participants;
CREATE POLICY "match_participants_update_self"
  ON match_participants FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
