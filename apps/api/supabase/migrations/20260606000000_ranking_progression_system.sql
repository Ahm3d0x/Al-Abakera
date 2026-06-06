-- ============================================================
-- Mind Race — Phase 5.1 Progression & Ranking System Migration
-- ============================================================

-- 1. Helper function to map rank points to the 10-tier ranking ladder
CREATE OR REPLACE FUNCTION calculate_rank_tier(p_points INTEGER)
RETURNS rank_tier AS $$
BEGIN
  IF p_points >= 9000 THEN RETURN 'Titan'::rank_tier;
  ELSIF p_points >= 8000 THEN RETURN 'Mythic'::rank_tier;
  ELSIF p_points >= 7000 THEN RETURN 'Legend'::rank_tier;
  ELSIF p_points >= 6000 THEN RETURN 'Grand Master'::rank_tier;
  ELSIF p_points >= 5000 THEN RETURN 'Master'::rank_tier;
  ELSIF p_points >= 4000 THEN RETURN 'Diamond'::rank_tier;
  ELSIF p_points >= 3000 THEN RETURN 'Platinum'::rank_tier;
  ELSIF p_points >= 2000 THEN RETURN 'Gold'::rank_tier;
  ELSIF p_points >= 1000 THEN RETURN 'Silver'::rank_tier;
  ELSE RETURN 'Bronze'::rank_tier;
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- 2. Trigger on profiles table to keep rank in sync with rank_points
CREATE OR REPLACE FUNCTION trigger_sync_profile_rank()
RETURNS TRIGGER AS $$
BEGIN
  NEW.rank := calculate_rank_tier(NEW.rank_points);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_profile_rank ON profiles;
CREATE TRIGGER trg_sync_profile_rank
  BEFORE INSERT OR UPDATE OF rank_points ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION trigger_sync_profile_rank();


-- 3. Match ended trigger to populate match_participants, calculate rewards, and update profiles + stats
CREATE OR REPLACE FUNCTION handle_match_ended()
RETURNS TRIGGER AS $$
DECLARE
  v_mode text;
  v_rec record;
  v_correct_count integer;
  v_incorrect_count integer;
  v_fastest_answer_ms integer;
  v_player_score integer;
  
  -- MVP tracking
  v_max_score integer := -1;
  v_mvp_user_id uuid;
  v_mvp_fastest_avg numeric := 999999;
  
  -- Placement details for Free For All
  v_player_count integer;
  v_rank_pos integer;
  
  -- Team details for Team Battle
  v_team_a_score integer := 0;
  v_team_b_score integer := 0;
  v_winner_team text;
  
  -- Rewards variables
  v_rank_change integer;
  v_coins_earned integer;
  
  -- User profile and stats update variables
  v_profile record;
  v_stats jsonb;
  v_played integer;
  v_won integer;
  v_win_rate numeric;
  v_tot_ans integer;
  v_tot_corr integer;
  v_corr_rate numeric;
  v_prev_questions integer;
  v_prev_avg numeric;
  v_current_total_time bigint;
  v_new_avg numeric;
  v_prev_fastest integer;
  v_new_fastest integer;
  v_new_stats jsonb;
  v_is_winner boolean;
