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
  createdAt: Date;
  updatedAt: Date;
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

export interface QuestionOption {
  id: string;
  text: string;
  imageUrl?: string;
}

export interface MatchingPair {
  leftId: string;
  leftText: string;
  rightId: string;
  rightText: string;
}

export interface Question {
  id: string;
  type: QuestionType;
  category: string;
  body: string;
  imageUrl?: string; // Used for IMAGE_QUESTION or general illustration
  options?: QuestionOption[]; // Used for MULTIPLE_CHOICE, MULTI_SELECT
  correctAnswer?: string | string[]; // For single answer, true/false, fill-in-the-blank, multi-select (array of IDs)
  orderingItems?: string[]; // Correct ordered sequence (IDs or text)
  matchingPairs?: MatchingPair[]; // For MATCHING_QUESTION
  codingTestCases?: { input: string; output: string }[]; // For CODING_QUESTION
  difficulty: 'Easy' | 'Medium' | 'Hard';
  rating: number; // 5-star rating system (0-5)
  explanation?: string;
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
  explanation?: string;
  correctAnswer?: any; // returned only in practice or post-round contexts
}

