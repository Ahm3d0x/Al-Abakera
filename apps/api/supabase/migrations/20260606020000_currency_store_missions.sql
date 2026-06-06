-- ============================================================
-- Mind Race — Phase 5.3 Currency, Store & Quests Migration
-- ============================================================

-- 1. Add columns to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS inventory JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS equipped JSONB NOT NULL DEFAULT '{"border": null, "effect": null, "avatar": null}'::jsonb;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS quests JSONB NOT NULL DEFAULT '{}'::jsonb;


-- 2. Quest update trigger function to compute daily/weekly tasks
CREATE OR REPLACE FUNCTION trigger_update_quests()
RETURNS TRIGGER AS $$
DECLARE
  v_stats JSONB;
  v_quests JSONB;
  v_daily_reset TIMESTAMPTZ;
  v_weekly_reset TIMESTAMPTZ;
  v_played INTEGER;
  v_won INTEGER;
  v_tot_corr INTEGER;
  v_rp_current INTEGER;
  
  -- Daily bases
  v_daily_base_played INTEGER;
  v_daily_base_correct INTEGER;
  v_daily_base_won INTEGER;
  
  -- Weekly bases
  v_weekly_base_played INTEGER;
  v_weekly_base_rp INTEGER;
  v_weekly_has_accuracy_90 BOOLEAN;
  
  -- Intermediate variables
  v_daily_list JSONB := '[]'::jsonb;
  v_weekly_list JSONB := '[]'::jsonb;
  v_q JSONB;
  v_idx INTEGER;
  v_new_progress INTEGER;
