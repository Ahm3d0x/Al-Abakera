-- ==========================================
-- Mind Race — Anti-Cheat Hardening Schema Extensions
-- ==========================================

-- 1. Extend Profiles Table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS suspension_reason TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS flag_reason TEXT;

-- 2. Create Security Events Log Table
CREATE TABLE IF NOT EXISTS public.security_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  username            TEXT,
  action              TEXT NOT NULL,
  ip_address          TEXT,
  device_fingerprint  TEXT,
  timestamp           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- 3. Create Device Appeals Table
CREATE TABLE IF NOT EXISTS public.device_appeals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username            TEXT NOT NULL,
  device_fingerprint  TEXT NOT NULL,
  reason              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Create Judge Audit Logs Table
CREATE TABLE IF NOT EXISTS public.judge_audit_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  judge_id            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  judge_username      TEXT NOT NULL,
  room_id             UUID,
  match_id            UUID,
  action              TEXT NOT NULL,
  target_user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  target_username     TEXT,
  details             TEXT,
  timestamp           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- 5. Enable Row Level Security (RLS)
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.judge_audit_logs ENABLE ROW LEVEL SECURITY;

-- 6. Create RLS Policies
-- Security Events: Admins only can read
CREATE POLICY admin_select_security_events ON public.security_events
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

-- Device Appeals: Users can read/insert their own; Admins can read/update all
CREATE POLICY user_select_device_appeals ON public.device_appeals
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY user_insert_device_appeals ON public.device_appeals
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY admin_select_device_appeals ON public.device_appeals
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

CREATE POLICY admin_update_device_appeals ON public.device_appeals
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

-- Judge Audit Logs: Admins only can read
CREATE POLICY admin_select_judge_audit_logs ON public.judge_audit_logs
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

-- 7. Update Auto-create profile trigger to extract device_fingerprint from signup metadata
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, email, device_fingerprint)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', 'player_' || LEFT(NEW.id::text, 8)),
    NEW.email,
    NEW.raw_user_meta_data->>'device_fingerprint'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Audited Judge RPC overrides
CREATE OR REPLACE FUNCTION judge_answer(
  p_answer_id UUID,
  p_is_correct BOOLEAN,
  p_points_earned INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
  v_judge_id UUID;
  v_judge_username TEXT;
  v_round_id UUID;
  v_target_user_id UUID;
  v_target_username TEXT;
  v_room_id UUID;
  v_match_id UUID;
BEGIN
  -- Get active user invoking the RPC
  v_judge_id := auth.uid();
  SELECT username INTO v_judge_username FROM public.profiles WHERE id = v_judge_id;
  
  -- Fetch details about the answer
  SELECT ra.round_id, ra.user_id, p.username, mr.match_id, m.room_id
  INTO v_round_id, v_target_user_id, v_target_username, v_match_id, v_room_id
  FROM public.round_answers ra
  JOIN public.profiles p ON p.id = ra.user_id
  JOIN public.match_rounds mr ON mr.id = ra.round_id
  JOIN public.matches m ON m.id = mr.match_id
  WHERE ra.id = p_answer_id;

  -- Perform the update
  UPDATE round_answers
  SET is_correct = p_is_correct,
      points_earned = p_points_earned
  WHERE id = p_answer_id;

  -- Insert audit log
  INSERT INTO public.judge_audit_logs (
    judge_id, judge_username, room_id, match_id, action, target_user_id, target_username, details, metadata
  ) VALUES (
    v_judge_id,
    COALESCE(v_judge_username, 'system/unknown'),
    v_room_id,
    v_match_id,
    'judge:grade_answer',
    v_target_user_id,
    v_target_username,
    format('Graded answer ID %s as %s with %s points', p_answer_id, CASE WHEN p_is_correct THEN 'CORRECT' ELSE 'INCORRECT' END, p_points_earned),
    jsonb_build_object('answer_id', p_answer_id, 'is_correct', p_is_correct, 'points_earned', p_points_earned)
  );

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION adjust_participant_score(
  p_room_id UUID,
  p_user_id UUID,
  p_points_delta INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
  v_judge_id UUID;
  v_judge_username TEXT;
  v_target_username TEXT;
BEGIN
  -- Get active user invoking the RPC
  v_judge_id := auth.uid();
  SELECT username INTO v_judge_username FROM public.profiles WHERE id = v_judge_id;
  SELECT username INTO v_target_username FROM public.profiles WHERE id = p_user_id;

  -- Update score
  UPDATE room_participants
  SET score = greatest(0, score + p_points_delta)
  WHERE room_id = p_room_id AND user_id = p_user_id;

  -- Insert audit log
  INSERT INTO public.judge_audit_logs (
    judge_id, judge_username, room_id, action, target_user_id, target_username, details, metadata
  ) VALUES (
    v_judge_id,
    COALESCE(v_judge_username, 'system/unknown'),
    p_room_id,
    'judge:adjust_score',
    p_user_id,
    v_target_username,
    format('Adjusted player score by %s points', p_points_delta),
    jsonb_build_object('points_delta', p_points_delta)
  );

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION end_round_manually(p_round_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_judge_id UUID;
  v_judge_username TEXT;
  v_room_id UUID;
  v_match_id UUID;
BEGIN
  -- Get active user invoking the RPC
  v_judge_id := auth.uid();
  SELECT username INTO v_judge_username FROM public.profiles WHERE id = v_judge_id;

  -- Fetch room and match ID
  SELECT m.room_id, mr.match_id
  INTO v_room_id, v_match_id
  FROM public.match_rounds mr
  JOIN public.matches m ON m.id = mr.match_id
  WHERE mr.id = p_round_id;

  -- Update round
  UPDATE match_rounds
  SET ended_at = NOW()
  WHERE id = p_round_id AND ended_at IS NULL;

  -- Insert audit log
  INSERT INTO public.judge_audit_logs (
    judge_id, judge_username, room_id, match_id, action, details, metadata
  ) VALUES (
    v_judge_id,
    COALESCE(v_judge_username, 'system/unknown'),
    v_room_id,
    v_match_id,
    'judge:end_round',
    format('Ended round ID %s manually', p_round_id),
    jsonb_build_object('round_id', p_round_id)
  );

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
