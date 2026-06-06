import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { GameEvents, Question } from '@mind-race/shared';
import { requireAuth, AuthenticatedRequest } from './middleware/auth';
import { supabaseAdmin } from './lib/supabase';
import { gradeAnswer } from './lib/grading';
import questionsRouter from './routes/questions';
import roomsRouter from './routes/rooms';
import tournamentsRouter, { handleTournamentMatchCompletion } from './routes/tournaments';
import packsRouter from './routes/packs';
import storeRouter from './routes/store';
import questsRouter from './routes/quests';
import seasonsRouter from './routes/seasons';
import securityRouter, { logSecurityEvent } from './routes/security';
import adminRouter from './routes/admin';
import leaderboardRouter from './routes/leaderboard';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';


// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Helper to determine allowed origins
const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:3000',
  'http://localhost:3001',
].filter(Boolean) as string[];

const isOriginAllowed = (origin: string | undefined): boolean => {
  if (!origin) return true; // Direct requests, server-to-server
  if (allowedOrigins.includes(origin)) return true;
  // Allow Vercel preview/production deployments
  if (origin.startsWith('https://') && origin.endsWith('.vercel.app')) return true;
  // Allow any port on localhost or 127.0.0.1 for local development
  if (/^http:\/\/localhost:\d+$/.test(origin)) return true;
  if (/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) return true;
  // Allow typical local network IPs for mobile testing (e.g. 192.168.x.x)
  if (/^http:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin)) return true;
  return false;
};

// Enable CORS
app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

app.use(express.json());

// Root welcome route
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'Welcome to the Mind Race API Gateway',
    endpoints: {
      health: '/api/v1/health',
      me: '/api/v1/users/me',
      questions: '/api/v1/questions',
      rooms: '/api/v1/rooms'
    },
    version: '1.0.0'
  });
});

// Suppress favicon 404 logs
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Base health check route
app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Mind Race Core API',
  });
});

// Protected route: get current authenticated user profile
app.get('/api/v1/users/me', requireAuth as any, (req: AuthenticatedRequest, res) => {
  res.json({
    status: 'success',
    user: req.profile,
  });
});