BEGIN
  -- If quests is null or empty, initialize with default quests
  IF NEW.quests IS NULL OR NEW.quests = '{}'::jsonb OR NEW.quests = 'null'::jsonb THEN
    NEW.quests := jsonb_build_object(
      'daily', jsonb_build_object(
        'resetAt', (DATE_TRUNC('day', NOW()) + INTERVAL '1 day')::text,
        'base_matches_played', coalesce((NEW.stats->>'matchesPlayed')::integer, 0),
        'base_correct_answers', coalesce((NEW.stats->>'totalCorrectAnswers')::integer, 0),
        'base_matches_won', coalesce((NEW.stats->>'matchesWon')::integer, 0),
        'quests', jsonb_build_array(
          jsonb_build_object('id', 'play_1', 'name_en', 'Daily Warmup', 'name_ar', 'الإحماء اليومي', 'progress', 0, 'target', 1, 'reward_coins', 100, 'reward_tokens', 0, 'claimed', false),
          jsonb_build_object('id', 'correct_10', 'name_en', 'Brain Gain', 'name_ar', 'كسب المعرفة', 'progress', 0, 'target', 10, 'reward_coins', 150, 'reward_tokens', 0, 'claimed', false),
          jsonb_build_object('id', 'win_2', 'name_en', 'Winner''s Circle', 'name_ar', 'دائرة النصر', 'progress', 0, 'target', 2, 'reward_coins', 200, 'reward_tokens', 0, 'claimed', false)
        )
      ),
      'weekly', jsonb_build_object(
        'resetAt', (DATE_TRUNC('week', NOW()) + INTERVAL '1 week')::text,
        'base_matches_played', coalesce((NEW.stats->>'matchesPlayed')::integer, 0),
        'base_rank_points', NEW.rank_points,
        'has_accuracy_90', false,
        'quests', jsonb_build_array(
          jsonb_build_object('id', 'play_10', 'name_en', 'Competitive Spirit', 'name_ar', 'روح المنافسة', 'progress', 0, 'target', 10, 'reward_coins', 500, 'reward_tokens', 2, 'claimed', false),
          jsonb_build_object('id', 'accuracy_90', 'name_en', 'Perfect Run', 'name_ar', 'الأداء المثالي', 'progress', 0, 'target', 1, 'reward_coins', 600, 'reward_tokens', 3, 'claimed', false),
          jsonb_build_object('id', 'rp_300', 'name_en', 'Titan Ascent', 'name_ar', 'صعود العمالقة', 'progress', 0, 'target', 300, 'reward_coins', 800, 'reward_tokens', 5, 'claimed', false)
        )
      )
    );
  END IF;

  v_quests := NEW.quests;
  v_stats := NEW.stats;
  v_played := coalesce((v_stats->>'matchesPlayed')::integer, 0);
  v_won := coalesce((v_stats->>'matchesWon')::integer, 0);
  v_tot_corr := coalesce((v_stats->>'totalCorrectAnswers')::integer, 0);
  v_rp_current := NEW.rank_points;

  -- A. Check Daily Reset
  v_daily_reset := coalesce((v_quests->'daily'->>'resetAt')::timestamptz, NOW());
  IF NOW() >= v_daily_reset THEN
    -- Reset Daily Quests
    v_quests := jsonb_set(v_quests, '{daily,resetAt}', to_jsonb((DATE_TRUNC('day', NOW()) + INTERVAL '1 day')::text));
    v_quests := jsonb_set(v_quests, '{daily,base_matches_played}', to_jsonb(v_played));
    v_quests := jsonb_set(v_quests, '{daily,base_correct_answers}', to_jsonb(v_tot_corr));
    v_quests := jsonb_set(v_quests, '{daily,base_matches_won}', to_jsonb(v_won));
    
    -- Reset daily quest progress and claimed flags
    v_daily_list := jsonb_build_array(
      jsonb_build_object('id', 'play_1', 'name_en', 'Daily Warmup', 'name_ar', 'الإحماء اليومي', 'progress', 0, 'target', 1, 'reward_coins', 100, 'reward_tokens', 0, 'claimed', false),
      jsonb_build_object('id', 'correct_10', 'name_en', 'Brain Gain', 'name_ar', 'كسب المعرفة', 'progress', 0, 'target', 10, 'reward_coins', 150, 'reward_tokens', 0, 'claimed', false),
      jsonb_build_object('id', 'win_2', 'name_en', 'Winner''s Circle', 'name_ar', 'دائرة النصر', 'progress', 0, 'target', 2, 'reward_coins', 200, 'reward_tokens', 0, 'claimed', false)
    );
    v_quests := jsonb_set(v_quests, '{daily,quests}', v_daily_list);
  END IF;

  -- B. Check Weekly Reset
  v_weekly_reset := coalesce((v_quests->'weekly'->>'resetAt')::timestamptz, NOW());
  IF NOW() >= v_weekly_reset THEN
    -- Reset Weekly Quests
    v_quests := jsonb_set(v_quests, '{weekly,resetAt}', to_jsonb((DATE_TRUNC('week', NOW()) + INTERVAL '1 week')::text));
    v_quests := jsonb_set(v_quests, '{weekly,base_matches_played}', to_jsonb(v_played));
    v_quests := jsonb_set(v_quests, '{weekly,base_rank_points}', to_jsonb(v_rp_current));
    v_quests := jsonb_set(v_quests, '{weekly,has_accuracy_90}', to_jsonb(false));
    
    -- Reset weekly quest progress and claimed flags
    v_weekly_list := jsonb_build_array(
      jsonb_build_object('id', 'play_10', 'name_en', 'Competitive Spirit', 'name_ar', 'روح المنافسة', 'progress', 0, 'target', 10, 'reward_coins', 500, 'reward_tokens', 2, 'claimed', false),
      jsonb_build_object('id', 'accuracy_90', 'name_en', 'Perfect Run', 'name_ar', 'الأداء المثالي', 'progress', 0, 'target', 1, 'reward_coins', 600, 'reward_tokens', 3, 'claimed', false),
      jsonb_build_object('id', 'rp_300', 'name_en', 'Titan Ascent', 'name_ar', 'صعود العمالقة', 'progress', 0, 'target', 300, 'reward_coins', 800, 'reward_tokens', 5, 'claimed', false)
    );
    v_quests := jsonb_set(v_quests, '{weekly,quests}', v_weekly_list);
  END IF;

  -- Refresh local variables for calculations
  v_daily_base_played := coalesce((v_quests->'daily'->>'base_matches_played')::integer, 0);
  v_daily_base_correct := coalesce((v_quests->'daily'->>'base_correct_answers')::integer, 0);
  v_daily_base_won := coalesce((v_quests->'daily'->>'base_matches_won')::integer, 0);

  v_weekly_base_played := coalesce((v_quests->'weekly'->>'base_matches_played')::integer, 0);
  v_weekly_base_rp := coalesce((v_quests->'weekly'->>'base_rank_points')::integer, 0);
  v_weekly_has_accuracy_90 := coalesce((v_quests->'weekly'->>'has_accuracy_90')::boolean, false);

  -- C. Check for weekly accuracy_90 flag
  IF coalesce((NEW.stats->>'has_accuracy_90_weekly')::boolean, false) = true THEN
    v_quests := jsonb_set(v_quests, '{weekly,has_accuracy_90}', to_jsonb(true));
    v_weekly_has_accuracy_90 := true;
  END IF;

  -- D. Update Daily Quests Progress
  v_daily_list := v_quests->'daily'->'quests';
  IF v_daily_list IS NOT NULL AND jsonb_typeof(v_daily_list) = 'array' THEN
    FOR v_idx IN 0 .. jsonb_array_length(v_daily_list) - 1 LOOP
      v_q := v_daily_list->v_idx;
      IF v_q->>'id' = 'play_1' THEN
        v_new_progress := greatest(0, least(1, v_played - v_daily_base_played));
        v_q := jsonb_set(v_q, '{progress}', to_jsonb(v_new_progress));
      ELSIF v_q->>'id' = 'correct_10' THEN
        v_new_progress := greatest(0, least(10, v_tot_corr - v_daily_base_correct));
        v_q := jsonb_set(v_q, '{progress}', to_jsonb(v_new_progress));
      ELSIF v_q->>'id' = 'win_2' THEN
        v_new_progress := greatest(0, least(2, v_won - v_daily_base_won));
        v_q := jsonb_set(v_q, '{progress}', to_jsonb(v_new_progress));
      END IF;
      v_daily_list := jsonb_set(v_daily_list, array_to_json(array[v_idx])::text[], v_q);
    END LOOP;
    v_quests := jsonb_set(v_quests, '{daily,quests}', v_daily_list);
  END IF;

  -- E. Update Weekly Quests Progress
  v_weekly_list := v_quests->'weekly'->'quests';
  IF v_weekly_list IS NOT NULL AND jsonb_typeof(v_weekly_list) = 'array' THEN
    FOR v_idx IN 0 .. jsonb_array_length(v_weekly_list) - 1 LOOP
      v_q := v_weekly_list->v_idx;
      IF v_q->>'id' = 'play_10' THEN
        v_new_progress := greatest(0, least(10, v_played - v_weekly_base_played));
        v_q := jsonb_set(v_q, '{progress}', to_jsonb(v_new_progress));
      ELSIF v_q->>'id' = 'accuracy_90' THEN
        v_new_progress := CASE WHEN v_weekly_has_accuracy_90 THEN 1 ELSE 0 END;
        v_q := jsonb_set(v_q, '{progress}', to_jsonb(v_new_progress));
      ELSIF v_q->>'id' = 'rp_300' THEN
        v_new_progress := greatest(0, least(300, v_rp_current - v_weekly_base_rp));
        v_q := jsonb_set(v_q, '{progress}', to_jsonb(v_new_progress));
      END IF;
      v_weekly_list := jsonb_set(v_weekly_list, array_to_json(array[v_idx])::text[], v_q);
    END LOOP;
    v_quests := jsonb_set(v_quests, '{weekly,quests}', v_weekly_list);
  END IF;

  NEW.quests := v_quests;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_quests ON profiles;
