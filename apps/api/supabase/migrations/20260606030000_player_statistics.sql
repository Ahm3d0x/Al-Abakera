-- ============================================================
-- Mind Race — Phase 5.4 Player Statistics & Leaderboards Migration
-- ============================================================

-- 1. Redefine handle_match_ended trigger to calculate bestCategory and worstCategory dynamically from answer history
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

  -- Dynamic best/worst category variables
  v_best_cat text;
  v_worst_cat text;
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
    ELSIF v_team_b_score > v_team_b_score THEN
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

      -- Dynamic best and worst categories calculation
      -- Best Category: Category with highest correct percentage (minimum 3 questions answered)
      SELECT q.category INTO v_best_cat
      FROM round_answers ra
      JOIN match_rounds mr ON mr.id = ra.round_id
      JOIN questions q ON q.id = mr.question_id
      WHERE ra.user_id = v_rec.user_id
      GROUP BY q.category
      HAVING count(*) >= 3
      ORDER BY (count(*) FILTER (WHERE ra.is_correct = TRUE))::numeric / count(*)::numeric DESC, count(*) DESC
      LIMIT 1;

      -- Worst Category: Category with lowest correct percentage (minimum 3 questions answered)
      SELECT q.category INTO v_worst_cat
      FROM round_answers ra
      JOIN match_rounds mr ON mr.id = ra.round_id
      JOIN questions q ON q.id = mr.question_id
      WHERE ra.user_id = v_rec.user_id
      GROUP BY q.category
      HAVING count(*) >= 3
      ORDER BY (count(*) FILTER (WHERE ra.is_correct = TRUE))::numeric / count(*)::numeric ASC, count(*) DESC
      LIMIT 1;

      -- Fallbacks if v_best_cat or v_worst_cat is null
      IF v_best_cat IS NULL THEN
        SELECT q.category INTO v_best_cat
        FROM round_answers ra
        JOIN match_rounds mr ON mr.id = ra.round_id
        JOIN questions q ON q.id = mr.question_id
        WHERE ra.user_id = v_rec.user_id
        GROUP BY q.category
        ORDER BY (count(*) FILTER (WHERE ra.is_correct = TRUE))::numeric / count(*)::numeric DESC
        LIMIT 1;
      END IF;

      IF v_worst_cat IS NULL THEN
        SELECT q.category INTO v_worst_cat
        FROM round_answers ra
        JOIN match_rounds mr ON mr.id = ra.round_id
        JOIN questions q ON q.id = mr.question_id
        WHERE ra.user_id = v_rec.user_id
        GROUP BY q.category
        ORDER BY (count(*) FILTER (WHERE ra.is_correct = TRUE))::numeric / count(*)::numeric ASC
        LIMIT 1;
      END IF;

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
        'bestCategory', v_best_cat,
        'worstCategory', v_worst_cat,
        'tournamentCount', coalesce((v_stats->>'tournamentCount')::integer, 0),
        'consecutiveWins', v_consecutive_wins,
        'captainWins', v_captain_wins,
        'correct_Science', v_tot_science_correct,
        'correct_History', v_tot_history_correct,
        'bestSurvivalLevel', coalesce((v_stats->>'bestSurvivalLevel')::integer, 0),
        'dailyStreak', coalesce((v_stats->>'dailyStreak')::integer, 0),
        'lastDailyChallengeCompleted', v_stats->>'lastDailyChallengeCompleted'
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


-- 2. Create category leaderboard helper function
CREATE OR REPLACE FUNCTION get_category_leaderboard(p_category TEXT, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
  username TEXT,
  rank TEXT,
  rank_points INTEGER,
  coins INTEGER,
  stats JSONB,
  sort_value NUMERIC
) AS $$
BEGIN
  IF p_category = 'Science' THEN
    RETURN QUERY 
    SELECT p.username::text, p.rank::text, p.rank_points, p.coins, p.stats, 
           coalesce((p.stats->>'correct_Science')::numeric, 0) as sort_value
    FROM profiles p
    ORDER BY sort_value DESC, p.rank_points DESC
    LIMIT p_limit;
  ELSIF p_category = 'History' THEN
    RETURN QUERY 
    SELECT p.username::text, p.rank::text, p.rank_points, p.coins, p.stats, 
           coalesce((p.stats->>'correct_History')::numeric, 0) as sort_value
    FROM profiles p
    ORDER BY sort_value DESC, p.rank_points DESC
    LIMIT p_limit;
  ELSIF p_category = 'Survival' THEN
    RETURN QUERY 
    SELECT p.username::text, p.rank::text, p.rank_points, p.coins, p.stats, 
           coalesce((p.stats->>'bestSurvivalLevel')::numeric, 0) as sort_value
    FROM profiles p
    ORDER BY sort_value DESC, p.rank_points DESC
    LIMIT p_limit;
  ELSE
    -- Global (Rank Points)
    RETURN QUERY 
    SELECT p.username::text, p.rank::text, p.rank_points, p.coins, p.stats, 
           p.rank_points::numeric as sort_value
    FROM profiles p
    ORDER BY p.rank_points DESC
    LIMIT p_limit;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
