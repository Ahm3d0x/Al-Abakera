-- ============================================================
-- Mind Race — Serverless Game Triggers & Helper Functions
-- Transition from Node.js Express server to Supabase serverless
-- ============================================================

-- ==========================================
-- 1. Secure Answer-Grading Trigger Function
-- ==========================================
CREATE OR REPLACE FUNCTION grade_round_answer()
RETURNS TRIGGER AS $$
DECLARE
  v_q_type text;
  v_correct_answer jsonb;
  v_ordering_items jsonb;
  v_matching_pairs jsonb;
  v_difficulty text;
  v_is_correct boolean := false;
  v_points_earned integer := 0;
  v_time_limit integer := 30;
  v_started_at timestamptz;
  v_time_spent_ms integer;
  v_buzzed_player_id uuid;
  v_match_mode text;
  v_multiplier numeric := 1.0;
  v_base_points integer := 100;
  v_time_bonus integer := 0;
  v_time_left_sec numeric;
BEGIN
  -- 1. Fetch question details and match configuration
  SELECT q.type::text, q.correct_answer, q.ordering_items, q.matching_pairs, q.difficulty::text,
         mr.started_at, mr.buzzed_player_id, m.mode::text,
         coalesce((m.config->>'questionTimeLimitSeconds')::integer, 30)
  INTO v_q_type, v_correct_answer, v_ordering_items, v_matching_pairs, v_difficulty,
       v_started_at, v_buzzed_player_id, v_match_mode, v_time_limit
  FROM match_rounds mr
  JOIN matches m ON m.id = mr.match_id
  JOIN questions q ON q.id = mr.question_id
  WHERE mr.id = NEW.round_id;

  -- 2. Execute grading logic based on QuestionType
  IF v_q_type = 'MULTIPLE_CHOICE' OR v_q_type = 'TRUE_FALSE' OR v_q_type = 'IMAGE_QUESTION' OR v_q_type = 'CIRCUIT_QUESTION' THEN
    v_is_correct := (lower(trim(both '"' from NEW.answer::text)) = lower(trim(both '"' from v_correct_answer::text)));
    
  ELSIF v_q_type = 'FILL_IN_THE_BLANK' THEN
    IF jsonb_typeof(v_correct_answer) = 'array' THEN
      -- Check if submitted string exists in array of correct answers
      SELECT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_correct_answer) elem
        WHERE lower(trim(both '"' from NEW.answer::text)) = lower(elem)
      ) INTO v_is_correct;
    ELSE
      v_is_correct := (lower(trim(both '"' from NEW.answer::text)) = lower(trim(both '"' from v_correct_answer::text)));
    END IF;
    
  ELSIF v_q_type = 'MULTI_SELECT' THEN
    -- Order-independent array check
    v_is_correct := (NEW.answer @> v_correct_answer AND NEW.answer <@ v_correct_answer);
    
  ELSIF v_q_type = 'ORDERING_QUESTION' THEN
    -- Order-sensitive array check
    IF v_correct_answer IS NOT NULL THEN
      v_is_correct := (NEW.answer = v_correct_answer);
    ELSE
      v_is_correct := (NEW.answer = v_ordering_items);
    END IF;
    
  ELSIF v_q_type = 'MATCHING_QUESTION' THEN
    -- Match mapping pairs comparison
    DECLARE
      v_expected_map jsonb := '{}'::jsonb;
      v_pair record;
    BEGIN
      FOR v_pair IN SELECT * FROM jsonb_to_recordset(v_matching_pairs) AS (leftId text, rightId text) LOOP
        v_expected_map := jsonb_build_object(v_pair.leftId, v_pair.rightId) || v_expected_map;
      END LOOP;
      v_is_correct := (NEW.answer = v_expected_map);
    END;
    
  ELSIF v_q_type = 'CALCULATION_QUESTION' THEN
    DECLARE
      v_user_val numeric;
      v_correct_val numeric;
    BEGIN
      v_user_val := (trim(both '"' from NEW.answer::text))::numeric;
      v_correct_val := (trim(both '"' from v_correct_answer::text))::numeric;
      v_is_correct := (abs(v_user_val - v_correct_val) < 0.00001);
    EXCEPTION WHEN OTHERS THEN
      v_is_correct := false;
    END;
    
  ELSIF v_q_type = 'CODING_QUESTION' THEN
    -- Secure flag verify (client runs vm coding sandbox inside Web Worker / browser)
    IF jsonb_typeof(NEW.answer) = 'object' AND NEW.answer->>'clientGraded' = 'true' THEN
      v_is_correct := (NEW.answer->>'isCorrect')::boolean;
    ELSE
      v_is_correct := (NEW.answer = v_correct_answer);
    END IF;
  END IF;

  -- 3. Calculate points and apply multiplier/powerups
  IF v_is_correct THEN
    v_time_spent_ms := NEW.time_spent_ms;
    v_time_left_sec := greatest(0, v_time_limit - (v_time_spent_ms / 1000.0));
    
    IF v_match_mode <> 'PRACTICE' THEN
      v_time_bonus := floor(v_time_left_sec * 2);
    END IF;
    
    -- Buzzer multiplier: 1.2x if this user is the registered buzzer
    IF v_buzzed_player_id = NEW.user_id THEN
      v_multiplier := 1.2;
    END IF;
    
    -- Power-up multiplier: Joker doubles score
    IF NEW.power_ups_used @> '"JOKER"'::jsonb THEN
      v_multiplier := v_multiplier * 2;
    END IF;

    v_points_earned := floor((v_base_points + v_time_bonus) * v_multiplier);
  ELSE
    -- Penalize buzzer failures
    IF v_buzzed_player_id = NEW.user_id AND v_match_mode <> 'PRACTICE' THEN
      v_points_earned := -30;
    END IF;
  END IF;

  NEW.is_correct := v_is_correct;
  NEW.points_earned := v_points_earned;
  NEW.submitted_at := now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger definition
