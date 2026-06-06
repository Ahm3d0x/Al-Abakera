// Core type definitions for Mind Race

// ==========================================
// 1. User Definitions
// ==========================================
export type RankTier =
  | 'Bronze'
  | 'Silver'
  | 'Gold'
  | 'Platinum'
  | 'Diamond'
  | 'Master'
  | 'Grand Master'
  | 'Legend'
  | 'Mythic'
  | 'Titan';

export interface UserStats {
  winRate: number;
  correctAnswersRate: number;
  bestCategory: string | null;
  worstCategory: string | null;
  averageAnswerTimeMs: number;
  fastestAnswerMs: number;
  tournamentCount: number;
  matchesPlayed: number;
  matchesWon: number;
  totalQuestionsAnswered: number;
  totalCorrectAnswers: number;
}

export interface User {
  id: string;
  username: string;
  email: string;
  rank: RankTier;
  rankPoints: number;
  coins: number;
  creatorTokens: number;
  stats: UserStats;
  avatarUrl: string | null;
  badges: string[];
  inventory?: string[];
  equipped?: {
    border: string | null;
    effect: string | null;
    avatar: string | null;
  };
  quests?: any;
  claimedSeasonRewards?: string[];
  createdAt: Date;
  updatedAt: Date;
  isAdmin?: boolean;
}

// ==========================================
// 2. Question Definitions
// ==========================================
export type QuestionType =
  | 'MULTIPLE_CHOICE'
  | 'TRUE_FALSE'
  | 'IMAGE_QUESTION'
  | 'ORDERING_QUESTION'
  | 'MATCHING_QUESTION'
  | 'FILL_IN_THE_BLANK'
  | 'MULTI_SELECT'
  | 'CALCULATION_QUESTION'
  | 'CIRCUIT_QUESTION'
  | 'CODING_QUESTION'
  | 'SHORT_ANSWER';

export interface LocalizedText {
  ar: string;
  en: string;
}

export interface QuestionOption {
  id: string;
  text: LocalizedText;
  imageUrl?: string;
}

export interface MatchingPair {
  leftId: string;
  leftText: LocalizedText;
  rightId: string;
  rightText: LocalizedText;
}

export interface Question {
  id: string;
  type: QuestionType;
  category: string;
  body: LocalizedText;
  imageUrl?: string; // Used for IMAGE_QUESTION or general illustration
  options?: QuestionOption[]; // Used for MULTIPLE_CHOICE, MULTI_SELECT
  correctAnswer?: string | string[]; // For single answer, true/false, fill-in-the-blank, multi-select (array of IDs)
  orderingItems?: string[]; // Correct ordered sequence (IDs or text)
  matchingPairs?: MatchingPair[]; // For MATCHING_QUESTION
  codingTestCases?: { input: string; output: string }[]; // For CODING_QUESTION
  difficulty: 'Easy' | 'Medium' | 'Hard';
  rating: number; // 5-star rating system (0-5)
  explanation?: LocalizedText;
  createdAt: Date;
}

// ==========================================
// 3. Game Mode & Room Definitions
// ==========================================
export type RoomType = 'PUBLIC' | 'PRIVATE' | 'INVITE_ONLY' | 'SPECTATOR_ONLY';
export type RoomStatus = 'WAITING' | 'ACTIVE' | 'ENDED';

export type BuzzerType =
  | 'STANDARD'
  | 'RISK'
  | 'SAFE'
  | 'COMPETITIVE'
  | 'SUDDEN_DEATH'
  | 'TEAM_RELAY'
  | 'CAPTAIN'
  | 'HIDDEN'
  | 'AUCTION'
  | 'TEAM_CONSULTATION'
  | 'OPEN_DISCUSSION';

export type GameModeType =
  | 'PRACTICE'
  | 'TIMED_CHALLENGE'
  | 'SURVIVAL'
  | 'DAILY_CHALLENGE'
  | 'TEAM_BATTLE'
  | 'FREE_FOR_ALL';

export interface RoomConfig {
  mode: GameModeType;
  maxPlayers: number;
  roundsCount: number;
  questionTimeLimitSeconds: number;
  buzzerType: BuzzerType;
  allowedPowerUps: PowerUpType[];
  categoryWeights: { [category: string]: number }; // percentage weight sum to 100
  judgeId?: string | null;
}

export interface Participant {
  userId: string;
  username: string;
  avatarUrl: string | null;
  rank: string;
  score: number;
  isHost: boolean;
  isReady: boolean;
  teamId: string | null; // For TEAM_BATTLE
  isSpectator: boolean;
  isOnline?: boolean; // For reconnection grace period tracking
}

export interface Room {
  id: string;
  code: string; // short join code
  hostId: string;
  type: RoomType;
  status: RoomStatus;
  config: RoomConfig;
  participants: Participant[];
  currentRound: number;
  createdAt: Date;
}

// ==========================================
// 4. Power-Up Definitions
// ==========================================
export type PowerUpType =
  | 'JOKER' // double question value
  | 'FREEZE' // freeze opponent's timer
  | 'SHIELD' // cancel incoming penalty
  | 'REVEAL_HINT' // show a hint
  | 'DOUBLE_CHANCE' // one extra attempt
  | 'STEAL' // steal opponent's question
  | 'TIME_BOOST' // add time to own timer
  | 'POINT_MULTIPLIER' // multiply round points
  | 'CATEGORY_SWAP' // swap question category
  | 'SKIP_QUESTION' // skip current question
  | 'BLOCK_POWER_UP'; // prevent opponent from using a power-up

