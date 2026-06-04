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

// Create HTTP server and initialize socket.io
const httpServer = createServer(app);
const io = new Server(httpServer, {
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
}

const activeMatches = new Map<string, ActiveMatch>();

// 10 Fallback sample questions in case database questions is empty
const BACKEND_SAMPLE_QUESTIONS: Question[] = [
  {
    id: 'q1',
    type: 'MULTIPLE_CHOICE',
    category: 'Science / العلوم',
    body: 'Which element has the highest thermal conductivity of any natural material?\nأي العناصر التالية يمتلك أعلى موصلية حرارية بين المواد الطبيعية؟',
    options: [
      { id: 'a', text: 'Silver / الفضة' },
      { id: 'b', text: 'Copper / النحاس' },
      { id: 'c', text: 'Diamond / الماس' },
      { id: 'd', text: 'Gold / الذهب' }
    ],
    difficulty: 'Medium',
    explanation: 'Diamond has a thermal conductivity five times higher than copper.\nالماس يمتلك موصلية حرارية تفوق النحاس بخمسة أضعاف.',
    correctAnswer: 'c',
    rating: 4.8,
    createdAt: new Date()
  },
  {
    id: 'q2',
    type: 'TRUE_FALSE',
    category: 'Physics / الفيزياء',
    body: 'Sound waves travel faster in water than in air.\nتنتقل الموجات الصوتية في الماء بسرعة أكبر من انتقالها في الهواء.',
    difficulty: 'Easy',
    explanation: 'Because water is denser than air, sound travels about 4.3 times faster in it.\nلأن الماء أكثر كثافة من الهواء، ينتقل الصوت فيه بسرعة أكبر بنحو 4.3 أضعاف.',
    correctAnswer: 'true',
    rating: 4.5,
    createdAt: new Date()
  },
  {
    id: 'q3',
    type: 'FILL_IN_THE_BLANK',
    category: 'Math / الرياضيات',
    body: 'What is the value of Pi rounded to two decimal places?\nما هي قيمة ثابت بّاي (Pi) مقربة لعددين عشريين؟',
    difficulty: 'Easy',
    explanation: 'Pi is approximately 3.14159..., which rounds to 3.14.\nثابت باي هو تقريباً 3.14159... والذي يقرب إلى 3.14.',
    correctAnswer: '3.14',
    rating: 4.2,
    createdAt: new Date()
  },
  {
    id: 'q4',
    type: 'ORDERING_QUESTION',
    category: 'Astronomy / الفلك',
    body: 'Order these planets from closest to farthest from the Sun.\nرتب الكواكب التالية من الأقرب إلى الأبعد عن الشمس.',
    options: [
      { id: '1', text: 'Venus / الزهرة' },
      { id: '2', text: 'Mercury / عطارد' },
      { id: '3', text: 'Mars / المريخ' },
      { id: '4', text: 'Earth / الأرض' }
    ],
    difficulty: 'Medium',
    orderingItems: ['2', '1', '4', '3'],
    explanation: 'Mercury is closest, followed by Venus, Earth, and Mars.\nعطارد هو الأقرب، يليه الزهرة، ثم الأرض، وأخيراً المريخ.',
    rating: 4.6,
    createdAt: new Date()
  },
  {
    id: 'q5',
    type: 'MATCHING_QUESTION',
    category: 'Technology / التقنية',
    body: 'Match the programming terms with their definitions.\nصل المصطلحات البرمجية بالتعريفات المناسبة لها.',
    matchingPairs: [
      { leftId: 'v', leftText: 'Variable / المتغير', rightId: '1', rightText: 'Stores data / يخزن البيانات' },
      { leftId: 'f', leftText: 'Function / الدالة', rightId: '2', rightText: 'Reusable block / كتلة برمجية يعاد استخدامها' },
      { leftId: 'l', leftText: 'Loop / التكرار', rightId: '3', rightText: 'Repeats instructions / يكرر التعليمات البرمجية' }
    ],
    difficulty: 'Medium',
    explanation: 'Variables store data, functions are reusable blocks, and loops repeat instructions.\nالمتغيرات تخزن البيانات، الدوال كتل يعاد استخدامها، والتكرار يكرر الأوامر.',
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

  io.to(roomId).emit('game:round_start', {
    roundIndex: match.currentRound,
    totalRounds: match.questions.length,
    question: sanitizedQuestion,
    timeLeft: match.timeLeft,
    scores: match.scores
  });

  match.timerInterval = setInterval(() => {
    match.timeLeft--;
    io.to(roomId).emit('game:tick', { timeLeft: match.timeLeft });

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

  io.to(roomId).emit('game:round_ended', {
    userId,
    isCorrect,
    correctAnswer: correctAnswerVal,
    explanation: question.explanation,
    scores: match.scores
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

  io.to(roomId).emit('game:ended', {
    scores: match.scores,
    winnerId,
    winnerName
  });

  activeMatches.delete(roomId);
}

// ==========================================
// WebSocket Connection Handlers
// ==========================================
io.use(async (socket, next) => {
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
  console.log(`[Socket] User connected: ${socket.id} (Authenticated: ${email})`);

  socket.on(GameEvents.JOIN_ROOM, async ({ roomId, username }) => {
    socket.join(roomId);
    socket.data.roomId = roomId;
    console.log(`[Socket] ${username} (${socket.id}) joined room ${roomId}`);
    await broadcastRoomState(roomId);
  });

  socket.on(GameEvents.LEAVE_ROOM, async ({ roomId }) => {
    socket.leave(roomId);
    socket.data.roomId = null;
    console.log(`[Socket] User ${userId} left room ${roomId}`);
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

        // Query some questions from database matching rounds limit
        const { data: dbQs } = await supabaseAdmin
          .from('questions')
          .select('*')
          .limit(roundsLimit);

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
          members.forEach((m) => {
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

  socket.on('disconnect', async () => {
    const roomId = socket.data.roomId;
    console.log(`[Socket] User disconnected: ${socket.id} (${email})`);

    if (roomId && userId) {
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
          const hostStillPresent = remaining.some((r) => r.is_host);
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
        console.error('[Socket] Disconnect cleanup error:', err);
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