// Register routes
app.use('/api/v1/questions', questionsRouter);
app.use('/api/v1/rooms', roomsRouter);
app.use('/api/v1/tournaments', tournamentsRouter);
app.use('/api/v1/packs', packsRouter);
app.use('/api/v1/store', storeRouter);
app.use('/api/v1/quests', questsRouter);
app.use('/api/v1/seasons', seasonsRouter);
app.use('/api/v1/security', securityRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/leaderboard', leaderboardRouter);

// Admin Route: Apply rank decay rules to inactive players (Master and above)
app.post('/api/v1/admin/apply-decay', async (req, res) => {
  try {
    const { error } = await supabaseAdmin.rpc('apply_rank_decay');
    if (error) {
      console.error('[Admin] Rank decay error:', error);
      return res.status(500).json({ status: 'error', message: error.message });
    }
    console.log('[Admin] Rank decay executed successfully');
    res.json({ status: 'success', message: 'Rank decay executed successfully.' });
  } catch (err: any) {
    console.error('[Admin] Rank decay exception:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Create HTTP server and initialize socket.io
const httpServer = createServer(app);
export const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Configure Redis pub/sub Socket.io adapter if REDIS_URL is provided
const redisUrl = process.env.REDIS_URL;
if (redisUrl) {
  try {
    const pubClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      retryStrategy: () => null,
    });

    pubClient.on('error', (err) => {
      console.warn('[Socket Redis] Pub client connection failed/offline:', err.message || err);
    });

    pubClient.on('ready', () => {
      try {
        const subClient = pubClient.duplicate();
        subClient.on('error', (err) => {
          console.warn('[Socket Redis] Sub client warning:', err.message || err);
        });
        io.adapter(createAdapter(pubClient, subClient));
        console.log('[Socket Redis] Redis Adapter configured successfully for Socket.io scaling.');
      } catch (adapterErr: any) {
        console.warn('[Socket Redis] Failed to attach adapter:', adapterErr.message || adapterErr);
      }
    });
  } catch (err: any) {
    console.warn('[Socket Redis] Failed to initialize Redis clients:', err.message || err);
  }
} else {
  console.log('[Socket Redis] No REDIS_URL provided. Using in-memory Socket.io adapter.');
}

// ==========================================
// Active Match Session Structure (In-Memory)
// ==========================================
interface ActiveMatch {
  roomId: string;
  status: 'WAITING' | 'ACTIVE' | 'ENDED';
  questions: Question[];
  currentRound: number;
  scores: { [userId: string]: number };
  buzzedPlayerId: string | null;
  timeLeft: number;
  timerInterval: NodeJS.Timeout | null;
  audienceScores?: { [userId: string]: { username: string; score: number } };
  audienceAnswers?: { [roundIndex: number]: { [userId: string]: boolean } };
  votes?: {
    [category: string]: {
      [voterId: string]: string;
    };
  };
  votingDurationLeft?: number;
  votingInterval?: NodeJS.Timeout | null;
  roundStartedAt?: number;
}

const activeMatches = new Map<string, ActiveMatch>();
app.set('io', io);
app.set('activeMatches', activeMatches);

// Grace period timers for disconnected players (userId -> timeout)
const disconnectTimers = new Map<string, NodeJS.Timeout>();

// Answer history for bot pattern analysis
const playerAnswerTimings = new Map<string, { timeSpentMs: number; submittedAt: number; answer: any }[]>();

// 10 Fallback sample questions in case database questions is empty
const BACKEND_SAMPLE_QUESTIONS: Question[] = [
  {
    id: 'q1',
    type: 'MULTIPLE_CHOICE',
    category: 'Science / العلوم',
    body: {
      en: 'Which element has the highest thermal conductivity of any natural material?',
      ar: 'أي العناصر التالية يمتلك أعلى موصلية حرارية بين المواد الطبيعية؟'
    },
    options: [
      { id: 'a', text: { en: 'Silver', ar: 'الفضة' } },
      { id: 'b', text: { en: 'Copper', ar: 'النحاس' } },
      { id: 'c', text: { en: 'Diamond', ar: 'الماس' } },
      { id: 'd', text: { en: 'Gold', ar: 'الذهب' } }
    ],
    difficulty: 'Medium',
    explanation: {
      en: 'Diamond has a thermal conductivity five times higher than copper.',
      ar: 'الماس يمتلك موصلية حرارية تفوق النحاس بخمسة أضعاف.'
    },
    correctAnswer: 'c',
    rating: 4.8,
    createdAt: new Date()
  },
  {
    id: 'q2',
    type: 'TRUE_FALSE',
    category: 'Physics / الفيزياء',
    body: {
      en: 'Sound waves travel faster in water than in air.',
      ar: 'تنتقل الموجات الصوتية في الماء بسرعة أكبر من انتقالها في الهواء.'
    },
    difficulty: 'Easy',
    explanation: {
      en: 'Because water is denser than air, sound travels about 4.3 times faster in it.',
      ar: 'لأن الماء أكثر كثافة من الهواء، ينتقل الصوت فيه بسرعة أكبر بنحو 4.3 أضعاف.'
    },
    correctAnswer: 'true',
    rating: 4.5,
    createdAt: new Date()
  },
  {
    id: 'q3',
    type: 'FILL_IN_THE_BLANK',
    category: 'Math / الرياضيات',
    body: {
      en: 'What is the value of Pi rounded to two decimal places?',
      ar: 'ما هي قيمة ثابت بّاي (Pi) مقربة لعددين عشريين؟'
    },
    difficulty: 'Easy',
    explanation: {
      en: 'Pi is approximately 3.14159..., which rounds to 3.14.',
      ar: 'ثابت باي هو تقريباً 3.14159... والذي يقرب إلى 3.14.'
    },
    correctAnswer: '3.14',
    rating: 4.2,
    createdAt: new Date()
  },
  {
    id: 'q4',
    type: 'ORDERING_QUESTION',
    category: 'Astronomy / الفلك',
    body: {
      en: 'Order these planets from closest to farthest from the Sun.',
      ar: 'رتب الكواكب التالية من الأقرب إلى الأبعد عن الشمس.'
    },
    options: [
      { id: '1', text: { en: 'Venus', ar: 'الزهرة' } },
      { id: '2', text: { en: 'Mercury', ar: 'عطارد' } },
      { id: '3', text: { en: 'Mars', ar: 'المريخ' } },
      { id: '4', text: { en: 'Earth', ar: 'الأرض' } }
    ],
    difficulty: 'Medium',
    orderingItems: ['2', '1', '4', '3'],
    explanation: {
      en: 'Mercury is closest, followed by Venus, Earth, and Mars.',
      ar: 'عطارد هو الأقرب، يليه الزهرة، ثم الأرض، وأخيراً المريخ.'
    },
    rating: 4.6,
    createdAt: new Date()
  },
  {
    id: 'q5',
    type: 'MATCHING_QUESTION',
    category: 'Technology / التقنية',
    body: {
      en: 'Match the programming terms with their definitions.',
      ar: 'صل المصطلحات البرمجية بالتعريفات المناسبة لها.'
    },
    matchingPairs: [
      { leftId: 'v', leftText: { en: 'Variable', ar: 'المتغير' }, rightId: '1', rightText: { en: 'Stores data', ar: 'يخزن البيانات' } },
      { leftId: 'f', leftText: { en: 'Function', ar: 'الدالة' }, rightId: '2', rightText: { en: 'Reusable block', ar: 'كتلة برمجية يعاد استخدامها' } },
      { leftId: 'l', leftText: { en: 'Loop', ar: 'التكرار' }, rightId: '3', rightText: { en: 'Repeats instructions', ar: 'يكرر التعليمات البرمجية' } }
    ],
    difficulty: 'Medium',
    explanation: {
      en: 'Variables store data, functions are reusable blocks, and loops repeat instructions.',
      ar: 'المتغيرات تخزن البيانات، الدوال كتل يعاد استخدامها، والتكرار يكرر الأوامر.'
    },
    rating: 4.7,
    createdAt: new Date()
  }
];

// Helper to query profiles and broadcast participants to everyone in a room
async function broadcastRoomState(roomId: string) {
  try {
    const { data: participants, error } = await supabaseAdmin
      .from('room_participants')
      .select(`
        score,
        is_host,
        is_ready,
        team_id,
        is_spectator,
        user_id,
        profiles (
          username,
          avatar_url,
          rank
        )
      `)
      .eq('room_id', roomId);

    if (error || !participants) {
      console.error('[Socket] Error fetching participants for broadcast:', error);
      return;
    }

    const list = participants.map((p: any) => ({
      userId: p.user_id,
      username: p.profiles?.username || 'Player',
      avatarUrl: p.profiles?.avatar_url || null,
      rank: p.profiles?.rank || 'Bronze',
      score: p.score,
      isHost: p.is_host,
      isReady: p.is_ready,
      teamId: p.team_id,
      isSpectator: p.is_spectator
    }));

    io.to(roomId).emit(GameEvents.ROOM_STATE_CHANGE, {
      event: 'PARTICIPANTS_UPDATE',
      participants: list
    });
  } catch (err) {
    console.error('[Socket] Exception broadcasting room state:', err);
  }
}

// -------------------------------------------------------------
// Synced Multiplayer Rounds Lifecycle
// -------------------------------------------------------------
function startMatchTicker(roomId: string) {
  const match = activeMatches.get(roomId);
  if (!match) return;

  if (match.timerInterval) clearInterval(match.timerInterval);

  const rawQuestion = match.questions[match.currentRound];
  if (!rawQuestion) {
    endMatch(roomId);
    return;
  }

  // Strip answers for players
  const { correct_answer, correctAnswer, coding_test_cases, codingTestCases, ...sanitizedQuestion } = rawQuestion as any;

  match.timeLeft = 30;
  match.buzzedPlayerId = null;
  match.roundStartedAt = Date.now();

  io.to(roomId).emit('game:round_start', {
    roundIndex: match.currentRound,
    totalRounds: match.questions.length,
    question: sanitizedQuestion,
    timeLeft: match.timeLeft,
    scores: match.scores
  });

  match.timerInterval = setInterval(() => {
    match.timeLeft--;
    io.to(roomId + ':players').emit('game:tick', { timeLeft: match.timeLeft });

    if (match.timeLeft <= 0) {
      clearInterval(match.timerInterval!);
      endRound(roomId, null, false);
    }
  }, 1000);
}

async function endRound(roomId: string, userId: string | null, isCorrect: boolean) {
  const match = activeMatches.get(roomId);
  if (!match) return;

  if (match.timerInterval) clearInterval(match.timerInterval);

  const question = match.questions[match.currentRound];
  const correctAnswerVal = question.correctAnswer || question.orderingItems || question.matchingPairs;

  const audienceLeaderboard = Object.entries(match.audienceScores || {}).map(([uId, data]) => ({
    userId: uId,
    username: data.username,
    score: data.score
  })).sort((a, b) => b.score - a.score).slice(0, 10);

  io.to(roomId).emit('game:round_ended', {
    userId,
    isCorrect,
    correctAnswer: correctAnswerVal,
    explanation: question.explanation,
    scores: match.scores,
    audienceLeaderboard
  });

  setTimeout(() => {
    match.currentRound++;
    if (match.currentRound >= match.questions.length) {
      endMatch(roomId);
    } else {
      startMatchTicker(roomId);
    }
  }, 4000);
}

async function concludeVoting(roomId: string) {
  const match = activeMatches.get(roomId);
  if (!match) return;

  if (match.votingInterval) {
    clearInterval(match.votingInterval);
    match.votingInterval = null;
  }

  // Tally votes
  const tally = (category: string) => {
    const catVotes = match.votes?.[category] || {};
    const counts: Record<string, number> = {};
    for (const candidateId of Object.values(catVotes)) {
      counts[candidateId] = (counts[candidateId] || 0) + 1;
    }
    return counts;
  };

  const getWinner = (counts: Record<string, number>, list: any[]) => {
    let max = -1;
    let winnerId: string | null = null;
    for (const [candId, val] of Object.entries(counts)) {
      if (val > max) {
        max = val;
        winnerId = candId;
      }
    }
    // Fallback if no votes or tie
    if (!winnerId && list && list.length > 0) {
      const rand = list[Math.floor(Math.random() * list.length)];
      winnerId = typeof rand === 'string' ? rand : rand.id;
    }
    return winnerId;
  };

  const bpCounts = tally('best_player');
  const btCounts = tally('best_team');
  const baCounts = tally('best_answer');

  try {
    const { data: participants } = await supabaseAdmin
      .from('room_participants')
      .select(`
        user_id,
        is_spectator,
        profiles (
          username
        )
      `)
      .eq('room_id', roomId);

    const playersList = (participants || [])
      .filter((p: any) => !p.is_spectator)
      .map((p: any) => ({
        id: p.user_id,
        username: p.profiles?.username || 'Player'
      }));

    const bpWinnerId = getWinner(bpCounts, playersList);
    const btWinnerId = getWinner(btCounts, ['team_a', 'team_b']);
    const baWinnerId = getWinner(baCounts, playersList);

    const bpName = playersList.find((p: any) => p.id === bpWinnerId)?.username || null;
    const btName = btWinnerId === 'team_a' ? 'Team A' : btWinnerId === 'team_b' ? 'Team B' : null;
    const baName = playersList.find((p: any) => p.id === baWinnerId)?.username || null;

    console.log(`[Socket] Voting Concluded for room ${roomId}: MVP=${bpName}, BestTeam=${btName}, BestAns=${baName}`);

    io.to(roomId).emit('game:voting_results', {
      bestPlayer: bpName,
      bestTeam: btName,
      bestAnswer: baName
    });
  } catch (err) {
    console.error('Error concluding voting:', err);
  }

  activeMatches.delete(roomId);
}

async function endMatch(roomId: string) {
  const match = activeMatches.get(roomId);
  if (!match) return;

  if (match.timerInterval) clearInterval(match.timerInterval);

  try {
    // Save final scores to database room_participants
    for (const [uId, sc] of Object.entries(match.scores)) {
      await supabaseAdmin
        .from('room_participants')
        .update({ score: sc })
        .eq('room_id', roomId)
        .eq('user_id', uId);
    }

    // Update room status to ENDED
    await supabaseAdmin
      .from('rooms')
      .update({ status: 'ENDED' })
      .eq('id', roomId);
  } catch (err) {
    console.error('Error saving match end scores to DB:', err);
  }

  // Determine winner
  let winnerId = null;
  let maxScore = -1;
  for (const [uId, sc] of Object.entries(match.scores)) {
    if (sc > maxScore) {
      maxScore = sc;
      winnerId = uId;
    }
  }

  let winnerName = 'Opponent';
  if (winnerId) {
    const { data: profile } = await supabaseAdmin.from('profiles').select('username').eq('id', winnerId).maybeSingle();
    if (profile) winnerName = profile.username;
  }

  const audienceLeaderboard = Object.entries(match.audienceScores || {}).map(([uId, data]) => ({
    userId: uId,
    username: data.username,
    score: data.score
  })).sort((a, b) => b.score - a.score).slice(0, 10);

  io.to(roomId).emit('game:ended', {
    scores: match.scores,
    winnerId,
    winnerName,
    audienceLeaderboard
  });

  // Handle tournament match completion progression
  await handleTournamentMatchCompletion(roomId, winnerId);

  // Initialize and start post-match voting phase
  try {
    const { data: roomInfo } = await supabaseAdmin
      .from('rooms')
      .select('config')
      .eq('id', roomId)
      .maybeSingle();

    const { data: participants } = await supabaseAdmin
      .from('room_participants')
      .select(`
        user_id,
        is_spectator,
        profiles (
          username
        )
      `)
      .eq('room_id', roomId);

    const playersList = (participants || [])
      .filter((p: any) => !p.is_spectator)
      .map((p: any) => ({
        id: p.user_id,
        username: p.profiles?.username || 'Player'
      }));

    const isTeamMode = roomInfo?.config?.mode === 'TEAM_BATTLE';

    const candidates = {
      bestPlayer: playersList,
      bestTeam: isTeamMode ? ['team_a', 'team_b'] : undefined,
      bestAnswer: isTeamMode ? playersList : undefined
    };

    match.votes = {
      best_player: {},
      best_team: {},
      best_answer: {}
    };

    match.votingDurationLeft = 20;

    console.log(`[Socket] Starting post-match voting for room ${roomId}`);

    io.to(roomId).emit('game:voting_start', {
      candidates,
      timeLeft: match.votingDurationLeft
    });

    match.votingInterval = setInterval(async () => {
      if (!activeMatches.has(roomId)) {
        clearInterval(match.votingInterval!);
        return;
      }
      match.votingDurationLeft!--;
      io.to(roomId).emit('game:voting_tick', { timeLeft: match.votingDurationLeft });

      if (match.votingDurationLeft! <= 0) {
        clearInterval(match.votingInterval!);
        await concludeVoting(roomId);
      }
    }, 1000);

  } catch (err) {
    console.error('Error starting voting phase:', err);
    activeMatches.delete(roomId);
  }
}

// ==========================================
// Full Disconnect Cleanup (used by grace period expiry and lobby disconnects)
// ==========================================
async function performFullDisconnect(roomId: string, userId: string) {
  try {
    await supabaseAdmin
      .from('room_participants')
      .delete()
      .eq('room_id', roomId)
      .eq('user_id', userId);

    const { data: remaining } = await supabaseAdmin
      .from('room_participants')
      .select('user_id, is_host')
      .eq('room_id', roomId);

    if (!remaining || remaining.length === 0) {
      // Clear active matches if any
      const match = activeMatches.get(roomId);
      if (match) {
        if (match.timerInterval) clearInterval(match.timerInterval);
        activeMatches.delete(roomId);
      }
      await supabaseAdmin.from('rooms').delete().eq('id', roomId);
    } else {
      const hostStillPresent = remaining.some((r: any) => r.is_host);
      if (!hostStillPresent) {
        const newHostId = remaining[0].user_id;
        await supabaseAdmin.from('rooms').update({ host_id: newHostId }).eq('id', roomId);
        await supabaseAdmin
          .from('room_participants')
          .update({ is_host: true, is_ready: true })
          .eq('room_id', roomId)
          .eq('user_id', newHostId);
      }
      await broadcastRoomState(roomId);
    }
  } catch (err) {
    console.error('[Socket] Full disconnect cleanup error:', err);
  }
}

// ==========================================
// WebSocket Connection Handlers
// ==========================================
io.use(async (socket, next) => {
  const isAudience = !!socket.handshake.auth?.isAudience;
  if (isAudience) {
    const guestUsername = socket.handshake.auth?.username || `Viewer-${socket.id.substring(0, 5)}`;
    socket.data.user = {
      id: `guest:${socket.id}`,
      email: `${socket.id}@guest.mindrace.local`,
      user_metadata: { username: guestUsername },
      isGuest: true
    };
    return next();
  }

  const token = socket.handshake.auth?.token;
  if (!token) {
    console.log(`[Socket Auth] Connection rejected: Token missing`);
    return next(new Error('Authentication token required'));
  }

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      console.log(`[Socket Auth] Connection rejected: Token invalid or expired`);
      return next(new Error('Invalid authentication token'));
    }

    socket.data.user = user;
    next();
  } catch (err) {
    console.error('[Socket Auth] Authentication exception:', err);
    next(new Error('Authentication failed'));
  }
});

io.on('connection', (socket) => {
  const email = socket.data.user?.email || 'unknown';
  const userId = socket.data.user?.id;
  const connIp = socket.handshake.address || socket.handshake.headers['x-forwarded-for']?.toString() || 'unknown';
  const connFingerprint = socket.handshake.auth?.fingerprint || null;

  console.log(`[Socket] User connected: ${socket.id} (Authenticated: ${email})`);
  logSecurityEvent(userId || null, socket.data.user?.user_metadata?.username || null, 'socket:connect', connIp, connFingerprint);

  socket.on(GameEvents.JOIN_ROOM, async ({ roomId, username }) => {
    const isAudienceUser = !!socket.handshake.auth?.isAudience || !!socket.data.user?.isGuest;
    socket.data.roomId = roomId;

    logSecurityEvent(userId || null, username || null, 'room:join', connIp, connFingerprint, { roomId, isAudienceUser });

    if (isAudienceUser) {
      socket.join(roomId);
      socket.join(roomId + ':audience');
      console.log(`[Socket] Audience viewer ${username} (${socket.id}) joined room ${roomId}`);

      const match = activeMatches.get(roomId);
      if (match) {
        if (!match.audienceScores) {
          match.audienceScores = {};
        }
        match.audienceScores[userId] = {
          username: socket.data.user?.user_metadata?.username || username || 'Spectator',
          score: 0
        };
      }

      // Fetch participants and send directly to this spectator (optimizing fan-out)
      try {
        const { data: participants } = await supabaseAdmin
          .from('room_participants')
          .select(`
            score,
            is_host,
            is_ready,
            team_id,
            is_spectator,
            user_id,
            profiles (
              username,
              avatar_url,
              rank
            )
          `)
          .eq('room_id', roomId);
        if (participants) {
          const list = participants.map((p: any) => ({
            userId: p.user_id,
            username: p.profiles?.username || 'Player',
            avatarUrl: p.profiles?.avatar_url || null,
            rank: p.profiles?.rank || 'Bronze',
            score: p.score,
            isHost: p.is_host,
            isReady: p.is_ready,
            teamId: p.team_id,
            isSpectator: p.is_spectator
          }));
          socket.emit(GameEvents.ROOM_STATE_CHANGE, {
            event: 'PARTICIPANTS_UPDATE',
            participants: list
          });
        }
      } catch (err) {
        console.error('[Socket] Guest join room state fetch error:', err);
      }
      return;
    }

    socket.join(roomId);
    socket.join(roomId + ':players');
    console.log(`[Socket] Player ${username} (${socket.id}) joined room ${roomId}`);

    // Cancel any pending disconnect grace timer for this user
    const timerKey = `${roomId}:${userId}`;
    if (disconnectTimers.has(timerKey)) {
      clearTimeout(disconnectTimers.get(timerKey)!);
      disconnectTimers.delete(timerKey);
      console.log(`[Socket] Reconnection: cancelled grace timer for ${userId} in room ${roomId}`);
    }

    // Check if user already has a participant row (reconnection scenario)
    if (userId && !socket.data.user?.isGuest) {
      try {
        const { data: existing } = await supabaseAdmin
          .from('room_participants')
          .select('user_id, disconnected_at')
          .eq('room_id', roomId)
          .eq('user_id', userId)
          .maybeSingle();

        if (existing) {
          // Clear disconnected_at to mark them as back online
          await supabaseAdmin
            .from('room_participants')
            .update({ disconnected_at: null })
            .eq('room_id', roomId)
            .eq('user_id', userId);
          console.log(`[Socket] Reconnected: ${userId} restored in room ${roomId}`);
        }
      } catch (err) {
        console.error('[Socket] Reconnection check error:', err);
      }
    }

    await broadcastRoomState(roomId);
  });

  socket.on(GameEvents.LEAVE_ROOM, async ({ roomId }) => {
    const isAudienceUser = !!socket.handshake.auth?.isAudience || !!socket.data.user?.isGuest;
    socket.data.roomId = null;

    if (isAudienceUser) {
      socket.leave(roomId);
      socket.leave(roomId + ':audience');
      console.log(`[Socket] Audience viewer ${userId} left room ${roomId}`);

      const match = activeMatches.get(roomId);
      if (match && match.audienceScores) {
        delete match.audienceScores[userId];
      }
      return;
    }

    socket.leave(roomId);
    socket.leave(roomId + ':players');
    console.log(`[Socket] User ${userId} left room ${roomId}`);
    logSecurityEvent(userId || null, socket.data.user?.user_metadata?.username || null, 'room:leave', connIp, connFingerprint, { roomId });
    await broadcastRoomState(roomId);
  });

  socket.on(GameEvents.PLAYER_READY, async ({ roomId, isReady }) => {
    if (!userId) return;
    console.log(`[Socket] User ${userId} ready: ${isReady} in room ${roomId}`);

    try {
      await supabaseAdmin
        .from('room_participants')
        .update({ is_ready: isReady })
        .eq('room_id', roomId)
        .eq('user_id', userId);

      await broadcastRoomState(roomId);
    } catch (err) {
      console.error('[Socket] Ready state update error:', err);
    }
  });

  // Dynamic Room Configuration Updates (Host Only)
  socket.on('room:update_config', async ({ roomId, config }) => {
    if (!userId) return;
    console.log(`[Socket] Host ${userId} updating config in room ${roomId}`, config);

    try {
      const { data: room, error: roomError } = await supabaseAdmin
        .from('rooms')
        .select('host_id')
        .eq('id', roomId)
        .maybeSingle();

      if (roomError || !room) {
        console.error('[Socket] Update config error: Room not found', roomError);
        return;
      }

      if (room.host_id !== userId) {
        console.warn(`[Socket] User ${userId} unauthorized to update config for room ${roomId}`);
        return;
      }

      const { error: updateError } = await supabaseAdmin
        .from('rooms')
        .update({
          config: config,
          max_players: config.maxPlayers || 10
        })
        .eq('id', roomId);

      if (updateError) {
        console.error('[Socket] Update room config in DB error:', updateError);
        return;
      }

      // Broadcast configuration changes to everyone in the room
      io.to(roomId).emit('room:config_updated', { config });
      
      // Sync the participants state in case limits changed
      await broadcastRoomState(roomId);
    } catch (err) {
      console.error('[Socket] Update config exception:', err);
    }
  });

  // Dynamic Team Selection Switch
  socket.on('room:change_team', async ({ roomId, teamId }) => {
    if (!userId) return;
    console.log(`[Socket] Player ${userId} changing team to ${teamId} in room ${roomId}`);

    try {
      const { error } = await supabaseAdmin
        .from('room_participants')
        .update({ team_id: teamId })
        .eq('room_id', roomId)
        .eq('user_id', userId);

      if (error) {
        console.error('[Socket] Change team DB update error:', error);
        return;
      }

      await broadcastRoomState(roomId);
    } catch (err) {
      console.error('[Socket] Change team exception:', err);
    }
  });

  // Synced Start Match Co-ordination
  socket.on(GameEvents.START_GAME, async ({ roomId }) => {
    if (!userId) return;
    
    try {
      const { data: room } = await supabaseAdmin
        .from('rooms')
        .select('host_id, config')
        .eq('id', roomId)
        .maybeSingle();

      if (room && room.host_id === userId) {
        const roundsLimit = room.config?.roundsCount || 5;

        // Query questions matching rounds limit (support question packs)
        let dbQs;
        const packIds = room.config?.questionPackIds || (room.config?.questionPackId ? [room.config.questionPackId] : []);
        if (packIds && packIds.length > 0) {
          const { data: packItems } = await supabaseAdmin
            .from('question_pack_items')
            .select('question_id')
            .in('pack_id', packIds);

          if (packItems && packItems.length > 0) {
            const questionIds = packItems.map((item: any) => item.question_id);
            const { data } = await supabaseAdmin
              .from('questions')
              .select('*')
              .in('id', questionIds)
              .limit(roundsLimit);
            dbQs = data;
          }
        }

        if (!dbQs || dbQs.length === 0) {
          // Fetch current active season to see if we should prioritize/include seasonal questions
          const { data: activeSeason } = await supabaseAdmin
            .from('seasons')
            .select('id')
            .eq('is_active', true)
            .maybeSingle();

          let query = supabaseAdmin.from('questions').select('*');
          if (activeSeason) {
            query = query.or(`season_id.eq.${activeSeason.id},season_id.is.null`);
          }

          // Fetch a pool of up to 40 questions, shuffle them to keep matches varied
          const { data: pool } = await query.limit(40);
          if (pool && pool.length >= roundsLimit) {
            const shuffled = [...pool].sort(() => Math.random() - 0.5);
            dbQs = shuffled.slice(0, roundsLimit);
          } else {
            dbQs = pool;
          }
        }

        // Fallback to sample questions set if database has insufficient items
        const questionsList: Question[] = (dbQs && dbQs.length >= 3) 
          ? dbQs.map((q: any) => ({
              id: q.id,
              type: q.type,
              category: q.category,
              body: q.body,
              image_url: q.image_url,
              options: q.options,
              correctAnswer: q.correct_answer,
              orderingItems: q.ordering_items,
              matchingPairs: q.matching_pairs,
              codingTestCases: q.coding_test_cases,
              difficulty: q.difficulty,
              rating: Number(q.rating || 0),
              explanation: q.explanation,
              createdAt: new Date(q.created_at)
            }))
          : BACKEND_SAMPLE_QUESTIONS;

        // Update database room status to ACTIVE
        await supabaseAdmin
          .from('rooms')
          .update({ status: 'ACTIVE' })
          .eq('id', roomId);

        console.log(`[Socket] Host initialized Active Match for room ${roomId}`);

        // Initialize Active Match Session state
        const match: ActiveMatch = {
          roomId,
          status: 'ACTIVE',
          questions: questionsList.slice(0, roundsLimit),
          currentRound: 0,
          scores: {},
          buzzedPlayerId: null,
          timeLeft: room.config?.questionTimeLimitSeconds || 30,
          timerInterval: null
        };

        // Initialize score ledgers (Active players only, exclude spectators)
        const { data: members } = await supabaseAdmin
          .from('room_participants')
          .select('user_id')
          .eq('room_id', roomId)
          .eq('is_spectator', false);

        if (members) {
          members.forEach((m: any) => {
            match.scores[m.user_id] = 0;
          });
        }

        activeMatches.set(roomId, match);

        // Broadcast game start & transition UI to cinematic
        io.to(roomId).emit(GameEvents.START_GAME, { roomId });

        // Wait 3.5s (Cinematic overlay) then start round 1 tick
        setTimeout(() => {
          startMatchTicker(roomId);
        }, 3600);
      }
    } catch (err) {
      console.error('[Socket] Start game error:', err);
    }
  });

  // Synced Buzzerpress Lockout
  socket.on(GameEvents.BUZZ, async ({ roomId }) => {
    const match = activeMatches.get(roomId);
    if (!match || match.buzzedPlayerId) return;

    if (!userId) return;

    try {
      // Security: Validate player is not a spectator
      const { data: partInfo } = await supabaseAdmin
        .from('room_participants')
        .select('is_spectator')
        .eq('room_id', roomId)
        .eq('user_id', userId)
        .maybeSingle();

      if (partInfo?.is_spectator) {
        console.warn(`[Socket] Spectator ${userId} blocked from buzzing in room ${roomId}`);
        return;
      }

      match.buzzedPlayerId = userId;
      console.log(`[Socket] Player ${userId} buzzed in room ${roomId}`);

      // Broadcast who got the buzzer first
      io.to(roomId).emit('game:buzzed', {
        userId,
        username: socket.data.user.user_metadata?.username || 'Player'
      });

      // Constrain answering time limit to 10s for the buzzed player
      match.timeLeft = 10;
    } catch (e) {
      console.error('[Socket] Buzz exception:', e);
    }
  });

  // Synced Submit Answer Co-ordination
  socket.on('game:submit_answer', async ({ roomId, answer }) => {
    const match = activeMatches.get(roomId);
    if (!match) return;

    if (!userId) return;

    // Reject answers if they aren't the buzzed player (when buzzer active)
    if (match.buzzedPlayerId && match.buzzedPlayerId !== userId) {
      return;
    }

    const timeSpentMs = Date.now() - (match.roundStartedAt || Date.now());

    // Event log
    logSecurityEvent(userId, socket.data.user.user_metadata?.username || 'player', 'game:submit_answer', connIp, connFingerprint, { roomId, roundIndex: match.currentRound, timeSpentMs });

    // In-game Bot Pattern Analysis
    if (userId) {
      if (!playerAnswerTimings.has(userId)) {
        playerAnswerTimings.set(userId, []);
      }
      const timings = playerAnswerTimings.get(userId)!;
      timings.push({ timeSpentMs, submittedAt: Date.now(), answer });

      if (timings.length > 5) {
        timings.shift();
      }

      const isTooFast = timeSpentMs < 150;
      
      let hasZeroVariance = false;
      if (timings.length >= 3) {
        const mean = timings.reduce((sum, t) => sum + t.timeSpentMs, 0) / timings.length;
        const variance = timings.reduce((sum, t) => sum + Math.pow(t.timeSpentMs - mean, 2), 0) / timings.length;
        const stdDev = Math.sqrt(variance);
        if (stdDev < 5) {
          hasZeroVariance = true;
        }
      }

      let hasIdenticalRepeatedInput = false;
      const recentAnswers = timings.map(t => typeof t.answer === 'string' ? t.answer : JSON.stringify(t.answer));
      if (recentAnswers.length >= 4 && recentAnswers.every(ans => ans === recentAnswers[0])) {
        hasIdenticalRepeatedInput = true;
      }

      if (isTooFast || hasZeroVariance || hasIdenticalRepeatedInput) {
        const flagReason = isTooFast 
          ? `Inhuman response speed (${timeSpentMs}ms)` 
          : hasZeroVariance 
            ? `Zero timing variance (<5ms deviation)` 
            : `Repeated identical answer pattern`;

        await supabaseAdmin
          .from('profiles')
          .update({
            is_flagged: true,
            flag_reason: `Suspicious activity: ${flagReason}`
          })
          .eq('id', userId);

        await logSecurityEvent(
          userId,
          socket.data.user.user_metadata?.username || 'player',
          'security:bot_pattern_detected',
          connIp,
          connFingerprint,
          { timeSpentMs, flagReason, answersHistory: recentAnswers }
        );
      }
    }

    try {
      // Security: Validate player is not a spectator
      const { data: partInfo } = await supabaseAdmin
        .from('room_participants')
        .select('is_spectator')
        .eq('room_id', roomId)
        .eq('user_id', userId)
        .maybeSingle();

      if (partInfo?.is_spectator) {
        console.warn(`[Socket] Spectator ${userId} blocked from submitting answer in room ${roomId}`);
        return;
      }

      const question = match.questions[match.currentRound];
      const gradingResult = await gradeAnswer(question, answer);
      const isCorrect = gradingResult.isCorrect;

      if (isCorrect) {
        const multiplier = match.buzzedPlayerId === userId ? 1.2 : 1.0;
        const points = Math.floor((100 + match.timeLeft * 2) * multiplier);
        match.scores[userId] = (match.scores[userId] || 0) + points;
      } else {
        if (match.buzzedPlayerId === userId) {
          match.scores[userId] = Math.max(0, (match.scores[userId] || 0) - 30);
        }
      }

      await endRound(roomId, userId, isCorrect);
    } catch (err) {
      console.error('[Socket] Error evaluating answer submission:', err);
      // Fallback
      await endRound(roomId, null, false);
    }
  });

  socket.on(GameEvents.SUBMIT_AUDIENCE_ANSWER, async ({ roomId, answer }) => {
    const match = activeMatches.get(roomId);
    if (!match || match.status !== 'ACTIVE') return;
    if (!userId) return;

    const roundIndex = match.currentRound;

    if (!match.audienceAnswers) match.audienceAnswers = {};
    if (!match.audienceAnswers[roundIndex]) match.audienceAnswers[roundIndex] = {};

    if (match.audienceAnswers[roundIndex][userId]) {
      return;
    }
    match.audienceAnswers[roundIndex][userId] = true;

    try {
      const question = match.questions[roundIndex];
      const gradingResult = await gradeAnswer(question, answer);
      const isCorrect = gradingResult.isCorrect;

      let pointsEarned = 0;
      if (isCorrect) {
        pointsEarned = Math.max(0, 100 + match.timeLeft * 2);
        if (!match.audienceScores) match.audienceScores = {};
        if (!match.audienceScores[userId]) {
          match.audienceScores[userId] = {
            username: socket.data.user?.user_metadata?.username || 'Viewer',
            score: 0
          };
        }
        match.audienceScores[userId].score += pointsEarned;
      }

      const correctAnswerVal = question.correctAnswer || (question as any).correct_answer || question.orderingItems || question.matchingPairs;

      socket.emit(GameEvents.AUDIENCE_ANSWER_GRADED, {
        isCorrect,
        pointsEarned,
        correctAnswer: correctAnswerVal,
        explanation: question.explanation || '',
        score: match.audienceScores?.[userId]?.score || 0
      });
    } catch (err) {
      console.error('[Socket] Error grading audience answer:', err);
    }
  });

  socket.on('game:submit_vote', async ({ roomId, category, candidateId }) => {
    if (!roomId || !category || !candidateId) return;
    if (!userId) return;

    const match = activeMatches.get(roomId);
    if (!match || !match.votes) return;

    // Security check: cannot vote for self in best_player and best_answer categories
    if ((category === 'best_player' || category === 'best_answer') && candidateId === userId) {
      console.warn(`[Socket] Player ${userId} attempted to self-vote for category ${category}`);
      return;
    }

    // Register vote
    if (!match.votes[category]) {
      match.votes[category] = {};
    }
    match.votes[category][userId] = candidateId;

    // Tally votes for this category to broadcast live results
    const counts: Record<string, number> = {};
    for (const candId of Object.values(match.votes[category])) {
      counts[candId] = (counts[candId] || 0) + 1;
    }

    // Broadcast live update
    io.to(roomId).emit('game:vote_update', {
      category,
      votes: counts
    });

    // Check if all active players have voted for all categories (so we can conclude immediately)
    const activePlayerIds = Object.keys(match.scores);
    
    // Check if everyone voted
    const allHaveVoted = activePlayerIds.every(id => {
      const votedBP = match.votes?.best_player?.[id] !== undefined;
      const hasTeam = match.votes?.best_team !== undefined;
      const votedBT = !hasTeam || match.votes?.best_team?.[id] !== undefined;
      const votedBA = !hasTeam || match.votes?.best_answer?.[id] !== undefined;
      return votedBP && votedBT && votedBA;
    });

    if (allHaveVoted) {
      console.log(`[Socket] All active players voted in room ${roomId}. Concluding voting early.`);
      await concludeVoting(roomId);
    }
  });

  socket.on('disconnect', async () => {
    const roomId = socket.data.roomId;
    console.log(`[Socket] User disconnected: ${socket.id} (${email})`);

    if (roomId && userId) {
      if (socket.data.user?.isGuest) {
        const match = activeMatches.get(roomId);
        if (match && match.audienceScores) {
          delete match.audienceScores[userId];
        }
        console.log(`[Socket] Guest spectator ${userId} disconnected. Cleaned up in-memory score.`);
        return;
      }

      const timerKey = `${roomId}:${userId}`;

      // Check if a match is currently active — if so, use a 30s grace period
      const match = activeMatches.get(roomId);
      if (match && match.status === 'ACTIVE') {
        // Mark player as disconnected in DB but don't remove them yet
        try {
          await supabaseAdmin
            .from('room_participants')
            .update({ disconnected_at: new Date().toISOString() })
            .eq('room_id', roomId)
            .eq('user_id', userId);
          console.log(`[Socket] Grace period started (30s) for ${userId} in room ${roomId}`);
        } catch (err) {
          console.error('[Socket] Grace period mark error:', err);
        }

        await broadcastRoomState(roomId);

        // Set a 30s timer — if they don't reconnect, then fully remove them
        const graceTimer = setTimeout(async () => {
          disconnectTimers.delete(timerKey);
          console.log(`[Socket] Grace period expired for ${userId} in room ${roomId}. Removing.`);
          await performFullDisconnect(roomId, userId);
        }, 30000);

        disconnectTimers.set(timerKey, graceTimer);
      } else {
        // No active match — remove immediately (lobby disconnect)
        await performFullDisconnect(roomId, userId);
      }
    }
  });
});

// Start the server
httpServer.listen(port, () => {
  console.log(`===========================================`);
  console.log(`🚀 Mind Race Core API is running!`);
  console.log(`🌐 Server Port: ${port}`);
  console.log(`🏥 Health Check: http://localhost:${port}/api/v1/health`);
  console.log(`===========================================`);
});

export default app;
