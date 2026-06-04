-- ============================================================
-- Mind Race — Fix Matching Question Grading
-- Fixes case-sensitivity issue when extracting leftId and rightId
-- ============================================================

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
    -- Match mapping pairs comparison (using double quotes for camelCase keys in json)
    DECLARE
      v_expected_map jsonb := '{}'::jsonb;
      v_pair record;
    BEGIN
      FOR v_pair IN SELECT * FROM jsonb_to_recordset(v_matching_pairs) AS ("leftId" text, "rightId" text) LOOP
        v_expected_map := jsonb_build_object(v_pair."leftId", v_pair."rightId") || v_expected_map;
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