export interface PowerUp {
  id: string;
  type: PowerUpType;
  name: string;
  description: string;
  coinCost: number;
}

// ==========================================
// 5. Match & Live Session State
// ==========================================
export interface MatchRound {
  roundNumber: number;
  questionId: string;
  buzzedPlayerId: string | null;
  buzzTimeMs: number | null;
  answers: {
    [userId: string]: {
      answer: any;
      timeSpentMs: number;
      isCorrect: boolean;
      pointsEarned: number;
    };
  };
  endedAt: Date | null;
}

export interface MatchSession {
  id: string;
  roomId: string;
  config: RoomConfig;
  status: RoomStatus;
  currentRound: number;
  rounds: MatchRound[];
  participants: {
    [userId: string]: {
      score: number;
      correctCount: number;
      incorrectCount: number;
    };
  };
  startedAt: Date;
  endedAt: Date | null;
}

// ==========================================
// 6. WebSocket Socket.io Event Channels
// ==========================================
export const GameEvents = {
  // Connection / Lobby Events
  JOIN_ROOM: 'room:join',
  LEAVE_ROOM: 'room:leave',
  PLAYER_JOINED: 'room:player_joined',
  PLAYER_LEFT: 'room:player_left',
  PLAYER_READY: 'room:player_ready',
  ROOM_STATE_CHANGE: 'room:state_change',

  // Game Play Lifecycle
  START_GAME: 'game:start',
  ROUND_START: 'game:round_start',
  QUESTION_DELIVERED: 'game:question_delivered',
  BUZZ: 'game:buzz',
  BUZZED: 'game:buzzed',
  SUBMIT_ANSWER: 'game:submit_answer',
  ROUND_ENDED: 'game:round_ended',
  USE_POWER_UP: 'game:use_power_up',
  POWER_UP_TRIGGERED: 'game:power_up_triggered',

  // Real-time Chat
  SEND_MESSAGE: 'chat:send',
  RECEIVE_MESSAGE: 'chat:receive',

  // Tournaments
  TOURNAMENT_UPDATE: 'tournament:update',

  // Streamer Mode (Audience Participation)
  SUBMIT_AUDIENCE_ANSWER: 'game:submit_audience_answer',
  AUDIENCE_ANSWER_GRADED: 'game:audience_answer_graded',
  AUDIENCE_LEADERBOARD: 'game:audience_leaderboard',
} as const;

// ==========================================
// 7. Answer Submission & Grading Structures
// ==========================================
export interface AnswerSubmission {
  questionId: string;
  answer: any; // polymorphic payload depending on QuestionType
  timeSpentMs: number;
}

export interface GradingResult {
  isCorrect: boolean;
  score: number;
  explanation?: string | LocalizedText;
  correctAnswer?: any; // returned only in practice or post-round contexts
}

// ==========================================
// 8. Tournament Definitions
// ==========================================
export type TournamentFormat = 'KNOCKOUT' | 'DOUBLE_ELIMINATION' | 'LEAGUE' | 'SWISS';
export type TournamentStatus = 'REGISTRATION' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface TournamentMatchup {
  id: string; // matchupId e.g. "w1m1"
  p1: string | null; // userId
  p2: string | null; // userId
  p1Username?: string;
  p2Username?: string;
  winner: string | null; // winner userId
  matchId: string | null; // room UUID
  roomCode?: string; // room short code
  status: 'WAITING' | 'READY' | 'PLAYING' | 'COMPLETED';
  sourceMatchups?: string[]; // source matchup IDs
  sourceLosers?: string[]; // double elimination: losers source
  roundNumber: number;
}

export interface TournamentRound {
  roundNumber: number;
  name: string;
  matchups: TournamentMatchup[];
}

export interface Tournament {
  id: string;
  name: string;
  description: string | null;
  format: TournamentFormat;
  status: TournamentStatus;
  bracketSize: number;
  bracket: TournamentRound[];
  maxTeamSize: number;
  entryFeeCoins: number;
  entryFeeTokens: number;
  prizePool: {
    first_place_tokens?: number;
    second_place_tokens?: number;
    [key: string]: any;
  };
  seasonId: string | null;
  createdBy: string | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TournamentParticipant {
  id: string;
  tournamentId: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  rank: string;
  teamName: string | null;
  seed: number | null;
  isEliminated: boolean;
  wins: number;
  losses: number;
  registeredAt: string;
}

// ==========================================
// 9. Question Packs Definitions
// ==========================================
export interface QuestionPack {
  id: string;
  title: LocalizedText;
  description: LocalizedText | null;
  category: 'Science' | 'Math' | 'Electronics' | 'Programming' | 'Custom';
  isPublic: boolean;
  creatorId: string;
  creatorUsername?: string;
  ratingAvg: number;
  ratingCount: number;
  defaultLanguage?: 'ar' | 'en';
  version?: number;
  tags?: string[];
  metadata?: {
    question_count?: number;
    easy?: number;
    medium?: number;
    hard?: number;
    estimated_time?: number;
    [key: string]: any;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuestionPackItem {
  packId: string;
  questionId: string;
}

export interface QuestionPackReview {
  id: string;
  packId: string;
  userId: string;
  username?: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
}



