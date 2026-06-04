-- ==========================================
-- Mind Race — Power-Ups enhancements
-- ==========================================

-- 1. Create swap_round_category RPC to allow CATEGORY_SWAP power-up
CREATE OR REPLACE FUNCTION swap_round_category(p_round_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_match_id UUID;
  v_current_q_id UUID;
  v_current_category TEXT;
  v_next_q_id UUID;
BEGIN
  -- Fetch current question and match details
  SELECT match_id, question_id
  INTO v_match_id, v_current_q_id
  FROM match_rounds
  WHERE id = p_round_id;

  SELECT category INTO v_current_category
  FROM questions
  WHERE id = v_current_q_id;

  -- Select a question from a different category, excluding already used questions in this match
  SELECT id INTO v_next_q_id
  FROM questions
  WHERE category <> v_current_category
    AND id NOT IN (
      SELECT question_id FROM match_rounds WHERE match_id = v_match_id
    )
  ORDER BY random()
  LIMIT 1;

  IF v_next_q_id IS NULL THEN
    -- Fallback to any random unused question
    SELECT id INTO v_next_q_id
    FROM questions
    WHERE id NOT IN (
      SELECT question_id FROM match_rounds WHERE match_id = v_match_id
    )
    ORDER BY random()
    LIMIT 1;
  END IF;

  IF v_next_q_id IS NOT NULL THEN
    UPDATE match_rounds
    SET question_id = v_next_q_id
    WHERE id = p_round_id;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. Create skip_round_question RPC to allow SKIP_QUESTION power-up
CREATE OR REPLACE FUNCTION skip_round_question(p_round_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE match_rounds
  SET ended_at = NOW()
  WHERE id = p_round_id AND ended_at IS NULL;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Create steal_round_buzz RPC to allow STEAL power-up
CREATE OR REPLACE FUNCTION steal_round_buzz(p_round_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  -- Verify if someone buzzed but hasn't submitted yet
  IF NOT EXISTS (SELECT 1 FROM round_answers WHERE round_id = p_round_id) THEN
    UPDATE match_rounds
    SET buzzed_player_id = p_user_id, buzz_time_ms = floor(extract(epoch from now()) * 1000)
    WHERE id = p_round_id AND buzzed_player_id IS NOT NULL;
    
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated > 0;
  END IF;
  
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4. Create check_answer_correct RPC to securely check answer correctness for DOUBLE_CHANCE
CREATE OR REPLACE FUNCTION check_answer_correct(p_question_id UUID, p_answer JSONB)
RETURNS BOOLEAN AS $$
DECLARE
  v_q_type TEXT;
  v_correct_answer JSONB;
  v_ordering_items JSONB;
  v_matching_pairs JSONB;
  v_is_correct BOOLEAN := FALSE;
BEGIN
  SELECT type::text, correct_answer, ordering_items, matching_pairs
  INTO v_q_type, v_correct_answer, v_ordering_items, v_matching_pairs
  FROM questions
  WHERE id = p_question_id;

  IF v_q_type = 'MULTIPLE_CHOICE' OR v_q_type = 'TRUE_FALSE' OR v_q_type = 'IMAGE_QUESTION' OR v_q_type = 'CIRCUIT_QUESTION' THEN
    v_is_correct := (lower(trim(both '"' from p_answer::text)) = lower(trim(both '"' from v_correct_answer::text)));
    
  ELSIF v_q_type = 'FILL_IN_THE_BLANK' THEN
    IF jsonb_typeof(v_correct_answer) = 'array' THEN
      SELECT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_correct_answer) elem
        WHERE lower(trim(both '"' from p_answer::text)) = lower(elem)
      ) INTO v_is_correct;
    ELSE
      v_is_correct := (lower(trim(both '"' from p_answer::text)) = lower(trim(both '"' from v_correct_answer::text)));
    END IF;
    
  ELSIF v_q_type = 'MULTI_SELECT' THEN
    v_is_correct := (p_answer @> v_correct_answer AND p_answer <@ v_correct_answer);
    
  ELSIF v_q_type = 'ORDERING_QUESTION' THEN
    IF v_correct_answer IS NOT NULL THEN
      v_is_correct := (p_answer = v_correct_answer);
    ELSE
      v_is_correct := (p_answer = v_ordering_items);
    END IF;
    
  ELSIF v_q_type = 'MATCHING_QUESTION' THEN
    DECLARE
      v_expected_map jsonb := '{}'::jsonb;
      v_pair record;
    BEGIN
      FOR v_pair IN SELECT * FROM jsonb_to_recordset(v_matching_pairs) AS (leftId text, rightId text) LOOP
        v_expected_map := jsonb_build_object(v_pair.leftId, v_pair.rightId) || v_expected_map;
      END LOOP;
      v_is_correct := (p_answer = v_expected_map);
    END;
    
  ELSIF v_q_type = 'CALCULATION_QUESTION' THEN
    DECLARE
      v_user_val numeric;
      v_correct_val numeric;
    BEGIN
      v_user_val := (trim(both '"' from p_answer::text))::numeric;
      v_correct_val := (trim(both '"' from v_correct_answer::text))::numeric;
      v_is_correct := (abs(v_user_val - v_correct_val) < 0.00001);
    EXCEPTION WHEN OTHERS THEN
      v_is_correct := false;
    END;
  END IF;

  RETURN v_is_correct;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 5. Re-declare grade_round_answer to support JOKER, SHIELD, and POINT_MULTIPLIER power-up logic
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
  
  v_buzzer_type text;
  v_buzzer_presses jsonb;
  v_bid_amount integer := 100;
  v_is_fastest boolean := false;
BEGIN
  -- Fetch question details, match rounds details and match config
  SELECT q.type::text, q.correct_answer, q.ordering_items, q.matching_pairs, q.difficulty::text,
         mr.started_at, mr.buzzed_player_id, m.mode::text,
         coalesce((m.config->>'questionTimeLimitSeconds')::integer, 30),
         coalesce(m.config->>'buzzerType', 'STANDARD'),
         coalesce(mr.buzzer_presses, '[]'::jsonb)
  INTO v_q_type, v_correct_answer, v_ordering_items, v_matching_pairs, v_difficulty,
       v_started_at, v_buzzed_player_id, v_match_mode, v_time_limit,
       v_buzzer_type, v_buzzer_presses
  FROM match_rounds mr
  JOIN matches m ON m.id = mr.match_id
  JOIN questions q ON q.id = mr.question_id
  WHERE mr.id = NEW.round_id;

  -- Execute grading logic based on QuestionType
  IF v_q_type = 'MULTIPLE_CHOICE' OR v_q_type = 'TRUE_FALSE' OR v_q_type = 'IMAGE_QUESTION' OR v_q_type = 'CIRCUIT_QUESTION' THEN
    v_is_correct := (lower(trim(both '"' from NEW.answer::text)) = lower(trim(both '"' from v_correct_answer::text)));
    
  ELSIF v_q_type = 'FILL_IN_THE_BLANK' THEN
    IF jsonb_typeof(v_correct_answer) = 'array' THEN
      SELECT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_correct_answer) elem
        WHERE lower(trim(both '"' from NEW.answer::text)) = lower(elem)
      ) INTO v_is_correct;
    ELSE
      v_is_correct := (lower(trim(both '"' from NEW.answer::text)) = lower(trim(both '"' from v_correct_answer::text)));
    END IF;
    
  ELSIF v_q_type = 'MULTI_SELECT' THEN
    v_is_correct := (NEW.answer @> v_correct_answer AND NEW.answer <@ v_correct_answer);
    
  ELSIF v_q_type = 'ORDERING_QUESTION' THEN
    IF v_correct_answer IS NOT NULL THEN
      v_is_correct := (NEW.answer = v_correct_answer);
    ELSE
      v_is_correct := (NEW.answer = v_ordering_items);
    END IF;
    
  ELSIF v_q_type = 'MATCHING_QUESTION' THEN
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
    IF jsonb_typeof(NEW.answer) = 'object' AND NEW.answer->>'clientGraded' = 'true' THEN
      v_is_correct := (NEW.answer->>'isCorrect')::boolean;
    ELSE
      v_is_correct := (NEW.answer = v_correct_answer);
    END IF;
  END IF;

  -- Calculate points
  IF v_is_correct THEN
    v_time_spent_ms := NEW.time_spent_ms;
    v_time_left_sec := greatest(0, v_time_limit - (v_time_spent_ms / 1000.0));
    
    IF v_match_mode <> 'PRACTICE' THEN
      v_time_bonus := floor(v_time_left_sec * 2);
    END IF;
    
    -- Joker powerup doubles the score
    IF NEW.power_ups_used @> '"JOKER"'::jsonb THEN
      v_multiplier := v_multiplier * 2.0;
    END IF;

    -- Point Multiplier powerup multiplies by 1.5
    IF NEW.power_ups_used @> '"POINT_MULTIPLIER"'::jsonb THEN
      v_multiplier := v_multiplier * 1.5;
    END IF;

    -- Adjust points based on buzzer type
    IF v_buzzer_type = 'RISK' THEN
      -- Risk: full value + time bonus + 50 points bonus
      v_points_earned := floor((v_base_points + v_time_bonus) * v_multiplier) + 50;
    ELSIF v_buzzer_type = 'AUCTION' THEN
      -- Auction: earns the bid amount
      SELECT coalesce((elem->>'bid')::integer, 100) INTO v_bid_amount
      FROM jsonb_array_elements(v_buzzer_presses) elem
      WHERE (elem->>'user_id')::uuid = NEW.user_id
      LIMIT 1;
      v_points_earned := v_bid_amount;
    ELSIF v_buzzer_type = 'HIDDEN' THEN
      -- Hidden: only the fastest player gets points
      SELECT EXISTS (
        SELECT 1 FROM (
          SELECT (elem->>'user_id')::uuid AS user_id FROM jsonb_array_elements(v_buzzer_presses) elem
          ORDER BY (elem->>'time_ms')::numeric ASC LIMIT 1
        ) fastest
        WHERE fastest.user_id = NEW.user_id
      ) INTO v_is_fastest;
      
      IF v_is_fastest THEN
        v_points_earned := floor((v_base_points + v_time_bonus) * v_multiplier);
      ELSE
        v_points_earned := 0;
      END IF;
    ELSE
      -- Default standard calculation
      v_points_earned := floor((v_base_points + v_time_bonus) * v_multiplier);
    END IF;
  ELSE
    -- Deduct points / apply penalty for incorrect answer
    IF v_buzzer_type = 'RISK' THEN
      -- Risk: Deduct full base value (-100 points)
      v_points_earned := -v_base_points;
    ELSIF v_buzzer_type = 'SAFE' THEN
      -- Safe: No penalty
      v_points_earned := 0;
    ELSIF v_buzzer_type = 'SUDDEN_DEATH' THEN
      -- Sudden Death: Wrong = -50 penalty
      v_points_earned := -50;
    ELSIF v_buzzer_type = 'AUCTION' THEN
      -- Auction: Lose the bid amount
      SELECT coalesce((elem->>'bid')::integer, 100) INTO v_bid_amount
      FROM jsonb_array_elements(v_buzzer_presses) elem
      WHERE (elem->>'user_id')::uuid = NEW.user_id
      LIMIT 1;
      v_points_earned := -v_bid_amount;
    ELSIF v_buzzer_type = 'HIDDEN' THEN
      -- Hidden: Only the fastest player gets wrong penalty
      SELECT EXISTS (
        SELECT 1 FROM (
          SELECT (elem->>'user_id')::uuid AS user_id FROM jsonb_array_elements(v_buzzer_presses) elem
          ORDER BY (elem->>'time_ms')::numeric ASC LIMIT 1
        ) fastest
        WHERE fastest.user_id = NEW.user_id
      ) INTO v_is_fastest;
      
      IF v_is_fastest THEN
        v_points_earned := -30;
      ELSE
        v_points_earned := 0;
      END IF;
    ELSE
      -- Default buzzer penalty: -30 if buzzed
      IF (v_buzzed_player_id = NEW.user_id OR v_buzzer_type = 'TEAM_RELAY' OR v_buzzer_type = 'CAPTAIN') AND v_match_mode <> 'PRACTICE' THEN
        v_points_earned := -30;
      ELSE
        v_points_earned := 0;
      END IF;
    END IF;

    -- Shield powerup cancels wrong answer penalty
    IF NEW.power_ups_used @> '"SHIELD"'::jsonb THEN
      v_points_earned := 0;
    END IF;

    -- ── Competitive Buzzer: Reset buzzer on wrong answer ───────────
    IF v_buzzer_type = 'COMPETITIVE' AND v_buzzed_player_id = NEW.user_id THEN
      UPDATE match_rounds
      SET buzzed_player_id = NULL, buzz_time_ms = NULL
      WHERE id = NEW.round_id;
    END IF;
  END IF;

  -- ── Hidden/Auction: Assign buzzed_player_id to the fastest player ────
  IF (v_buzzer_type = 'HIDDEN' OR v_buzzer_type = 'AUCTION') AND v_is_fastest THEN
    UPDATE match_rounds
    SET buzzed_player_id = NEW.user_id, buzz_time_ms = (
      SELECT (elem->>'time_ms')::numeric::bigint FROM jsonb_array_elements(v_buzzer_presses) elem
      WHERE (elem->>'user_id')::uuid = NEW.user_id LIMIT 1
    )
    WHERE id = NEW.round_id;
  END IF;

  NEW.is_correct := v_is_correct;
  NEW.points_earned := v_points_earned;
  NEW.submitted_at := now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