DROP TRIGGER IF EXISTS trg_grade_round_answer ON round_answers;
CREATE TRIGGER trg_grade_round_answer
  BEFORE INSERT OR UPDATE ON round_answers
  FOR EACH ROW EXECUTE FUNCTION grade_round_answer();


-- ==========================================
-- 2. Atomic Buzzer Claim Lockout Function
-- ==========================================
CREATE OR REPLACE FUNCTION claim_buzzer(p_round_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE match_rounds
  SET buzzed_player_id = p_user_id, buzz_time_ms = floor(extract(epoch from now()) * 1000)
  WHERE id = p_round_id AND buzzed_player_id IS NULL;
  
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ==========================================
-- 3. Secure Room Creation RPC
-- ==========================================
CREATE OR REPLACE FUNCTION create_room_secure(p_host_id UUID, p_type room_type, p_config JSONB)
RETURNS TABLE (
  id UUID,
  code TEXT,
  host_id UUID,
  type room_type,
  status room_status,
  config JSONB,
  current_round INTEGER,
  max_players INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
#variable_conflict use_column
DECLARE
  v_code TEXT;
  v_chars TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  v_attempts INTEGER := 0;
  v_room_id UUID;
  v_max_players INTEGER := coalesce((p_config->>'maxPlayers')::integer, 10);
BEGIN
  -- Generate unique 6 character code
  WHILE v_attempts < 20 LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(v_chars, floor(random() * 36)::integer + 1, 1);
    END LOOP;
    
    -- Check uniqueness
    IF NOT EXISTS (SELECT 1 FROM rooms WHERE code = v_code) THEN
      EXIT;
    END IF;
    v_attempts := v_attempts + 1;
  END LOOP;
  
  -- Fallback to timestamp code if collision persists
  IF v_attempts >= 20 THEN
    v_code := 'R' || upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 5));
  END IF;
  
  -- Insert the room
  INSERT INTO rooms (code, host_id, type, status, config, max_players, current_round)
  VALUES (v_code, p_host_id, p_type, 'WAITING', p_config, v_max_players, 0)
  RETURNING rooms.id INTO v_room_id;
  
  -- Auto-add host as ready participant
  INSERT INTO room_participants (room_id, user_id, is_host, is_ready, score, is_spectator)
  VALUES (v_room_id, p_host_id, TRUE, TRUE, 0, FALSE);
  
  -- Return the inserted room details
  RETURN QUERY SELECT r.id, r.code, r.host_id, r.type, r.status, r.config, r.current_round, r.max_players, r.created_at, r.updated_at
  FROM rooms r WHERE r.id = v_room_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. Sync Existing Auth Users to Profiles
-- ============================================================
INSERT INTO public.profiles (id, username, email)
SELECT 
  id, 
  coalesce(raw_user_meta_data->>'username', 'player_' || left(id::text, 8)), 
  email
FROM auth.users
ON CONFLICT (id) DO NOTHING;