CREATE TRIGGER trg_update_quests
  BEFORE INSERT OR UPDATE OF stats, rank_points ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_quests();


-- 3. Redefine handle_match_ended to set has_accuracy_90_weekly in stats
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

  -- Badge specific variables
  v_absolute_fastest_ms integer;
  v_science_correct integer;
  v_history_correct integer;
  v_consecutive_wins integer;
  v_captain_wins integer;
  v_tot_science_correct integer;
  v_tot_history_correct integer;
  v_has_accuracy_90_weekly boolean;
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

  -- D. Pre-calculate absolute fastest correct answer in the match among all correct answers
  SELECT coalesce(min(ra.time_spent_ms), 0) INTO v_absolute_fastest_ms
  FROM match_rounds mr
  JOIN round_answers ra ON ra.round_id = mr.id
  WHERE mr.match_id = NEW.id AND ra.is_correct = TRUE;

  -- E. Loop through all active room participants to compute stats, insert logs, and update profiles
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

    -- Gather category-specific correct counts in this match
    SELECT coalesce(count(*), 0) INTO v_science_correct
    FROM match_rounds mr
    JOIN round_answers ra ON ra.round_id = mr.id
    JOIN questions q ON q.id = mr.question_id
    WHERE mr.match_id = NEW.id AND ra.user_id = v_rec.user_id AND ra.is_correct = TRUE AND q.category = 'Science';

    SELECT coalesce(count(*), 0) INTO v_history_correct
    FROM match_rounds mr
    JOIN round_answers ra ON ra.round_id = mr.id
    JOIN questions q ON q.id = mr.question_id
    WHERE mr.match_id = NEW.id AND ra.user_id = v_rec.user_id AND ra.is_correct = TRUE AND q.category = 'History';

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
      
      -- Calculate consecutive wins
      v_consecutive_wins := coalesce((v_stats->>'consecutiveWins')::integer, 0);
      IF v_is_winner THEN
        v_consecutive_wins := v_consecutive_wins + 1;
      ELSE
        v_consecutive_wins := 0;
      END IF;

      -- Calculate captain wins (wins where is_host is true)
      v_captain_wins := coalesce((v_stats->>'captainWins')::integer, 0);
      DECLARE
        v_was_host boolean := false;
      BEGIN
        SELECT is_host INTO v_was_host 
        FROM room_participants 
        WHERE room_id = NEW.room_id AND user_id = v_rec.user_id;
        
        IF v_is_winner AND coalesce(v_was_host, false) THEN
          v_captain_wins := v_captain_wins + 1;
        END IF;
      END;

      -- Calculate category counts
      v_tot_science_correct := coalesce((v_stats->>'correct_Science')::integer, 0) + v_science_correct;
      v_tot_history_correct := coalesce((v_stats->>'correct_History')::integer, 0) + v_history_correct;

      -- Check accuracy_90 weekly trigger condition
      v_has_accuracy_90_weekly := coalesce((v_stats->>'has_accuracy_90_weekly')::boolean, false) OR (
        (v_correct_count + v_incorrect_count) >= 20 AND (v_correct_count::numeric / (v_correct_count + v_incorrect_count)) >= 0.9
      );

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
        'tournamentCount', v_stats->'tournamentCount',
        'consecutiveWins', v_consecutive_wins,
        'captainWins', v_captain_wins,
        'correct_Science', v_tot_science_correct,
        'correct_History', v_tot_history_correct,
        'has_accuracy_90_weekly', v_has_accuracy_90_weekly
      );

      -- Update profile columns
      UPDATE profiles
      SET coins = coins + v_coins_earned,
          rank_points = greatest(0, rank_points + v_rank_change),
          stats = v_new_stats
      WHERE id = v_rec.user_id;

      -- Award match-specific badges:
      -- 1. Speed Demon (if fastest correct answer in the match)
      IF v_fastest_answer_ms > 0 AND v_fastest_answer_ms = v_absolute_fastest_ms THEN
        PERFORM award_badge_if_not_earned(v_rec.user_id, 'speed_demon');
      END IF;

      -- 2. Sharpshooter (accuracy >= 90% in 20+ question match)
      IF (v_correct_count + v_incorrect_count) >= 20 AND (v_correct_count::numeric / (v_correct_count + v_incorrect_count)) >= 0.9 THEN
        PERFORM award_badge_if_not_earned(v_rec.user_id, 'sharpshooter');
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