BEGIN
  -- We only process matches transitioning to ENDED
  IF NEW.status <> 'ENDED' OR (OLD.status IS NOT NULL AND OLD.status = 'ENDED') THEN
    RETURN NEW;
  END IF;

  v_mode := NEW.mode::text;

  -- A. Pre-calculate Team Battle scores if mode is TEAM_BATTLE
  IF v_mode = 'TEAM_BATTLE' THEN
    SELECT coalesce(sum(score), 0) INTO v_team_a_score 
    FROM room_participants 
    WHERE room_id = NEW.room_id AND team_id = 'team_a' AND is_spectator = FALSE;

    SELECT coalesce(sum(score), 0) INTO v_team_b_score 
    FROM room_participants 
    WHERE room_id = NEW.room_id AND team_id = 'team_b' AND is_spectator = FALSE;

    IF v_team_a_score > v_team_b_score THEN
      v_winner_team := 'team_a';
    ELSIF v_team_b_score > v_team_a_score THEN
      v_winner_team := 'team_b';
    ELSE
      v_winner_team := 'tie';
    END IF;
  END IF;

  -- B. Pre-calculate MVP (highest score + fastest avg speed tiebreaker)
  FOR v_rec IN 
    SELECT user_id, score 
    FROM room_participants 
    WHERE room_id = NEW.room_id AND is_spectator = FALSE
  LOOP
    DECLARE
      v_avg_time numeric;
    BEGIN
      SELECT coalesce(avg(ra.time_spent_ms), 0) INTO v_avg_time
      FROM match_rounds mr
      JOIN round_answers ra ON ra.round_id = mr.id
      WHERE mr.match_id = NEW.id AND ra.user_id = v_rec.user_id;

      IF v_rec.score > v_max_score THEN
        v_max_score := v_rec.score;
        v_mvp_user_id := v_rec.user_id;
        v_mvp_fastest_avg := v_avg_time;
      ELSIF v_rec.score = v_max_score AND v_avg_time < v_mvp_fastest_avg THEN
        v_mvp_user_id := v_rec.user_id;
        v_mvp_fastest_avg := v_avg_time;
      END IF;
    END;
  END LOOP;

  -- C. Get player count for FFA ranking
  SELECT count(*) INTO v_player_count
  FROM room_participants
  WHERE room_id = NEW.room_id AND is_spectator = FALSE;

  -- D. Loop through all active room participants to compute stats, insert logs, and update profiles
  FOR v_rec IN 
    SELECT user_id, team_id, score 
    FROM room_participants 
    WHERE room_id = NEW.room_id AND is_spectator = FALSE
  LOOP
    -- 1. Gather stats from round answers
    SELECT 
      coalesce(count(*) FILTER (WHERE ra.is_correct = TRUE), 0),
      coalesce(count(*) FILTER (WHERE ra.is_correct = FALSE), 0),
      coalesce(min(ra.time_spent_ms) FILTER (WHERE ra.is_correct = TRUE), 0)
    INTO v_correct_count, v_incorrect_count, v_fastest_answer_ms
    FROM match_rounds mr
    JOIN round_answers ra ON ra.round_id = mr.id
    WHERE mr.match_id = NEW.id AND ra.user_id = v_rec.user_id;

    -- 2. Determine rewards and win status depending on GameMode
    v_is_winner := FALSE;
    v_rank_change := 0;
    v_coins_earned := 0;

    IF v_mode = 'TEAM_BATTLE' THEN
      IF v_winner_team = 'tie' THEN
        v_rank_change := 10;
        v_coins_earned := 15 + floor(v_rec.score / 10);
      ELSIF v_rec.team_id = v_winner_team THEN
        v_is_winner := TRUE;
        v_rank_change := 50;
        v_coins_earned := 30 + floor(v_rec.score / 10);
      ELSE
        v_rank_change := -30;
        v_coins_earned := 5 + floor(v_rec.score / 10);
      END IF;

    ELSIF v_mode = 'FREE_FOR_ALL' THEN
      -- Find player placement position by score rank (1-indexed)
      SELECT rnk INTO v_rank_pos FROM (
        SELECT user_id, row_number() OVER (ORDER BY score DESC) as rnk
        FROM room_participants
        WHERE room_id = NEW.room_id AND is_spectator = FALSE
      ) t WHERE t.user_id = v_rec.user_id;

      IF v_rank_pos = 1 THEN
        v_is_winner := TRUE;
        v_rank_change := 50;
        v_coins_earned := 40 + floor(v_rec.score / 10);
      ELSIF v_rank_pos = 2 AND v_player_count > 2 THEN
        v_is_winner := TRUE; -- count 2nd place as victory if > 2 players
        v_rank_change := 30;
        v_coins_earned := 25 + floor(v_rec.score / 10);
      ELSIF v_rank_pos = v_player_count THEN
        v_rank_change := -30;
        v_coins_earned := 5 + floor(v_rec.score / 10);
      ELSE
        -- Middle placement distribution
        IF v_rank_pos::numeric <= (v_player_count::numeric / 2.0) THEN
          v_rank_change := 15;
          v_coins_earned := 15 + floor(v_rec.score / 10);
        ELSE
          v_rank_change := -15;
          v_coins_earned := 8 + floor(v_rec.score / 10);
        END IF;
      END IF;

    ELSE
      -- Solo or custom challenge modes
      v_is_winner := (v_correct_count::numeric / greatest(1, v_correct_count + v_incorrect_count)::numeric) >= 0.5;
      IF v_mode = 'TIMED_CHALLENGE' OR v_mode = 'DAILY_CHALLENGE' THEN
        v_rank_change := NEW.config->'roundsCount'::text::integer * 10; -- score based gain
        v_coins_earned := 20 + floor(v_rec.score / 10);
        IF v_mode = 'DAILY_CHALLENGE' THEN
          v_coins_earned := v_coins_earned + 50; -- daily challenge bonus
        END IF;
      ELSIF v_mode = 'SURVIVAL' THEN
        v_rank_change := v_rec.score * 5;
        v_coins_earned := v_rec.score * 2;
      ELSE
        -- Practice mode
        v_rank_change := 0;
        v_coins_earned := floor(v_rec.score / 20);
      END IF;
    END IF;

    -- Add extra coins if MVP
    IF v_rec.user_id = v_mvp_user_id THEN
      v_coins_earned := v_coins_earned + 15;
    END IF;

    -- 3. Write record to match_participants log table
    INSERT INTO match_participants (
      match_id, user_id, team_id, score, 
      correct_count, incorrect_count, fastest_answer_ms, 
      is_mvp, rank_change, coins_earned, tokens_earned
    ) VALUES (
      NEW.id, v_rec.user_id, v_rec.team_id, v_rec.score,
      v_correct_count, v_incorrect_count, v_fastest_answer_ms,
      (v_rec.user_id = v_mvp_user_id), v_rank_change, v_coins_earned, 0
    ) ON CONFLICT (match_id, user_id) DO NOTHING;

    -- 4. Safely recalculate player stats JSONB
    SELECT * INTO v_profile FROM profiles WHERE id = v_rec.user_id;
    IF v_profile.id IS NOT NULL THEN
      v_stats := v_profile.stats;
      v_played := coalesce((v_stats->>'matchesPlayed')::integer, 0) + 1;
      v_won := coalesce((v_stats->>'matchesWon')::integer, 0) + (CASE WHEN v_is_winner THEN 1 ELSE 0 END);
      v_win_rate := (v_won::numeric / v_played::numeric) * 100.0;
      
      v_tot_ans := coalesce((v_stats->>'totalQuestionsAnswered')::integer, 0) + v_correct_count + v_incorrect_count;
      v_tot_corr := coalesce((v_stats->>'totalCorrectAnswers')::integer, 0) + v_correct_count;
      v_corr_rate := CASE WHEN v_tot_ans > 0 THEN (v_tot_corr::numeric / v_tot_ans::numeric) * 100.0 ELSE 0.0 END;
      
      v_prev_questions := coalesce((v_stats->>'totalQuestionsAnswered')::integer, 0);
      v_prev_avg := coalesce((v_stats->>'averageAnswerTimeMs')::numeric, 0.0);
      
      SELECT coalesce(sum(time_spent_ms), 0) INTO v_current_total_time
      FROM match_rounds mr
      JOIN round_answers ra ON ra.round_id = mr.id
      WHERE mr.match_id = NEW.id AND ra.user_id = v_rec.user_id;
      
      v_new_avg := CASE WHEN v_tot_ans > 0 THEN (v_prev_avg * v_prev_questions + v_current_total_time) / v_tot_ans ELSE 0.0 END;
      
      v_prev_fastest := (v_stats->>'fastestAnswerMs')::integer;
      v_new_fastest := CASE 
        WHEN v_prev_fastest IS NULL OR v_prev_fastest = 0 THEN v_fastest_answer_ms
        WHEN v_fastest_answer_ms IS NULL OR v_fastest_answer_ms = 0 THEN v_prev_fastest
        ELSE least(v_prev_fastest, v_fastest_answer_ms)
      END;

      -- Construct updated stats object
      v_new_stats := jsonb_build_object(
        'matchesPlayed', v_played,
        'matchesWon', v_won,
        'winRate', round(v_win_rate, 2),
        'totalQuestionsAnswered', v_tot_ans,
        'totalCorrectAnswers', v_tot_corr,
        'correctAnswersRate', round(v_corr_rate, 2),
        'averageAnswerTimeMs', round(v_new_avg, 2),
        'fastestAnswerMs', v_new_fastest,
        'bestCategory', v_stats->'bestCategory',
        'worstCategory', v_stats->'worstCategory',
        'tournamentCount', v_stats->'tournamentCount'
      );

      -- Update profile columns
      UPDATE profiles
      SET coins = coins + v_coins_earned,
          rank_points = greatest(0, rank_points + v_rank_change),
          stats = v_new_stats
      WHERE id = v_rec.user_id;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_on_match_ended ON matches;
