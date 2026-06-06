-- ==========================================
-- Mind Race — Performance & Scalability Indexes
-- ==========================================

-- 1. Rooms Indexing (Matchmaking and Joining)
CREATE INDEX IF NOT EXISTS idx_rooms_status ON public.rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_code ON public.rooms(code);
CREATE INDEX IF NOT EXISTS idx_room_participants_room_user ON public.room_participants(room_id, user_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_user ON public.room_participants(user_id);

-- 2. Matches & Game Rounds Indexing (Gameplay Sync)
CREATE INDEX IF NOT EXISTS idx_matches_room_status ON public.matches(room_id, status);
CREATE INDEX IF NOT EXISTS idx_match_rounds_match_number ON public.match_rounds(match_id, round_number);
CREATE INDEX IF NOT EXISTS idx_round_answers_round_user ON public.round_answers(round_id, user_id);

-- 3. Profiles Indexing (Leaderboards and Audit Sorting)
CREATE INDEX IF NOT EXISTS idx_profiles_rank_points_desc ON public.profiles(rank_points DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_created_at_desc ON public.profiles(created_at DESC);