CREATE TRIGGER trg_on_match_ended
  AFTER UPDATE OF status ON matches
  FOR EACH ROW
  EXECUTE FUNCTION handle_match_ended();


-- 4. Apply rank decay rules function (exposing admin trigger option)
CREATE OR REPLACE FUNCTION apply_rank_decay()
RETURNS VOID AS $$
DECLARE
  v_rec record;
  v_last_played timestamptz;
  v_decay_points integer;
BEGIN
  FOR v_rec IN 
    SELECT id, rank, rank_points 
    FROM profiles 
    WHERE rank IN ('Master', 'Grand Master', 'Legend', 'Mythic', 'Titan')
  LOOP
    -- Find latest match ended_at for this player
    SELECT max(m.ended_at) INTO v_last_played
    FROM match_participants mp
    JOIN matches m ON m.id = mp.match_id
    WHERE mp.user_id = v_rec.id AND m.status = 'ENDED';
    
    -- If they never played a match, check profile creation date
    IF v_last_played IS NULL THEN
      SELECT created_at INTO v_last_played FROM profiles WHERE id = v_rec.id;
    END IF;
    
    -- If inactive for more than 7 days, apply decay
    IF v_last_played IS NULL OR v_last_played < NOW() - INTERVAL '7 days' THEN
      IF v_rec.rank = 'Titan' THEN v_decay_points := 100;
      ELSIF v_rec.rank IN ('Mythic', 'Legend') THEN v_decay_points := 50;
      ELSE v_decay_points := 25;
      END IF;
      
      UPDATE profiles
      SET rank_points = greatest(0, rank_points - v_decay_points)
      WHERE id = v_rec.id;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
