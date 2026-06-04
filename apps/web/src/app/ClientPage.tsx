'use client';

import React, { useState, useEffect, useRef } from 'react';
import { BuzzerType, GameModeType, Question } from '@mind-race/shared';
import { GameSyncService } from '../lib/gameSync';
import { useAuth } from '../context/AuthContext';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:5000';

// ==========================================
// Web Audio API Sound Generator (No external assets required!)
// ==========================================
const playSFX = (type: 'correct' | 'wrong' | 'buzz' | 'tick' | 'slam' | 'click') => {
  if (typeof window === 'undefined') return;
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'correct') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3); // A5
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } else if (type === 'wrong') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(70, ctx.currentTime + 0.4);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc.start();
      osc.stop(ctx.currentTime + 0.45);
    } else if (type === 'buzz') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(293.66, ctx.currentTime); // D4
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.2); // A4
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } else if (type === 'tick') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1000, ctx.currentTime);
      gain.gain.setValueAtTime(0.03, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
      osc.start();
      osc.stop(ctx.currentTime + 0.06);
    } else if (type === 'slam') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(90, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.6);
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.65);
      osc.start();
      osc.stop(ctx.currentTime + 0.7);
    } else if (type === 'click') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    }
  } catch (e) {
    console.log('Audio error:', e);
  }
};

const triggerVibrate = (pattern: number | number[]) => {
  if (typeof window !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(pattern);
  }
};

// ==========================================
// 10 Interactive Sample Questions
// ==========================================
const SAMPLE_QUESTIONS: Question[] = [
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
  },
  {
    id: 'q6',
    type: 'MULTI_SELECT',
    category: 'Math / الرياضيات',
    body: 'Select all of the following numbers that are prime.\nاختر جميع الأعداد الأولية من القائمة التالية.',
    options: [
      { id: 'a', text: '2' },
      { id: 'b', text: '3' },
      { id: 'c', text: '9' },
      { id: 'd', text: '11' }
    ],
    difficulty: 'Medium',
    correctAnswer: ['a', 'b', 'd'],
    explanation: '2, 3, and 11 have no divisors other than 1 and themselves. 9 is divisible by 3.\nالأعداد 2 و 3 و 11 لا تقبل القسمة إلا على نفسها وعلى 1. العدد 9 يقبل القسمة على 3.',
    rating: 4.4,
    createdAt: new Date()
  },
  {
    id: 'q7',
    type: 'CALCULATION_QUESTION',
    category: 'Electronics / إلكترونيات',
    body: 'Calculate the current (in Amperes) flowing in a circuit with a 12V voltage source and a 4 Ohm resistor.\nاحسب شدة التيار (بالأمبير) المار في دائرة كهربائية بها مصدر جهد 12 فولت ومقاومة 4 أوم.',
    difficulty: 'Easy',
    explanation: 'Using Ohm\'s law (I = V / R), Current = 12V / 4 Ohms = 3 Amperes.\nباستخدام قانون أوم (ت = جـ / م)، التيار = 12 / 4 = 3 أمبير.',
    correctAnswer: '3',
    rating: 4.3,
    createdAt: new Date()
  },
  {
    id: 'q8',
    type: 'CIRCUIT_QUESTION',
    category: 'Electronics / إلكترونيات',
    body: 'What is the equivalent resistance of two 10 Ohm resistors connected in parallel?\nما هي المقاومة المكافئة لمقاومتين قيمة كل منهما 10 أوم متصلتين على التوازي؟',
    options: [
      { id: 'a', text: '20 Ohms / أوم' },
      { id: 'b', text: '5 Ohms / أوم' },
      { id: 'c', text: '10 Ohms / أوم' }
    ],
    difficulty: 'Medium',
    correctAnswer: 'b',
    explanation: 'For parallel resistors: R_eq = (R1 * R2) / (R1 + R2) = 100 / 20 = 5 Ohms.\nللمقاومات على التوازي: م المكافئة = (م1 * م2) / (م1 + م2) = 100 / 20 = 5 أوم.',
    rating: 4.5,
    createdAt: new Date()
  },
  {
    id: 'q9',
    type: 'IMAGE_QUESTION',
    category: 'Chemistry / الكيمياء',
    body: 'Identify the chemical compound represented by this hexagonal ring structure.\nتعرف على المركب الكيميائي الممثل بحلقة السداسي العطري الموضحة.',
    imageUrl: 'https://images.unsplash.com/photo-1603126857599-f6e157fa2fe6?auto=format&fit=crop&w=500&q=80',
    options: [
      { id: 'a', text: 'Cyclohexane / سيكلوهكسان' },
      { id: 'b', text: 'Benzene / بنزين' },
      { id: 'c', text: 'Toluene / تولوين' }
    ],
    difficulty: 'Medium',
    correctAnswer: 'b',
    explanation: 'Benzene (C6H6) is represented by a hexagonal ring with a circle or alternating double bonds.\nالبنزين العطري (C6H6) يمثل بحلقة سداسية تحتوي على روابط ثنائية متبادلة.',
    rating: 4.8,
    createdAt: new Date()
  },
  {
    id: 'q10',
    type: 'CODING_QUESTION',
    category: 'Programming / البرمجة',
    body: 'Write a JavaScript function sum(a, b) that returns the sum of both parameters.\nاكتب دالة برمجية بلغة جافا سكربت sum(a, b) تقوم بإعادة مجموع المتغيرين.',
    difficulty: 'Hard',
    codingTestCases: [
      { input: 'sum(2, 3)', output: '5' }
    ],
    explanation: 'A simple return statement: function sum(a, b) { return a + b; }\nدالة بسيطة تعيد الناتج مباشرة: function sum(a, b) { return a + b; }',
    correctAnswer: 'function sum(a, b) {\n  return a + b;\n}',
    rating: 4.9,
    createdAt: new Date()
  }
];

export default function ClientPage() {
  const { user, loading, signOut, refreshProfile } = useAuth();
  const router = useRouter();

  // Navigation and Layout states
  const [isRtl, setIsRtl] = useState(false);
  const [screen, setScreen] = useState<'dashboard' | 'lobby' | 'cinematic' | 'game' | 'summary'>('dashboard');
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [socketStatus, setSocketStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [latency, setLatency] = useState<number | null>(null);
  const [viewingLeaderboard, setViewingLeaderboard] = useState(false);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);

  const [gamingAlert, setGamingAlert] = useState<{ show: boolean; message: string; type?: 'info' | 'error' | 'warning' | 'success' }>({
    show: false,
    message: '',
    type: 'info'
  });

  const triggerGamingAlert = (message: string, type: 'info' | 'error' | 'warning' | 'success' = 'info') => {
    setGamingAlert({ show: true, message, type });
  };

  // Configuration and Room States
  const [selectedMode, setSelectedMode] = useState<GameModeType>('FREE_FOR_ALL');
  const [selectedBuzzer, setSelectedBuzzer] = useState<BuzzerType>('STANDARD');
  const [selectedRounds, setSelectedRounds] = useState<number>(5);
  const [selectedTimeLimit, setSelectedTimeLimit] = useState<number>(30);
  const [selectedMaxPlayers, setSelectedMaxPlayers] = useState<number>(6);
  const [isSpectatorJoin, setIsSpectatorJoin] = useState<boolean>(false);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [currentRoom, setCurrentRoom] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  interface PlayerParticipant {
    userId: string;
    username: string;
    avatarUrl: string | null;
    rank: string;
    score: number;
    isHost: boolean;
    isReady: boolean;
    teamId: string | null;
    isSpectator: boolean;
  }

  interface ReportParticipant extends PlayerParticipant {
    accuracy: number;
    correctCount: number;
    totalAnswered: number;
  }

  const [participants, setParticipants] = useState<PlayerParticipant[]>([]);
  
  interface SoloHistoryItem {
    roundNumber: number;
    questionText: string;
    questionType: string;
    isCorrect: boolean;
    userAnswer: unknown;
    correctAnswer: unknown;
    explanation: string;
    timeSpent: number;
  }

  interface MatchReportData {
    players: ReportParticipant[];
    rounds: {
      roundNumber: number;
      questionBody: string;
      questionType: string;
      answers: {
        userId: string;
        username: string;
        isCorrect: boolean;
        timeSpentMs: number;
        pointsEarned: number;
      }[];
    }[];
    isMultiplayer: boolean;
  }

  interface DbRound {
    id: string;
    round_number: number;
    question_id: string;
    questions: {
      id: string;
      body: string;
      type: string;
      correct_answer: unknown;
    } | null;
  }

  interface DbAnswer {
    round_id: string;
    user_id: string;
    answer: unknown;
    time_spent_ms: number;
    is_correct: boolean;
    points_earned: number;
  }

  // Enhanced summary screen states
  const [soloHistory, setSoloHistory] = useState<SoloHistoryItem[]>([]);
  const [matchReportDetails, setMatchReportDetails] = useState<MatchReportData | null>(null);
  const [loadingReportDetails, setLoadingReportDetails] = useState<boolean>(false);
  const [expandedRound, setExpandedRound] = useState<number | null>(null);
  
  // Game Play States
  const [gameMode, setGameMode] = useState<GameModeType>('PRACTICE');
  const [gameQuestions, setGameQuestions] = useState<Question[]>([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  const [buzzerActive, setBuzzerActive] = useState(true);
  const [isBuzzed, setIsBuzzed] = useState(false);
  const [buzzedUser, setBuzzedUser] = useState<string | null>(null);
  
  // Answer & Scoring states
  const [selectedOption, setSelectedOption] = useState<any>(null); // For MCQ, T/F, Multi-Select
  const [textAnswer, setTextAnswer] = useState(''); // For Blank, Calculation, Coding
  const [orderIds, setOrderIds] = useState<string[]>([]); // For Ordering Question
  const [matchingSelections, setMatchingSelections] = useState<{ [leftId: string]: string }>({}); // Left -> Right pairs
  const [activeLeftTerm, setActiveLeftTerm] = useState<string | null>(null);
  
  const [score, setScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [correctAnswersCount, setCorrectAnswersCount] = useState(0);
  const [activePowerUps, setActivePowerUps] = useState<string[]>([]);
  const [inventoryPowerUps, setInventoryPowerUps] = useState<string[]>(['JOKER', 'FREEZE', 'SHIELD']);
  
  // Feedback states
  const [answerSubmitted, setAnswerSubmitted] = useState(false);
  const [isAnswerCorrect, setIsAnswerCorrect] = useState<boolean | null>(null);
  const [revealedCorrectAnswer, setRevealedCorrectAnswer] = useState<any>(null);
  
  // Chat and Signaling states
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<{ sender: string; message: string; teamId: string | null }[]>([]);
  const [floatingMessage, setFloatingMessage] = useState<{ sender: string; message: string; teamId: string | null } | null>(null);
  const [showSignalMenu, setShowSignalMenu] = useState(false);
  
  // Buzzer & Bidding & Voting states
  const [showBidModal, setShowBidModal] = useState(false);
  const [bidValue, setBidValue] = useState(100);
  const [teammateVotes, setTeammateVotes] = useState<{ [optionId: string]: string[] }>({}); // optionId -> usernames
  
  // Timers and Refs
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const gameSyncRef = useRef<GameSyncService | null>(null);
  const activeRoundRef = useRef<any>(null);

  const setupGameSyncCallbacks = (sync: GameSyncService) => {
    sync.setCallbacks({
      onParticipantsUpdate: (list) => {
        setParticipants(list as unknown as PlayerParticipant[]);
      },
      onConfigUpdate: (config) => {
        setCurrentRoom((prev: any) => prev ? { ...prev, config } : null);
      },
      onGameStart: () => {
        playSFX('slam');
        triggerVibrate([200, 100, 200]);
        setScreen('cinematic');
      },
      onRoundStart: (data) => {
        setGameMode(currentRoom?.config?.mode || 'FREE_FOR_ALL');
        activeRoundRef.current = { id: data.roundId, started_at: Date.now() };
        
        setGameQuestions((prev) => {
          const list = [...prev];
          list[data.roundIndex] = data.question;
          return list;
        });
        setCurrentQIndex(data.roundIndex);
        setTimeLeft(data.timeLeft);
        setBuzzerActive(true);
        setIsBuzzed(false);
        setBuzzedUser(null);
        setSelectedOption(null);
        setTextAnswer('');
        setMatchingSelections({});
        setActiveLeftTerm(null);
        setAnswerSubmitted(false);
        setIsAnswerCorrect(null);
        setRevealedCorrectAnswer(null);
        setTeammateVotes({});

        if (data.question.type === 'ORDERING_QUESTION' && data.question.options) {
          const shuffled = [...data.question.options].sort(() => Math.random() - 0.5);
          setOrderIds(shuffled.map((o: any) => o.id));
        }

        setScreen('game');
      },
      onTick: (data) => {
        setTimeLeft(data.timeLeft);
      },
      onBuzzed: (data) => {
        playSFX('buzz');
        setIsBuzzed(true);
        setBuzzedUser(data.username);
      },
      onBuzzerReset: () => {
        setIsBuzzed(false);
        setBuzzedUser(null);
      },
      onRoundEnded: (data) => {
        setIsAnswerCorrect(data.isCorrect);
        setRevealedCorrectAnswer(data.correctAnswer);
        setAnswerSubmitted(true);

        if (data.isCorrect) {
          playSFX('correct');
        } else {
          playSFX('wrong');
        }

        if (data.scores) {
          const selfScore = data.scores[user!.id];
          setScore(selfScore || 0);

          const oppId = Object.keys(data.scores).find(id => id !== user!.id);
          if (oppId) {
            setOpponentScore(data.scores[oppId] || 0);
          }
        }
      },
      onGameEnded: (data) => {
        playSFX('slam');
        setScreen('summary');
        refreshProfile();
      },
      onPowerUpUsed: (data) => {
        if (data.powerUpType === 'FREEZE' && data.targetUserId === user!.id) {
          triggerGamingAlert(isRtl ? 'تم تجميدك من قبل الخصم!' : 'You have been frozen by the opponent!', 'warning');
          setTimeLeft(prev => Math.max(0, prev - 10));
        }
      },
      onChatMessage: (data) => {
        if (data.message.startsWith('__VOTE__:')) {
          const optionId = data.message.substring(9);
          setTeammateVotes(prev => {
            const updated = { ...prev };
            for (const key in updated) {
              updated[key] = (updated[key] || []).filter(name => name !== data.username);
            }
            if (!updated[optionId]) {
              updated[optionId] = [];
            }
            if (!updated[optionId].includes(data.username)) {
              updated[optionId].push(data.username);
            }
            return updated;
          });
          return;
        }

        setChatMessages(prev => [
          ...prev,
          { sender: data.username, message: data.message, teamId: data.teamId || null }
        ]);
        playSFX('click');
        
        const selfId = user?.id;
        const activeParts = gameSyncRef.current?.activeParticipants || [];
        const selfPart = activeParts.find(p => p.userId === selfId);
        const myTeam = selfPart?.teamId || null;
        
        if (!data.teamId || data.teamId === myTeam) {
          setFloatingMessage({ sender: data.username, message: data.message, teamId: data.teamId || null });
          setTimeout(() => {
            setFloatingMessage(prev => {
              if (prev && prev.sender === data.username && prev.message === data.message) {
                return null;
              }
              return prev;
            });
          }, 3500);
        }
      }
    });
  };

  // -----------------------------------------------------------------
  // HOISTED FUNCTION DECLARATIONS (Resolves eslint variable access order)
  // -----------------------------------------------------------------

  function handleAutoSubmitWrong() {
    playSFX('wrong');
    setIsAnswerCorrect(false);
    setAnswerSubmitted(true);

    const q = gameQuestions[currentQIndex];
    if (q) {
      setSoloHistory(prev => [
        ...prev,
        {
          roundNumber: currentQIndex + 1,
          questionText: q.body,
          questionType: q.type,
          isCorrect: false,
          userAnswer: null,
          correctAnswer: q.correctAnswer || q.orderingItems || q.matchingPairs,
          explanation: q.explanation || '',
          timeSpent: 30
        }
      ]);
    }

    if (gameMode === 'SURVIVAL') {
      setLives((prev) => {
        const nextL = prev - 1;
        if (nextL <= 0) setTimeout(() => finishGame(), 2000);
        return nextL;
      });
    }
  }

  function evaluateLocalAnswer(q: Question, ans: any): boolean {
    if (q.type === 'MULTIPLE_CHOICE' || q.type === 'TRUE_FALSE' || q.type === 'IMAGE_QUESTION' || q.type === 'CIRCUIT_QUESTION') {
      return String(ans).toLowerCase().trim() === String(q.correctAnswer).toLowerCase().trim();
    }
    if (q.type === 'FILL_IN_THE_BLANK' || q.type === 'CALCULATION_QUESTION') {
      return String(ans).toLowerCase().trim() === String(q.correctAnswer).toLowerCase().trim();
    }
    if (q.type === 'MULTI_SELECT') {
      const correct = q.correctAnswer as string[];
      const userList = ans as string[];
      if (correct.length !== userList.length) return false;
      return correct.every(c => userList.includes(c));
    }
    if (q.type === 'ORDERING_QUESTION') {
      const correct = q.orderingItems as string[];
      const userList = ans as string[];
      return correct.every((c, i) => c === userList[i]);
    }
    if (q.type === 'MATCHING_QUESTION') {
      const pairs = q.matchingPairs || [];
      const userPairs = ans as { [leftId: string]: string };
      for (const pair of pairs) {
        if (userPairs[pair.leftId] !== pair.rightId) {
          return false;
        }
      }
      return true;
    }
    if (q.type === 'CODING_QUESTION') {
      try {
        const sumFunc = new Function('a', 'b', `
          ${ans}
          return sum(a, b);
        `);
        return sumFunc(2, 3) === 5;
      } catch {
        return false;
      }
    }
    return false;
  }

  async function submitAnswer() {
    playSFX('click');
    const q = gameQuestions[currentQIndex];
    let userAns: any = null;
    const bt = currentRoom?.config?.buzzerType || 'STANDARD';

    if (q.type === 'MULTIPLE_CHOICE' || q.type === 'TRUE_FALSE' || q.type === 'IMAGE_QUESTION' || q.type === 'CIRCUIT_QUESTION') {
      if (bt === 'TEAM_CONSULTATION') {
        let maxVotes = 0;
        let majorityOption = selectedOption;
        for (const optId in teammateVotes) {
          const votesCount = teammateVotes[optId]?.length || 0;
          if (votesCount > maxVotes) {
            maxVotes = votesCount;
            majorityOption = optId;
          }
        }
        userAns = majorityOption;
      } else {
        userAns = selectedOption;
      }
    } else if (q.type === 'FILL_IN_THE_BLANK' || q.type === 'CALCULATION_QUESTION' || q.type === 'CODING_QUESTION') {
      userAns = textAnswer.trim();
    } else if (q.type === 'MULTI_SELECT') {
      userAns = selectedOption || [];
    } else if (q.type === 'ORDERING_QUESTION') {
      userAns = orderIds;
    } else if (q.type === 'MATCHING_QUESTION') {
      userAns = matchingSelections;
    }

    if (userAns === null || userAns === undefined || (Array.isArray(userAns) && userAns.length === 0)) {
      triggerGamingAlert(
        isRtl ? 'من فضلك اختر أو اكتب إجابة أولاً!' : 'Please select or enter an answer first!',
        'warning'
      );
      return;
    }

    // Co-ordinate multiplayer matches via Supabase Realtime Service instead of local grading
    if (currentRoom && gameSyncRef.current && activeRoundRef.current) {
      setAnswerSubmitted(true);
      const elapsedMs = Date.now() - activeRoundRef.current.started_at;
      
      let finalAns = userAns;
      if (q.type === 'CODING_QUESTION') {
        const isCorrect = evaluateLocalAnswer(q, userAns);
        finalAns = {
          clientGraded: 'true',
          isCorrect: isCorrect,
          code: userAns
        };
      }
      
      await gameSyncRef.current.submitAnswer(
        activeRoundRef.current.id,
        finalAns,
        elapsedMs,
        activePowerUps
      );
      return;
    }


    try {
      const isCorrect = evaluateLocalAnswer(q, userAns);

      setIsAnswerCorrect(isCorrect);
      setAnswerSubmitted(true);

      if (isCorrect) {
        playSFX('correct');
        const multiplier = activePowerUps.includes('JOKER') ? 2 : 1;
        const points = (100 + (gameMode !== 'PRACTICE' ? timeLeft * 2 : 0)) * multiplier;
        setScore(prev => prev + points);
        setCorrectAnswersCount(prev => prev + 1);
      } else {
        playSFX('wrong');
        triggerVibrate([100, 50, 100]);
        if (gameMode === 'SURVIVAL') {
          setLives(prev => {
            const nextL = prev - 1;
            if (nextL <= 0) {
              setTimeout(() => finishGame(), 2000);
            }
            return nextL;
          });
        }
        if (isBuzzed && gameMode !== 'PRACTICE') {
          setScore(prev => Math.max(0, prev - 30));
        }
      }

      if (gameMode === 'FREE_FOR_ALL' || gameMode === 'TEAM_BATTLE') {
        setTimeout(() => {
          setOpponentScore(prev => prev + (Math.random() > 0.4 ? 120 : 0));
        }, 800);
      }

      setSoloHistory(prev => [
        ...prev,
        {
          roundNumber: currentQIndex + 1,
          questionText: q.body,
          questionType: q.type,
          isCorrect,
          userAnswer: userAns,
          correctAnswer: q.correctAnswer || q.orderingItems || q.matchingPairs,
          explanation: q.explanation || '',
          timeSpent: 30 - timeLeft
        }
      ]);

    } catch (e) {
      console.error(e);
      const isCorrect = evaluateLocalAnswer(q, userAns);
      setIsAnswerCorrect(isCorrect);
      setAnswerSubmitted(true);
      if (isCorrect) playSFX('correct'); else playSFX('wrong');

      setSoloHistory(prev => [
        ...prev,
        {
          roundNumber: currentQIndex + 1,
          questionText: q.body,
          questionType: q.type,
          isCorrect,
          userAnswer: userAns,
          correctAnswer: q.correctAnswer || q.orderingItems || q.matchingPairs,
          explanation: q.explanation || '',
          timeSpent: 30 - timeLeft
        }
      ]);
    }
  }

  function loadQuestion(index: number) {
    setCurrentQIndex(index);
    setTimeLeft(gameMode === 'PRACTICE' ? 99 : 30);
    setBuzzerActive(gameMode !== 'PRACTICE');
    setIsBuzzed(false);
    setSelectedOption(null);
    setTextAnswer('');
    setMatchingSelections({});
    setActiveLeftTerm(null);
    setAnswerSubmitted(false);
    setIsAnswerCorrect(null);
    setActivePowerUps([]);

    // Sort order IDs synchronously when loading a sorting question
    const nextQ = gameQuestions[index];
    if (nextQ?.type === 'ORDERING_QUESTION' && nextQ.options) {
      const shuffled = [...nextQ.options].sort(() => Math.random() - 0.5);
      setOrderIds(shuffled.map(o => o.id));
    }
  }

  function nextQuestion() {
    playSFX('click');
    const nextIdx = currentQIndex + 1;
    if (nextIdx >= gameQuestions.length || (gameMode === 'SURVIVAL' && lives <= 0)) {
      finishGame();
    } else {
      loadQuestion(nextIdx);
    }
  }

  function finishGame() {
    playSFX('slam');
    setScreen('summary');
    saveUserRewards();
  }

  async function saveUserRewards() {
    if (!user) return;
    const coinsEarned = Math.floor(score / 10);
    const updatedCoins = user.coins + coinsEarned;
    
    let updatedRankPoints = user.rankPoints;
    const nextStats: any = { ...user.stats };

    if (gameMode === 'TIMED_CHALLENGE') {
      updatedRankPoints = user.rankPoints + score;
    } else if (gameMode === 'DAILY_CHALLENGE') {
      const todayDateStr = new Date().toISOString().split('T')[0];
      nextStats.lastDailyChallengeCompleted = todayDateStr;
      updatedRankPoints = user.rankPoints + score;
    } else if (gameMode === 'SURVIVAL') {
      const reachedLevel = currentQIndex + (isAnswerCorrect ? 1 : 0);
      const currentBest = (user.stats as any).bestSurvivalLevel || 0;
      nextStats.lastSurvivalLevel = reachedLevel;
      nextStats.bestSurvivalLevel = Math.max(currentBest, reachedLevel);
    }

    try {
      await supabase
        .from('profiles')
        .update({ 
          coins: gameMode === 'DAILY_CHALLENGE' ? updatedCoins + 50 : updatedCoins,
          rank_points: updatedRankPoints,
          stats: nextStats
        })
        .eq('id', user.id);
        
      refreshProfile(); // Refresh profile state inside auth cleanly
    } catch (e) {
      console.log('Error saving user rewards:', e);
    }
  }

  // ==========================================
  // Redirect if not logged in
  // ==========================================
  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  // Health check polling for Supabase DB
  useEffect(() => {
    const checkSupabase = async () => {
      const startTime = Date.now();
      try {
        const { error } = await supabase.from('profiles').select('id').limit(1);
        if (!error) {
          setApiStatus('online');
          setLatency(Date.now() - startTime);
        } else {
          setApiStatus('offline');
        }
      } catch {
        setApiStatus('offline');
        setLatency(null);
      }
    };

    checkSupabase();
    const interval = setInterval(checkSupabase, 5000);
    return () => clearInterval(interval);
  }, []);

  // Clean up GameSyncService on unmount
  useEffect(() => {
    return () => {
      if (gameSyncRef.current) {
        gameSyncRef.current.disconnect();
        gameSyncRef.current = null;
      }
    };
  }, []);

  // Sync connection status based on Supabase Realtime connectivity status
  useEffect(() => {
    const channel = supabase.channel('global-ping');
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setSocketStatus('connected');
      } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
        setSocketStatus('disconnected');
      } else {
        setSocketStatus('connecting');
      }
    });

    return () => {
      channel.unsubscribe();
    };
  }, []);

  // Handle Game Timer Tick (Only in local solo modes)
  useEffect(() => {
    if (screen !== 'game' || answerSubmitted || currentRoom) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    if (gameMode === 'PRACTICE') {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          handleAutoSubmitWrong();
          return 0;
        }
        if (prev <= 6) {
          playSFX('tick');
          triggerVibrate(30);
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [screen, currentQIndex, answerSubmitted, gameMode, lives, currentRoom]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ==========================================
  // API Operations
  // ==========================================
    const createRoom = async () => {
      playSFX('click');
      try {
        const { data: room, error: roomError } = await supabase.rpc('create_room_secure', {
          p_host_id: user!.id,
          p_type: selectedMode === 'PRACTICE' || selectedMode === 'TIMED_CHALLENGE' || selectedMode === 'SURVIVAL' || selectedMode === 'DAILY_CHALLENGE' ? 'PRIVATE' : 'PUBLIC',
          p_config: {
            mode: selectedMode,
            maxPlayers: selectedMaxPlayers,
            roundsCount: selectedRounds,
            questionTimeLimitSeconds: selectedTimeLimit,
            buzzerType: selectedBuzzer,
            allowedPowerUps: ['JOKER', 'FREEZE', 'SHIELD'],
            categoryWeights: { 'General': 100 }
          }
        });

        if (roomError || !room || room.length === 0) {
          triggerGamingAlert('Failed to create room: ' + (roomError?.message || 'unknown error'), 'error');
          return;
        }

        const roomData = room[0];
        setCurrentRoom(roomData);
        setScreen('lobby');
        
        const sync = new GameSyncService(roomData.id, user!.id, user!.username, true);
        gameSyncRef.current = sync;
        setupGameSyncCallbacks(sync);
        await sync.connect();
      } catch (e) {
        console.error(e);
        triggerGamingAlert('Error creating room.', 'error');
      }
    };

    const joinRoomByCode = async () => {
      playSFX('click');
      if (!roomCodeInput.trim()) return;
      const code = roomCodeInput.trim().toUpperCase();

      try {
        const { data: room, error: roomError } = await supabase
          .from('rooms')
          .select('*')
          .eq('code', code)
          .maybeSingle();

         if (roomError || !room) {
           triggerGamingAlert('Room not found', 'error');
           return;
         }

         if (room.status !== 'WAITING' && !isSpectatorJoin) {
           triggerGamingAlert(isRtl ? 'بدأت اللعبة بالفعل!' : 'Match has already started in this room.', 'error');
           return;
         }

         const { count, error: countError } = await supabase
           .from('room_participants')
           .select('id', { count: 'exact', head: true })
           .eq('room_id', room.id)
           .eq('is_spectator', false);

         if (countError) {
           triggerGamingAlert('Error checking players limit.', 'error');
           return;
         }

         if (!isSpectatorJoin && count && count >= room.max_players) {
           triggerGamingAlert(isRtl ? 'الغرفة ممتلئة!' : 'Room is full', 'error');
           return;
         }

         const { error: joinError } = await supabase
           .from('room_participants')
           .upsert({
             room_id: room.id,
             user_id: user!.id,
             is_host: room.host_id === user!.id,
             is_ready: room.host_id === user!.id,
             score: 0,
             is_spectator: !!isSpectatorJoin
           }, {
             onConflict: 'room_id,user_id'
           });

         if (joinError) {
           triggerGamingAlert('Failed to join room: ' + joinError.message, 'error');
           return;
         }

         const { data: participantsList, error: partError } = await supabase
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
           .eq('room_id', room.id);

         if (partError) {
           triggerGamingAlert('Failed to fetch room participants.', 'error');
           return;
         }

         const formattedParticipants = (participantsList || []).map((p: any) => ({
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

         const roomDetails = {
           ...room,
           participants: formattedParticipants
         };

         setCurrentRoom(roomDetails);
         setParticipants(formattedParticipants);
         setScreen('lobby');

         const sync = new GameSyncService(room.id, user!.id, user!.username, room.host_id === user!.id);
         gameSyncRef.current = sync;
         setupGameSyncCallbacks(sync);
         await sync.connect();
       } catch (e) {
         console.error(e);
         triggerGamingAlert('Error joining room.', 'error');
       }
     };

     const leaveRoom = async () => {
       playSFX('click');
       if (!currentRoom) return;

       try {
         await supabase
           .from('room_participants')
           .delete()
           .eq('room_id', currentRoom.id)
           .eq('user_id', user!.id);

         if (gameSyncRef.current) {
           gameSyncRef.current.disconnect();
           gameSyncRef.current = null;
         }

         setScreen('dashboard');
         setCurrentRoom(null);
         setParticipants([]);
       } catch (e) {
         console.error(e);
       }
     };

     const toggleReady = async () => {
       playSFX('click');
       if (!currentRoom) return;
       
       const self = participants.find(p => p.userId === user!.id);
       const nextReady = !self?.isReady;

       await supabase
         .from('room_participants')
         .update({ is_ready: nextReady })
         .eq('room_id', currentRoom.id)
         .eq('user_id', user!.id);
     };

     const startLobbyGame = async () => {
       playSFX('click');
       if (!currentRoom) return;

       try {
         const roundsLimit = currentRoom.config?.roundsCount || 5;

         const { data: dbQs } = await supabase
           .from('questions')
           .select('id')
           .limit(roundsLimit);

         if (!dbQs || dbQs.length === 0) {
           triggerGamingAlert('No questions found in database schema to start game.', 'error');
           return;
         }

         await supabase
           .from('rooms')
           .update({ status: 'ACTIVE' })
           .eq('id', currentRoom.id);

         const { data: match, error: matchError } = await supabase
           .from('matches')
           .insert({
             room_id: currentRoom.id,
             mode: currentRoom.config?.mode || 'FREE_FOR_ALL',
             total_rounds: roundsLimit,
             status: 'ACTIVE',
             config: currentRoom.config,
             started_at: new Date().toISOString()
           })
           .select()
           .single();

         if (matchError || !match) {
           triggerGamingAlert('Failed to create match: ' + matchError?.message, 'error');
           return;
         }

         const { error: roundError } = await supabase
           .from('match_rounds')
           .insert({
             match_id: match.id,
             round_number: 0,
             question_id: dbQs[0].id,
             started_at: new Date().toISOString()
           });

         if (roundError) {
           triggerGamingAlert('Failed to create first round: ' + roundError.message, 'error');
           return;
         }
       } catch (e) {
         console.error(e);
         triggerGamingAlert('Error starting game.', 'error');
       }
     };

     const updateRoomConfig = async (newConfig: any) => {
       if (!currentRoom || currentRoom.host_id !== user!.id) return;
       const updatedConfig = {
         ...currentRoom.config,
         ...newConfig
       };
       
       await supabase
         .from('rooms')
         .update({
           config: updatedConfig,
           max_players: updatedConfig.maxPlayers || 10
         })
         .eq('id', currentRoom.id);
     };

     const changeTeam = async (teamId: 'team_a' | 'team_b' | null) => {
       playSFX('click');
       if (!currentRoom) return;
       
       if (teamId) {
         const maxPlayers = currentRoom.max_players || 10;
         const maxTeamSize = Math.floor(maxPlayers / 2);
         const teamCount = participants.filter(p => p.teamId === teamId && p.userId !== user!.id).length;
         
         if (teamCount >= maxTeamSize) {
           triggerGamingAlert(
             isRtl 
               ? `الفريق ممتلئ! الحد الأقصى هو ${maxTeamSize} لاعبين.`
               : `Team is full! Maximum is ${maxTeamSize} players.`,
             'warning'
           );
           return;
         }
       }

       await supabase
         .from('room_participants')
         .update({ team_id: teamId })
         .eq('room_id', currentRoom.id)
         .eq('user_id', user!.id);
     };

     const sendChatMessage = () => {
       if (!chatInput.trim() || !gameSyncRef.current) return;
       
       const selfId = user?.id;
       const activeParts = gameSyncRef.current.activeParticipants || [];
       const selfPart = activeParts.find(p => p.userId === selfId);
       const myTeamId = selfPart?.teamId || null;
       const isTeamMode = currentRoom?.config?.mode === 'TEAM_BATTLE';
       
       gameSyncRef.current.sendChatMessage(chatInput.trim(), isTeamMode ? myTeamId : null);
       setChatInput('');
     };

  // ==========================================
  // Game Board Operations
  // ==========================================
  const loadLeaderboardData = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('username, rank, rank_points, coins, stats')
        .order('rank_points', { ascending: false })
        .limit(10);
      if (!error && data) {
        setLeaderboard(data);
      }
    } catch (e) {
      console.error('Error fetching leaderboard:', e);
    }
  };

  const startSoloGame = async (mode: GameModeType) => {
    playSFX('slam');
    setGameMode(mode);
    setScore(0);
    setOpponentScore(0);
    setLives(3);
    setCorrectAnswersCount(0);
    setAnswerSubmitted(false);
    setSoloHistory([]);

    let questionsToLoad = SAMPLE_QUESTIONS;
    try {
      let query = supabase.from('questions').select('*');
      if (mode !== 'DAILY_CHALLENGE') {
        query = query.limit(mode === 'SURVIVAL' ? 20 : 10);
      } else {
        query = query.limit(10);
      }

      const { data, error } = await query;
      if (error) {
        console.error('Error fetching questions from Supabase:', error);
      } else if (data && data.length > 0) {
        questionsToLoad = data.map((q: any) => ({
          id: q.id,
          type: q.type,
          category: q.category,
          body: q.body,
          imageUrl: q.image_url || q.imageUrl,
          options: q.options,
          correctAnswer: q.correct_answer || q.correctAnswer,
          orderingItems: q.ordering_items || q.orderingItems,
          matchingPairs: q.matching_pairs || q.matchingPairs,
          codingTestCases: q.coding_test_cases || q.codingTestCases,
          difficulty: q.difficulty,
          rating: Number(q.rating || 0),
          explanation: q.explanation,
          createdAt: q.created_at ? new Date(q.created_at) : new Date()
        }));
        if (mode !== 'DAILY_CHALLENGE') {
          questionsToLoad.sort(() => Math.random() - 0.5);
        }
      }
    } catch (e) {
      console.error('Error fetching questions:', e);
    }

    setGameQuestions(questionsToLoad);
    setScreen('cinematic');
  };

  function prepareSoloMatchDetails() {
    const totalAnswered = gameQuestions.length;
    const accuracy = totalAnswered > 0 ? Math.round((correctAnswersCount / totalAnswered) * 100) : 0;

    const playerDetail: ReportParticipant = {
      userId: user?.id || 'solo_player',
      username: user?.username || (isRtl ? 'أنت' : 'You'),
      avatarUrl: user?.avatarUrl || null,
      rank: user?.rank || 'Bronze',
      score: score,
      isHost: true,
      isReady: true,
      teamId: null,
      isSpectator: false,
      accuracy,
      correctCount: correctAnswersCount,
      totalAnswered
    };

    setMatchReportDetails({
      players: [playerDetail],
      rounds: (soloHistory as SoloHistoryItem[]).map((h) => ({
        roundNumber: h.roundNumber,
        questionBody: h.questionText,
        questionType: h.questionType,
        answers: [{
          userId: user?.id || 'solo_player',
          username: user?.username || (isRtl ? 'أنت' : 'You'),
          isCorrect: h.isCorrect,
          timeSpentMs: h.timeSpent * 1000,
          pointsEarned: h.isCorrect ? 100 : 0
        }]
      })),
      isMultiplayer: false
    });
  }

  async function fetchMultiplayerMatchDetails() {
    if (!currentRoom) return;
    setLoadingReportDetails(true);
    try {
      // 1. Fetch latest match for the room
      const { data: matches, error: mError } = await supabase
        .from('matches')
        .select('id, total_rounds, started_at, ended_at')
        .eq('room_id', currentRoom.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (mError || !matches || matches.length === 0) {
        console.error("Error fetching match:", mError);
        setLoadingReportDetails(false);
        return;
      }

      const matchId = matches[0].id;

      // 2. Fetch match rounds and questions
      const { data: rounds, error: rError } = await supabase
        .from('match_rounds')
        .select(`
          id,
          round_number,
          question_id,
          questions (
            id,
            body,
            type,
            correct_answer
          )
        `)
        .eq('match_id', matchId)
        .order('round_number', { ascending: true });

      if (rError || !rounds) {
        console.error("Error fetching rounds:", rError);
        setLoadingReportDetails(false);
        return;
      }

      const typedRounds = rounds as unknown as DbRound[];

      // 3. Fetch round answers for all players
      const roundIds = typedRounds.map((r) => r.id);
      const { data: answers, error: aError } = await supabase
        .from('round_answers')
        .select(`
          round_id,
          user_id,
          answer,
          time_spent_ms,
          is_correct,
          points_earned
        `)
        .in('round_id', roundIds);

      if (aError || !answers) {
        console.error("Error fetching answers:", aError);
        setLoadingReportDetails(false);
        return;
      }

      const typedAnswers = answers as unknown as DbAnswer[];

      // 4. Group details by player and by round
      const activePlayers = participants.filter((p) => !p.isSpectator);

      // Compute accuracy rate for each player
      const playerDetails = activePlayers.map((p) => {
        const playerAnswers = typedAnswers.filter((a) => a.user_id === p.userId);
        const correctCount = playerAnswers.filter((a) => a.is_correct).length;
        const totalAnswered = playerAnswers.length;
        const accuracy = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;
        
        return {
          ...p,
          accuracy,
          correctCount,
          totalAnswered,
          answers: playerAnswers
        };
      });

      // Sort playerDetails by score descending
      playerDetails.sort((a, b) => b.score - a.score);

      // Create a round-by-round matrix: each round having list of player answers
      const roundsWithAnswers = typedRounds.map((r) => {
        const roundAnswers = typedAnswers.filter((a) => a.round_id === r.id);
        const qInfo = r.questions;
        return {
          roundNumber: r.round_number,
          questionBody: qInfo?.body || 'Question',
          questionType: qInfo?.type || 'UNKNOWN',
          answers: roundAnswers.map((ans) => {
            const player = activePlayers.find((p) => p.userId === ans.user_id);
            return {
              userId: ans.user_id,
              username: player?.username || 'Player',
              isCorrect: ans.is_correct,
              timeSpentMs: ans.time_spent_ms,
              pointsEarned: ans.points_earned
            };
          })
        };
      });

      setMatchReportDetails({
        players: playerDetails,
        rounds: roundsWithAnswers,
        isMultiplayer: true
      });
    } catch (err) {
      console.error("Exception in fetchMultiplayerMatchDetails:", err);
    } finally {
      setLoadingReportDetails(false);
    }
  }

  // Fetch report details when summary screen is active
  useEffect(() => {
    if (screen === 'summary') {
      setTimeout(() => {
        if (currentRoom) {
          fetchMultiplayerMatchDetails();
        } else {
          prepareSoloMatchDetails();
        }
      }, 0);
    }
  }, [screen, currentRoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const enterGameScreen = () => {
    setScreen('game');
    loadQuestion(0);
  };

  const handleBuzz = async (bid: number = 0) => {
    if (!buzzerActive || isBuzzed) return;
    
    const bt = currentRoom?.config?.buzzerType || 'STANDARD';
    if (bt === 'AUCTION' && bid === 0 && !showBidModal) {
      setShowBidModal(true);
      return;
    }

    if (currentRoom && gameSyncRef.current && activeRoundRef.current) {
      const ok = await gameSyncRef.current.buzz(activeRoundRef.current.id, bid);
      if (ok && (bt === 'HIDDEN' || bt === 'AUCTION')) {
        playSFX('buzz');
        triggerVibrate(150);
        setIsBuzzed(true);
        setBuzzedUser(user!.username);
      }
      return;
    }

    playSFX('buzz');
    triggerVibrate(150);
    setIsBuzzed(true);
    setBuzzedUser(user!.username);
    setTimeLeft(10);
  };

  const activatePowerUp = (type: string) => {
    if (activePowerUps.includes(type)) return;
    playSFX('buzz');
    triggerVibrate(80);
    setActivePowerUps(prev => [...prev, type]);
    setInventoryPowerUps(prev => prev.filter(p => p !== type));

    if (type === 'FREEZE') {
      setTimeLeft(prev => prev + 10);
    }
  };

  // ==========================================
  // Custom Interaction Helpers
  // ==========================================
  const moveOrderItem = (index: number, direction: 'up' | 'down') => {
    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= orderIds.length) return;
    playSFX('click');
    const newOrder = [...orderIds];
    const temp = newOrder[index];
    newOrder[index] = newOrder[nextIndex];
    newOrder[nextIndex] = temp;
    setOrderIds(newOrder);
  };

  const handleMatchingClick = (id: string, side: 'left' | 'right') => {
    playSFX('click');
    if (side === 'left') {
      setActiveLeftTerm(id);
    } else {
      if (activeLeftTerm) {
        setMatchingSelections(prev => ({
          ...prev,
          [activeLeftTerm]: id
        }));
        setActiveLeftTerm(null);
      }
    }
  };

  const toggleMultiSelect = (id: string) => {
    playSFX('click');
    setSelectedOption((prev: string[] | null) => {
      const list = prev || [];
      if (list.includes(id)) {
        return list.filter(item => item !== id);
      } else {
        return [...list, id];
      }
    });
  };

  // ==========================================
  // Bilingual Text Dictionary
  // ==========================================
  const text = {
    en: {
      title: 'MIND RACE',
      play: 'PLAY ARENA',
      soloPractice: 'Solo Practice',
      soloPracticeDesc: 'No timer, study detailed answers',
      timedChallenge: 'Timed Challenge',
      timedChallengeDesc: 'Fast paced scoring, 30s timer',
      survivalMode: 'Survival Arena',
      survivalModeDesc: '3 Lives, wrong answers deduct life',
      multiplayer: 'Custom Battle Room',
      multiplayerDesc: 'Real-time room lobbies with players',
      lobbyTitle: 'Battle Lobby',
      createRoomBtn: 'Host Match Room',
      joinRoomBtn: 'Join Room',
      enterCode: 'Enter 6-char Room Code',
      leaveRoom: 'Leave Lobby',
      readyUp: 'Ready Up',
      cancelReady: 'Cancel Ready',
      startMatch: 'Start Match',
      waitingPlayers: 'Waiting for players...',
      code: 'Room Code',
      mode: 'Game Mode',
      buzzer: 'Buzzer Type',
      score: 'Score',
      lives: 'Lives',
      round: 'Round',
      buzzBtn: 'BUZZ',
      submitBtn: 'SUBMIT ANSWER',
      nextBtn: 'NEXT QUESTION',
      correctText: 'CORRECT ANSWER!',
      wrongText: 'INCORRECT!',
      explanation: 'Explanation',
      timer: 'Timer',
      powerups: 'Power-Ups Inventory',
      summaryTitle: 'Battle Arena Report',
      accuracy: 'Accuracy Rate',
      coinsEarned: 'Coins Gilded',
      xpGained: 'XP Acquired',
      dashboardBtn: 'Return to Hub',
      level: 'LVL',
      isHost: 'HOST',
      vsSlam: 'MATCH READY',
      opponent: 'Opponent',
      matchingInstructions: 'Tap left term, then right definition to link:',
      matchedPair: 'Matched',
      resetMatches: 'Reset Connections',
      victoryTitle: 'Victory',
      defeatTitle: 'Defeat',
      standingsTitle: 'Final Standings',
      detailedReportTitle: 'Match Round Breakdown',
      loadingReport: 'Loading battle details...',
      playerHeader: 'Player',
      rankHeader: 'Rank',
      scoreHeader: 'Score',
      accuracyHeader: 'Accuracy',
      timeHeader: 'Time',
      pointsHeader: 'Points',
      correctLabel: 'Correct',
      incorrectLabel: 'Incorrect',
      noAnswerLabel: 'No Answer',
      expandQuestion: 'Click to expand question body & explanation'
    },
    ar: {
      title: 'سباق العقول',
      play: 'دخول الساحة',
      soloPractice: 'تدريب فردي',
      soloPracticeDesc: 'بدون وقت، عرض الشروحات بالتفصيل',
      timedChallenge: 'تحدي الوقت',
      timedChallengeDesc: 'نقاط إضافية للسرعة، 30 ثانية لكل سؤال',
      survivalMode: 'نمط البقاء',
      survivalModeDesc: '3 محاولات، الإجابة الخاطئة تخصم قلباً',
      multiplayer: 'غرفة مواجهة مخصصة',
      multiplayerDesc: 'لوبي جماعي تفاعلي مباشر مع اللاعبين',
      lobbyTitle: 'لوبي المواجهة',
      createRoomBtn: 'إنشاء غرفة مواجهة',
      joinRoomBtn: 'انضمام للغرفة',
      enterCode: 'أدخل رمز الغرفة المكون من 6 رموز',
      leaveRoom: 'مغادرة اللوبي',
      readyUp: 'مستعد للقتال',
      cancelReady: 'إلغاء الاستعداد',
      startMatch: 'بدء المواجهة',
      waitingPlayers: 'بانتظار انضمام الخصوم...',
      code: 'رمز الغرفة',
      mode: 'نمط اللعب',
      buzzer: 'نوع البازر',
      score: 'النقاط',
      lives: 'المحاولات',
      round: 'السؤال',
      buzzBtn: 'احجز الإجابة',
      submitBtn: 'إرسال الإجابة',
      nextBtn: 'السؤال التالي',
      correctText: 'إجابة نموذجية!',
      wrongText: 'إجابة خاطئة!',
      explanation: 'الشرح والتوضيح',
      timer: 'الوقت المتبقي',
      powerups: 'المخزون النشط للقدرات',
      summaryTitle: 'تقرير ساحة المعركة المعرفية',
      accuracy: 'نسبة الدقة',
      coinsEarned: 'الذهب المكتسب',
      xpGained: 'الخبرة المكتسبة',
      dashboardBtn: 'العودة للمقر الرئيسي',
      level: 'مستوى',
      isHost: 'المالك',
      vsSlam: 'جاهزية المعركة',
      opponent: 'الخصم',
      matchingInstructions: 'اضغط على الكلمة يميناً ثم المعنى المقابل يساراً للتوصيل:',
      matchedPair: 'موصول بـ',
      resetMatches: 'إعادة تعيين التوصيل',
      victoryTitle: 'انتصار ساحق',
      defeatTitle: 'هزيمة',
      standingsTitle: 'الترتيب النهائي',
      detailedReportTitle: 'تفاصيل جولات المواجهة',
      loadingReport: 'جاري تحميل تفاصيل المعركة...',
      playerHeader: 'اللاعب',
      rankHeader: 'المركز',
      scoreHeader: 'النقاط',
      accuracyHeader: 'الدقة',
      timeHeader: 'الوقت',
      pointsHeader: 'النقاط المستحقة',
      correctLabel: 'صحيح',
      incorrectLabel: 'خاطئ',
      noAnswerLabel: 'لم يجب',
      expandQuestion: 'اضغط لعرض نص السؤال والشرح'
    }
  };

  const t = isRtl ? text.ar : text.en;

  if (loading || !user) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#05060f',
        gap: '20px'
      }}>
        <div style={{
          width: '50px',
          height: '50px',
          borderRadius: '50%',
          border: '3px solid rgba(255, 255, 255, 0.05)',
          borderTopColor: '#00f2fe',
          animation: 'spin 1s linear infinite'
        }}></div>
        <span style={{ fontSize: '1.1rem', color: '#8a93c0', fontFamily: 'monospace' }}>
          Initializing Knowledge Arena...
        </span>
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  const selfPart = participants.find(p => p.userId === user?.id);
  const isSpectator = selfPart?.isSpectator || false;

  return (
    <div style={styles.appContainer} dir={isRtl ? 'rtl' : 'ltr'}>
      <div style={styles.arenaFrame}>
        <div style={styles.ambientGrid}></div>

        {/* SCREEN: HOME DASHBOARD */}
        {screen === 'dashboard' && (
          <div style={styles.screenContainer}>
            {viewingLeaderboard ? (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                    <button style={styles.backBtn} onClick={() => setViewingLeaderboard(false)}>◀</button>
                    <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ffffff' }}>
                      {isRtl ? 'لوحة الصدارة العالمية' : 'Global Leaderboard'}
                    </h2>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', maxHeight: '420px', paddingRight: '4px' }}>
                    {leaderboard.map((player, index) => {
                      const isSelf = player.username === user?.username;
                      const badgeColors = ['#ffd700', '#c0c0c0', '#cd7f32'];
                      return (
                        <div 
                          key={player.username}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '10px 14px',
                            backgroundColor: isSelf ? 'rgba(0, 242, 254, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                            border: `1px solid ${isSelf ? '#00f2fe' : 'rgba(255, 255, 255, 0.04)'}`,
                            borderRadius: '8px'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ 
                              fontSize: '1rem', 
                              fontWeight: 900, 
                              color: index < 3 ? badgeColors[index] : '#8a93c0',
                              width: '24px',
                              textAlign: 'center'
                            }}>
                              {index + 1}
                            </span>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#ffffff' }}>
                                {player.username} {isSelf && `(${isRtl ? 'أنت' : 'You'})`}
                              </span>
                              <span style={{ fontSize: '0.7rem', color: '#8a93c0' }}>
                                {player.rank}
                              </span>
                            </div>
                          </div>
                          
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                            <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#00f2fe' }} className="text-glow-accent">
                              {player.rank_points || player.rankPoints || 0} RP
                            </span>
                            {player.stats?.bestSurvivalLevel && (
                              <span style={{ fontSize: '0.65rem', color: '#ffb300' }}>
                                🔥 {isRtl ? 'أفضل بقاء:' : 'Survival Best:'} Lvl {player.stats.bestSurvivalLevel}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={styles.bottomNavMock}>
                  <span style={{ cursor: 'pointer' }} onClick={() => setViewingLeaderboard(false)}>🎒</span>
                  <span>🛒</span>
                  <span>⚔️</span>
                  <span>🏰</span>
                  <span style={{ cursor: 'pointer', ...styles.activeNavTab }} onClick={loadLeaderboardData}>🏆</span>
                </div>
              </div>
            ) : (() => {
              const todayDateStr = new Date().toISOString().split('T')[0];
              const isDailyCompleted = (user.stats as any)?.lastDailyChallengeCompleted === todayDateStr;

              return (
                <>
                  <div style={styles.topProfileBar}>
                    <div style={styles.avatarGroup}>
                      <div style={{
                        ...styles.avatarRing,
                        borderColor: `var(--color-${user.rank.toLowerCase().replace(' ', '')})`
                      }}>
                        👤
                      </div>
                      <div style={styles.levelBadge}>
                        {t.level} 12
                      </div>
                      <div style={styles.xpTrack}>
                        <div style={styles.xpBarFill}></div>
                      </div>
                    </div>

                    <div style={styles.topRightControls}>
                      <span style={styles.walletCount}>🪙 {user.coins}</span>
                      <button style={styles.langBtn} onClick={() => { playSFX('click'); setIsRtl(!isRtl); }}>
                        {isRtl ? 'EN' : 'عربي'}
                      </button>
                      <button style={styles.logoutBtn} onClick={() => { playSFX('click'); signOut(); }}>
                        🚪
                      </button>
                    </div>
                  </div>

                  <div style={styles.rankBadgeCard}>
                    <div style={styles.rankGlowText} className="text-glow">
                      {user.rank}
                    </div>
                    <div style={styles.latencyLabel}>
                      DB: <span style={{ color: apiStatus === 'online' ? '#00ff87' : '#ff3b5c' }}>
                        {apiStatus === 'online' ? `${latency}ms` : 'offline'}
                      </span>
                      {' | '} Realtime: <span style={{ color: socketStatus === 'connected' ? '#00f2fe' : '#ff3b5c' }}>
                        {socketStatus}
                      </span>
                    </div>
                  </div>

                  <div style={styles.titleWrapper}>
                    <h1 style={styles.glowTitle} className="text-glow">{t.title}</h1>
                  </div>

                  <div style={styles.playHeroContainer}>
                    <button 
                      style={styles.playHeroBtn} 
                      onClick={() => startSoloGame('TIMED_CHALLENGE')}
                      className="animate-float"
                    >
                      {t.play}
                    </button>
                  </div>

                  {/* Scrollable middle container to prevent viewport overflow and ensure bottom nav visibility */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', flex: 1, minHeight: 0, margin: '12px 0', paddingRight: '4px' }}>
                    <div style={styles.modesContainer}>
                      <div style={styles.modeCard} onClick={() => startSoloGame('PRACTICE')}>
                        <span style={styles.modeIcon}>⚗️</span>
                        <div style={styles.modeMeta}>
                          <h4 style={styles.modeTitle}>{t.soloPractice}</h4>
                          <p style={styles.modeDesc}>{t.soloPracticeDesc}</p>
                        </div>
                      </div>

                      <div style={styles.modeCard} onClick={() => startSoloGame('SURVIVAL')}>
                        <span style={styles.modeIcon}>❤️</span>
                        <div style={styles.modeMeta}>
                          <h4 style={styles.modeTitle}>{t.survivalMode}</h4>
                          <p style={styles.modeDesc}>{t.survivalModeDesc}</p>
                        </div>
                      </div>

                      <div 
                        style={{
                          ...styles.modeCard,
                          opacity: isDailyCompleted ? 0.75 : 1,
                          borderColor: isDailyCompleted ? '#00ff87' : 'rgba(255, 255, 255, 0.04)'
                        }} 
                        onClick={() => {
                          if (isDailyCompleted) {
                            triggerGamingAlert(
                              isRtl ? 'لقد أنجزت هذا التحدي اليوم بالفعل!' : 'You have already completed this challenge today!',
                              'info'
                            );
                            return;
                          }
                          startSoloGame('DAILY_CHALLENGE');
                        }}
                      >
                        <span style={styles.modeIcon}>📅</span>
                        <div style={styles.modeMeta}>
                          <h4 style={styles.modeTitle}>
                            {isRtl ? 'التحدي اليومي' : 'Daily Challenge'}
                            {isDailyCompleted && <span style={{ color: '#00ff87', marginLeft: '6px', fontSize: '0.8rem' }}>✓</span>}
                          </h4>
                          <p style={styles.modeDesc}>
                            {isDailyCompleted 
                              ? (isRtl ? 'تم إنجازه بنجاح! +50 🪙 مكافأة' : 'Successfully completed! +50 🪙 bonus')
                              : (isRtl ? 'تحدي يومي فريد بنفس الأسئلة للجميع ومكافأة مضاعفة' : 'Unique daily challenge with double rewards')}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div style={styles.multiplayerBox}>
                      <h3 style={styles.multiTitle}>{t.multiplayer}</h3>
                      <p style={styles.multiDesc}>{t.multiplayerDesc}</p>
                      
                      <div style={styles.btnRow}>
                        <button style={styles.cyberBtn} onClick={createRoom}>
                          {t.createRoomBtn}
                        </button>
                      </div>

                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        marginBottom: '10px',
                        fontSize: '0.8rem',
                        color: '#8a93c0',
                        cursor: 'pointer'
                      }} onClick={() => setIsSpectatorJoin(!isSpectatorJoin)}>
                        <input
                          type="checkbox"
                          checked={isSpectatorJoin}
                          onChange={(e) => setIsSpectatorJoin(e.target.checked)}
                          style={{ cursor: 'pointer' }}
                        />
                        <span>{isRtl ? 'الانضمام كمتفرج (رؤية فقط)' : 'Join as Spectator (Watch only)'}</span>
                      </div>

                      <div style={styles.inputJointRow}>
                        <input 
                          style={styles.jointInput} 
                          type="text" 
                          placeholder={t.enterCode}
                          value={roomCodeInput}
                          onChange={(e) => setRoomCodeInput(e.target.value)}
                        />
                        <button style={styles.cyberOutlineBtn} onClick={joinRoomByCode}>
                          {t.joinRoomBtn}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div style={styles.bottomNavMock}>
                    <span style={{ cursor: 'pointer', ...styles.activeNavTab }} onClick={() => setViewingLeaderboard(false)}>🎒</span>
                    <span>🛒</span>
                    <span>⚔️</span>
                    <span>🏰</span>
                    <span style={{ cursor: 'pointer' }} onClick={() => { setViewingLeaderboard(true); loadLeaderboardData(); }}>🏆</span>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* SCREEN: LOBBY SCREEN */}
        {screen === 'lobby' && currentRoom && (() => {
          const selfPart = participants.find(p => p.userId === user?.id);
          const isSpectator = selfPart?.isSpectator || false;
          return (
            <div style={styles.screenContainer}>
              <div style={styles.lobbyHeader}>
                <button style={styles.backBtn} onClick={leaveRoom}>◀</button>
                <h2 style={styles.lobbyTitleText}>{t.lobbyTitle}</h2>
                <span style={styles.configModeBadge}>{currentRoom.config?.mode}</span>
              </div>

              {currentRoom.host_id === user?.id ? (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '10px',
                  padding: '12px 16px',
                  backgroundColor: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.04)',
                  borderRadius: '8px',
                  margin: '12px 0'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.65rem', color: '#8a93c0', fontWeight: 700 }}>
                      {isRtl ? 'نمط اللعب' : 'GAME MODE'}
                    </label>
                    <select
                      value={currentRoom.config?.mode}
                      onChange={(e) => updateRoomConfig({ mode: e.target.value })}
                      style={{
                        backgroundColor: '#0b0d1a',
                        color: '#ffffff',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '4px',
                        padding: '4px 6px',
                        fontSize: '0.8rem',
                        outline: 'none'
                      }}
                    >
                      <option value="FREE_FOR_ALL">Free For All</option>
                      <option value="TEAM_BATTLE">Team Battle</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.65rem', color: '#8a93c0', fontWeight: 700 }}>
                      {isRtl ? 'نوع البازر' : 'BUZZER TYPE'}
                    </label>
                    <select
                      value={currentRoom.config?.buzzerType}
                      onChange={(e) => updateRoomConfig({ buzzerType: e.target.value })}
                      style={{
                        backgroundColor: '#0b0d1a',
                        color: '#ffffff',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '4px',
                        padding: '4px 6px',
                        fontSize: '0.8rem',
                        outline: 'none'
                      }}
                    >
                       <option value="STANDARD">{isRtl ? 'بازر قياسي' : 'Standard'}</option>
                       <option value="RISK">{isRtl ? 'بازر المخاطرة' : 'Risk'}</option>
                       <option value="SAFE">{isRtl ? 'بازر آمن' : 'Safe'}</option>
                       <option value="COMPETITIVE">{isRtl ? 'تنافسي' : 'Competitive'}</option>
                       <option value="SUDDEN_DEATH">{isRtl ? 'الموت المفاجئ' : 'Sudden Death'}</option>
                       <option value="TEAM_RELAY">{isRtl ? 'تتابع الفريق' : 'Team Relay'}</option>
                       <option value="CAPTAIN">{isRtl ? 'بازر القائد' : 'Captain'}</option>
                       <option value="HIDDEN">{isRtl ? 'بازر خفي' : 'Hidden'}</option>
                       <option value="AUCTION">{isRtl ? 'بازر المزاد' : 'Auction'}</option>
                       <option value="TEAM_CONSULTATION">{isRtl ? 'تشاور الفريق' : 'Team Consultation'}</option>
                       <option value="OPEN_DISCUSSION">{isRtl ? 'مناقشة مفتوحة' : 'Open Discussion'}</option>
                     </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.65rem', color: '#8a93c0', fontWeight: 700 }}>
                      {isRtl ? 'عدد الجولات' : 'ROUNDS'}
                    </label>
                    <select
                      value={currentRoom.config?.roundsCount}
                      onChange={(e) => updateRoomConfig({ roundsCount: parseInt(e.target.value) })}
                      style={{
                        backgroundColor: '#0b0d1a',
                        color: '#ffffff',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '4px',
                        padding: '4px 6px',
                        fontSize: '0.8rem',
                        outline: 'none'
                      }}
                    >
                      <option value="5">5 Rounds</option>
                      <option value="10">10 Rounds</option>
                      <option value="15">15 Rounds</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.65rem', color: '#8a93c0', fontWeight: 700 }}>
                      {isRtl ? 'وقت الإجابة' : 'TIME LIMIT'}
                    </label>
                    <select
                      value={currentRoom.config?.questionTimeLimitSeconds}
                      onChange={(e) => updateRoomConfig({ questionTimeLimitSeconds: parseInt(e.target.value) })}
                      style={{
                        backgroundColor: '#0b0d1a',
                        color: '#ffffff',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '4px',
                        padding: '4px 6px',
                        fontSize: '0.8rem',
                        outline: 'none'
                      }}
                    >
                      <option value="15">15 Seconds</option>
                      <option value="30">30 Seconds</option>
                      <option value="45">45 Seconds</option>
                    </select>
                  </div>

                  <div style={{ gridColumn: 'span 2', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px' }}>
                    <span style={{ fontSize: '0.75rem', color: '#8a93c0' }}>{isRtl ? 'رمز الغرفة:' : 'Room Code:'}</span>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#00f2fe' }} className="text-glow-accent">
                      {currentRoom.code}
                    </span>
                  </div>
                </div>
              ) : (
                <div style={styles.roomParamsCard}>
                  <div style={styles.paramItem}>
                    <span style={styles.paramLabel}>{t.code}:</span>
                    <span style={styles.paramVal} className="text-glow-accent">{currentRoom.code}</span>
                  </div>
                  <div style={styles.paramItem}>
                    <span style={styles.paramLabel}>{t.mode}:</span>
                    <span style={styles.paramVal}>{currentRoom.config?.mode}</span>
                  </div>
                  <div style={styles.paramItem}>
                    <span style={styles.paramLabel}>{t.buzzer}:</span>
                    <span style={styles.paramVal}>
                      {(() => {
                        const bt = currentRoom.config?.buzzerType || 'STANDARD';
                        if (bt === 'STANDARD') return isRtl ? 'بازر قياسي' : 'Standard';
                        if (bt === 'RISK') return isRtl ? 'بازر المخاطرة' : 'Risk';
                        if (bt === 'SAFE') return isRtl ? 'بازر آمن' : 'Safe';
                        if (bt === 'COMPETITIVE') return isRtl ? 'تنافسي' : 'Competitive';
                        if (bt === 'SUDDEN_DEATH') return isRtl ? 'الموت المفاجئ' : 'Sudden Death';
                        if (bt === 'TEAM_RELAY') return isRtl ? 'تتابع الفريق' : 'Team Relay';
                        if (bt === 'CAPTAIN') return isRtl ? 'بازر القائد' : 'Captain';
                        if (bt === 'HIDDEN') return isRtl ? 'بازر خفي' : 'Hidden';
                        if (bt === 'AUCTION') return isRtl ? 'بازر المزاد' : 'Auction';
                        if (bt === 'TEAM_CONSULTATION') return isRtl ? 'تشاور الفريق' : 'Team Consultation';
                        if (bt === 'OPEN_DISCUSSION') return isRtl ? 'مناقشة مفتوحة' : 'Open Discussion';
                        return bt;
                      })()}
                    </span>
                  </div>
                </div>
              )}

              {/* PARTICIPANTS / TEAMS VIEW */}
              {currentRoom.config?.mode === 'TEAM_BATTLE' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, margin: '10px 0' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    {/* TEAM A */}
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      padding: '10px',
                      backgroundColor: 'rgba(0, 245, 255, 0.02)',
                      border: '1px solid rgba(0, 245, 255, 0.05)',
                      borderRadius: '8px',
                      minHeight: '160px'
                    }}>
                      <h3 style={{ fontSize: '0.8rem', color: '#00f5ff', textAlign: 'center', margin: '0 0 6px 0', borderBottom: '1px solid rgba(0, 245, 255, 0.1)', paddingBottom: '4px' }}>
                        {isRtl ? 'الفريق أ (الأزرق)' : 'TEAM A (Cyan)'}
                      </h3>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                        {participants.filter(p => !p.isSpectator && p.teamId === 'team_a').map((player) => (
                          <div key={player.userId} style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '6px 10px',
                            backgroundColor: 'rgba(255, 255, 255, 0.02)',
                            border: '1px solid rgba(255, 255, 255, 0.04)',
                            borderRadius: '6px'
                          }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#ffffff' }}>{player.username}</span>
                            <span style={{ fontSize: '0.65rem', color: player.isReady ? '#00ff87' : '#ffb300' }}>
                              {player.isReady ? '✓' : '●'}
                            </span>
                          </div>
                        ))}
                      </div>

                      {!isSpectator && (
                        <button
                          onClick={() => changeTeam('team_a')}
                          disabled={participants.find(p => p.userId === user?.id)?.teamId === 'team_a'}
                          style={{
                            padding: '6px',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            backgroundColor: participants.find(p => p.userId === user?.id)?.teamId === 'team_a' ? 'rgba(255,255,255,0.05)' : 'rgba(0, 245, 255, 0.15)',
                            border: '1px solid rgba(0, 245, 255, 0.3)',
                            borderRadius: '4px',
                            color: '#00f5ff',
                            cursor: participants.find(p => p.userId === user?.id)?.teamId === 'team_a' ? 'default' : 'pointer'
                          }}
                        >
                          {isRtl ? 'انضمام للفريق أ' : 'JOIN TEAM A'}
                        </button>
                      )}
                    </div>

                    {/* TEAM B */}
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      padding: '10px',
                      backgroundColor: 'rgba(255, 59, 92, 0.02)',
                      border: '1px solid rgba(255, 59, 92, 0.05)',
                      borderRadius: '8px',
                      minHeight: '160px'
                    }}>
                      <h3 style={{ fontSize: '0.8rem', color: '#ff3b5c', textAlign: 'center', margin: '0 0 6px 0', borderBottom: '1px solid rgba(255, 59, 92, 0.1)', paddingBottom: '4px' }}>
                        {isRtl ? 'الفريق ب (الأحمر)' : 'TEAM B (Red)'}
                      </h3>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                        {participants.filter(p => !p.isSpectator && p.teamId === 'team_b').map((player) => (
                          <div key={player.userId} style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '6px 10px',
                            backgroundColor: 'rgba(255, 255, 255, 0.02)',
                            border: '1px solid rgba(255, 255, 255, 0.04)',
                            borderRadius: '6px'
                          }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#ffffff' }}>{player.username}</span>
                            <span style={{ fontSize: '0.65rem', color: player.isReady ? '#00ff87' : '#ffb300' }}>
                              {player.isReady ? '✓' : '●'}
                            </span>
                          </div>
                        ))}
                      </div>

                      {!isSpectator && (
                        <button
                          onClick={() => changeTeam('team_b')}
                          disabled={participants.find(p => p.userId === user?.id)?.teamId === 'team_b'}
                          style={{
                            padding: '6px',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            backgroundColor: participants.find(p => p.userId === user?.id)?.teamId === 'team_b' ? 'rgba(255,255,255,0.05)' : 'rgba(255, 59, 92, 0.15)',
                            border: '1px solid rgba(255, 59, 92, 0.3)',
                            borderRadius: '4px',
                            color: '#ff3b5c',
                            cursor: participants.find(p => p.userId === user?.id)?.teamId === 'team_b' ? 'default' : 'pointer'
                          }}
                        >
                          {isRtl ? 'انضمام للفريق ب' : 'JOIN TEAM B'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* UNASSIGNED PLAYERS */}
                  {participants.filter(p => !p.isSpectator && p.teamId !== 'team_a' && p.teamId !== 'team_b').length > 0 && (
                    <div style={{
                      padding: '8px 12px',
                      backgroundColor: 'rgba(255,255,255,0.02)',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      color: '#8a93c0',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '6px',
                      alignItems: 'center'
                    }}>
                      <span>{isRtl ? 'لاعبون غير معينين:' : 'Unassigned:'}</span>
                      {participants.filter(p => !p.isSpectator && p.teamId !== 'team_a' && p.teamId !== 'team_b').map(p => (
                        <span key={p.userId} style={{
                          padding: '2px 6px',
                          backgroundColor: 'rgba(255,255,255,0.04)',
                          borderRadius: '4px',
                          color: '#ffffff'
                        }}>{p.username}</span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={styles.participantsGrid}>
                  {participants.filter(p => !p.isSpectator).map((player) => (
                    <div key={player.userId} style={styles.playerCard}>
                      <div style={styles.playerMetaLeft}>
                        <div style={styles.avatarCircleMock}>👤</div>
                        <div style={styles.playerTexts}>
                          <span style={styles.pCardUsername}>{player.username}</span>
                          <span style={styles.pCardRank}>{player.rank}</span>
                        </div>
                      </div>
                      <div style={styles.playerMetaRight}>
                        {player.isHost && <span style={styles.hostBadge}>{t.isHost}</span>}
                        <span style={{
                          ...styles.lobbyReadyIndicator,
                          color: player.isReady ? '#00ff87' : '#ffb300'
                        }}>
                          {player.isReady ? t.readyUp : t.cancelReady}
                        </span>
                      </div>
                    </div>
                  ))}
                  
                  {participants.filter(p => !p.isSpectator).length < 2 && (
                    <div style={styles.playerCardDashed}>
                      <span style={styles.dashText}>{t.waitingPlayers}</span>
                    </div>
                  )}
                </div>
              )}

              {/* SPECTATORS LIST */}
              {participants.filter(p => p.isSpectator).length > 0 && (
                <div style={{
                  padding: '10px 14px',
                  backgroundColor: 'rgba(255,255,255,0.01)',
                  border: '1px solid rgba(255,255,255,0.03)',
                  borderRadius: '8px',
                  margin: '10px 0'
                }}>
                  <h4 style={{ fontSize: '0.7rem', color: '#8a93c0', margin: '0 0 6px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    👁️ {isRtl ? 'المتفرجون' : 'Spectators'} ({participants.filter(p => p.isSpectator).length})
                  </h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {participants.filter(p => p.isSpectator).map(spec => (
                      <span key={spec.userId} style={{
                        fontSize: '0.75rem',
                        color: '#a0a7cc',
                        backgroundColor: 'rgba(255,255,255,0.03)',
                        padding: '2px 8px',
                        borderRadius: '12px'
                      }}>
                        {spec.username} {spec.userId === user?.id && `(${isRtl ? 'أنت' : 'You'})`}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* CHAT BOX */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                backgroundColor: 'rgba(10, 12, 22, 0.6)',
                margin: '10px 0',
                overflow: 'hidden'
              }}>
                {/* Chat Header */}
                <div style={{
                  padding: '6px 10px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span style={{ fontSize: '0.7rem', color: '#8a93c0', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    💬 {currentRoom?.config?.mode === 'TEAM_BATTLE' 
                      ? (isRtl ? 'دردشة الفريق (الخاصة)' : 'TEAM CHAT (PRIVATE)') 
                      : (isRtl ? 'دردشة الغرفة العامة' : 'ROOM CHAT (GLOBAL)')}
                  </span>
                  {currentRoom?.config?.mode === 'TEAM_BATTLE' && (() => {
                    const selfPart = participants.find(p => p.userId === user?.id);
                    const myTeam = selfPart?.teamId;
                    return (
                      <span style={{ 
                        fontSize: '0.65rem', 
                        color: myTeam === 'team_a' ? '#00f2fe' : myTeam === 'team_b' ? '#ff3b5c' : '#8a93c0', 
                        fontWeight: 'bold' 
                      }}>
                        {myTeam === 'team_a' ? (isRtl ? 'فريق أ' : 'TEAM A') : myTeam === 'team_b' ? (isRtl ? 'فريق ب' : 'TEAM B') : (isRtl ? 'غير معين' : 'UNASSIGNED')}
                      </span>
                    );
                  })()}
                </div>

                {/* Messages List */}
                <div style={{
                  padding: '8px 10px',
                  height: '100px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}>
                  {(() => {
                    const selfPart = participants.find(p => p.userId === user?.id);
                    const myTeamId = selfPart?.teamId || null;
                    const isTeamMode = currentRoom?.config?.mode === 'TEAM_BATTLE';
                    
                    const filteredMessages = chatMessages.filter(msg => {
                      if (isTeamMode) {
                        return !msg.teamId || msg.teamId === myTeamId;
                      }
                      return true;
                    });

                    if (filteredMessages.length === 0) {
                      return (
                        <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.25)', textAlign: 'center', marginTop: '30px' }}>
                          {isRtl ? 'لا توجد رسائل بعد. أرسل رسالة للبدء!' : 'No messages yet. Send a message to start!'}
                        </div>
                      );
                    }

                    return filteredMessages.map((msg, i) => {
                      const isSystem = !msg.sender;
                      let nameColor = '#a0a7cc';
                      if (msg.teamId === 'team_a') nameColor = '#00f2fe';
                      else if (msg.teamId === 'team_b') nameColor = '#ff3b5c';
                      
                      return (
                        <div key={i} style={{ fontSize: '0.75rem', lineHeight: '1.4', wordBreak: 'break-all' }}>
                          {isSystem ? (
                            <span style={{ color: '#ffb300', fontStyle: 'italic' }}>{msg.message}</span>
                          ) : (
                            <>
                              <span style={{ color: nameColor, fontWeight: 700 }}>{msg.sender}: </span>
                              <span style={{ color: '#f0f4ff' }}>{msg.message}</span>
                            </>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>

                {/* Chat Input Field */}
                <div style={{
                  display: 'flex',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  backgroundColor: 'rgba(5, 6, 15, 0.4)'
                }}>
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        sendChatMessage();
                      }
                    }}
                    placeholder={
                      currentRoom?.config?.mode === 'TEAM_BATTLE' 
                        ? (isRtl ? 'اكتب لزملائك في الفريق...' : 'Type to your teammates...') 
                        : (isRtl ? 'اكتب رسالة للغرفة...' : 'Type a message to room...')
                    }
                    style={{
                      flex: 1,
                      backgroundColor: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: '#ffffff',
                      fontSize: '0.75rem',
                      padding: '8px 10px',
                      direction: isRtl ? 'rtl' : 'ltr'
                    }}
                  />
                  <button
                    onClick={sendChatMessage}
                    style={{
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      border: 'none',
                      borderLeft: isRtl ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
                      borderRight: isRtl ? '1px solid rgba(255, 255, 255, 0.08)' : 'none',
                      color: '#4facfe',
                      fontSize: '0.75rem',
                      fontWeight: 'bold',
                      padding: '0 12px',
                      cursor: 'pointer'
                    }}
                  >
                    {isRtl ? 'إرسال' : 'Send'}
                  </button>
                </div>
              </div>

              <div style={styles.lobbyActionsRow}>
                <button style={styles.leaveLobbyBtn} onClick={leaveRoom}>
                  {t.leaveRoom}
                </button>
                
                {!isSpectator && (
                  currentRoom.host_id === user?.id ? (
                    <button 
                      style={styles.startLobbyBtn} 
                      onClick={startLobbyGame}
                      disabled={participants.filter(p => !p.isSpectator).length < 2 || participants.filter(p => !p.isSpectator).some(p => !p.isReady)}
                    >
                      {t.startMatch}
                    </button>
                  ) : (
                    <button 
                      style={{
                        ...styles.startLobbyBtn,
                        backgroundColor: participants.find(p => p.userId === user?.id)?.isReady ? '#ff3b5c' : '#00e676'
                      }} 
                      onClick={toggleReady}
                    >
                      {participants.find(p => p.userId === user?.id)?.isReady ? t.cancelReady : t.readyUp}
                    </button>
                  )
                )}
              </div>
            </div>
          );
        })()}

        {/* SCREEN: MATCH INTRO CINEMATIC */}
        {screen === 'cinematic' && (() => {
          const selfPart = participants.find(p => p.userId === user?.id);
          const myTeamId = selfPart?.teamId;
          const isTeamMode = currentRoom?.config?.mode === 'TEAM_BATTLE';
          
          let leftSideTitle: string = user.username;
          let leftSideSub: string = user.rank;
          let leftSideAvatars = [<div key="self" style={styles.avatarCircleHuge}>👤</div>];
          
          let rightSideTitle: string = t.opponent;
          let rightSideSub: string = 'TITAN I';
          let rightSideAvatars = [<div key="opp" style={styles.avatarCircleHuge}>🤖</div>];
          
          if (currentRoom) {
            // Multiplayer Match
            if (isTeamMode) {
              const myTeamPlayers = participants.filter(p => !p.isSpectator && p.teamId === myTeamId);
              const oppTeamPlayers = participants.filter(p => !p.isSpectator && p.teamId !== myTeamId && p.teamId !== null);
              
              leftSideTitle = myTeamId === 'team_a' ? (isRtl ? 'الفريق أ' : 'TEAM A') : (isRtl ? 'الفريق ب' : 'TEAM B');
              leftSideSub = `${myTeamPlayers.length} ${isRtl ? 'لاعبين' : 'Players'}`;
              leftSideAvatars = myTeamPlayers.map((p) => (
                <div key={p.userId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={styles.avatarCircleHuge}>👤</div>
                  <span style={{ fontSize: '0.8rem', color: '#ffffff', marginTop: '4px' }}>{p.username}</span>
                </div>
              ));
              
              rightSideTitle = myTeamId === 'team_a' ? (isRtl ? 'الفريق ب' : 'TEAM B') : (isRtl ? 'الفريق أ' : 'TEAM A');
              rightSideSub = `${oppTeamPlayers.length} ${isRtl ? 'لاعبين' : 'Players'}`;
              rightSideAvatars = oppTeamPlayers.map((p) => (
                <div key={p.userId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={styles.avatarCircleHuge}>👤</div>
                  <span style={{ fontSize: '0.8rem', color: '#ffffff', marginTop: '4px' }}>{p.username}</span>
                </div>
              ));
            } else {
              // FFA or 1v1
              const opponents = participants.filter(p => !p.isSpectator && p.userId !== user?.id);
              if (opponents.length === 1) {
                // 1v1 Match
                const opp = opponents[0];
                rightSideTitle = opp.username;
                rightSideSub = opp.rank || 'Bronze';
                rightSideAvatars = [
                  <div key={opp.userId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={styles.avatarCircleHuge}>👤</div>
                  </div>
                ];
              } else if (opponents.length > 1) {
                // FFA with multiple players
                rightSideTitle = isRtl ? 'المنافسون' : 'ARENA OPPONENTS';
                rightSideSub = `${opponents.length} ${isRtl ? 'خصوماً' : 'Players'}`;
                rightSideAvatars = opponents.slice(0, 3).map((p) => (
                  <div key={p.userId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '0 4px' }}>
                    <div style={{ ...styles.avatarCircleHuge, width: '60px', height: '60px', fontSize: '1.5rem' }}>👤</div>
                    <span style={{ fontSize: '0.7rem', color: '#a8b0d3', marginTop: '4px', maxWidth: '70px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.username}
                    </span>
                  </div>
                ));
              }
            }
          }
          
          return (
            <div style={styles.cinematicOverlay} onClick={enterGameScreen}>
              <div style={styles.cinematicPulseText} className="text-glow">
                {t.vsSlam}
              </div>
              
              <div style={styles.cinematicFlexRow}>
                <div style={{ ...styles.cinematicTeamSide, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {leftSideAvatars}
                  </div>
                  <div style={{ ...styles.teamSlamName, marginTop: '8px' }}>{leftSideTitle}</div>
                  <div style={styles.teamSlamRank}>{leftSideSub}</div>
                </div>

                <div style={styles.cinematicVsText}>VS</div>

                <div style={{ ...styles.cinematicTeamSide, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {rightSideAvatars}
                  </div>
                  <div style={{ ...styles.teamSlamName, marginTop: '8px' }}>{rightSideTitle}</div>
                  <div style={styles.teamSlamRank}>{rightSideSub}</div>
                </div>
              </div>

              <div style={styles.cinematicInstructions}>
                {isRtl ? '(اضغط على الشاشة للبدء)' : '(Tap Screen to Begin)'}
              </div>
            </div>
          );
        })()}

        {/* SCREEN: GAME BOARD */}
        {screen === 'game' && gameQuestions.length > 0 && (() => {
          const bt = currentRoom?.config?.buzzerType || 'STANDARD';
          const selfPart = participants.find(p => p.userId === user?.id);
          const myTeamId = selfPart?.teamId || null;
          
          const buzzedPlayerPart = participants.find(p => p.username === buzzedUser);
          const buzzedTeamId = buzzedPlayerPart?.teamId || null;
          const isMyTeamBuzzed = isBuzzed && (buzzedUser === user?.username || (myTeamId !== null && myTeamId === buzzedTeamId));
          
          const isInputDisabled = answerSubmitted || isSpectator || 
            (isBuzzed && !isMyTeamBuzzed) || 
            (isBuzzed && buzzedUser !== user?.username && bt !== 'TEAM_CONSULTATION');
          const isTeamMode = gameMode === 'TEAM_BATTLE';
          
          let leftTeamName: string = user?.username || 'Player';
          let leftTeamScore = score;
          let rightTeamName: string = t.opponent;
          let rightTeamScore = opponentScore;
          
          if (isTeamMode) {
            const teamAScore = participants
              .filter(p => !p.isSpectator && p.teamId === 'team_a')
              .reduce((sum, p) => sum + p.score, 0);
            const teamBScore = participants
              .filter(p => !p.isSpectator && p.teamId === 'team_b')
              .reduce((sum, p) => sum + p.score, 0);
              
            if (myTeamId === 'team_b') {
              leftTeamName = isRtl ? 'فريقك (ب)' : 'YOUR TEAM (B)';
              leftTeamScore = teamBScore;
              rightTeamName = isRtl ? 'الخصم (أ)' : 'OPPONENTS (A)';
              rightTeamScore = teamAScore;
            } else {
              leftTeamName = isRtl ? 'فريقك (أ)' : 'YOUR TEAM (A)';
              leftTeamScore = teamAScore;
              rightTeamName = isRtl ? 'الخصم (ب)' : 'OPPONENTS (B)';
              rightTeamScore = teamBScore;
            }
          } else if (currentRoom && gameMode === 'FREE_FOR_ALL') {
            // Free For All (with other players)
            const activePlayersSorted = [...participants]
              .filter(p => !p.isSpectator)
              .sort((a, b) => b.score - a.score);
              
            const myIndex = activePlayersSorted.findIndex(p => p.userId === user?.id);
            const myRank = myIndex !== -1 ? myIndex + 1 : '-';
            
            const bestOpponent = activePlayersSorted.find(p => p.userId !== user?.id);
            rightTeamName = bestOpponent ? `${bestOpponent.username}` : t.opponent;
            rightTeamScore = bestOpponent ? bestOpponent.score : 0;
            
            leftTeamName = `${user?.username} (#${myRank})`;
            leftTeamScore = score;
          } else {
            // 1v1 or Solo Training
            const opponentPlayer = participants.find(p => p.userId !== user?.id && !p.isSpectator);
            if (opponentPlayer) {
              rightTeamName = opponentPlayer.username;
              rightTeamScore = opponentPlayer.score;
            }
          }

          return (
            <div style={styles.screenContainer}>
              {/* FLOATING QUICK SIGNAL OVERLAY */}
              {floatingMessage && (
                <div className="animate-float" style={{
                  position: 'absolute',
                  bottom: '160px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 999,
                  backgroundColor: 'rgba(17, 21, 40, 0.95)',
                  border: `1px solid ${floatingMessage.teamId === 'team_a' ? '#00f2fe' : floatingMessage.teamId === 'team_b' ? '#ff3b5c' : 'rgba(255, 255, 255, 0.15)'}`,
                  borderRadius: '20px',
                  padding: '8px 16px',
                  boxShadow: '0 0 20px rgba(0, 0, 0, 0.6), 0 0 10px rgba(0, 242, 254, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  maxWidth: '85%',
                  pointerEvents: 'none'
                }}>
                  <span style={{ fontSize: '0.85rem' }}>📣</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: floatingMessage.teamId === 'team_a' ? '#00f2fe' : floatingMessage.teamId === 'team_b' ? '#ff3b5c' : '#ffffff' }}>
                    {floatingMessage.sender}:
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#f0f4ff', fontWeight: 600 }}>
                    {floatingMessage.message}
                  </span>
                </div>
              )}

              <div style={styles.hudBar}>
                <div style={styles.hudTeamPanel}>
                  <span style={styles.hudTeamName}>{leftTeamName}</span>
                  <span style={styles.hudTeamScore}>{leftTeamScore} pts</span>
                  {gameMode === 'SURVIVAL' && (
                    <div style={styles.heartsRow}>
                      {Array.from({ length: 3 }).map((_, i) => (
                        <span key={i} style={{ opacity: i < lives ? 1 : 0.2 }}>❤️</span>
                      ))}
                    </div>
                  )}
                </div>

                <div style={styles.hudTimerPanel}>
                  <div style={{
                    ...styles.timerCircularRing,
                    borderColor: gameMode === 'PRACTICE' ? '#8a93c0' : timeLeft <= 5 ? '#ff3b5c' : '#00f2fe',
                    animation: (gameMode !== 'PRACTICE' && timeLeft <= 5) ? 'pulse-glow 0.5s infinite' : 'none'
                  }}>
                    {gameMode === 'PRACTICE' ? '∞' : timeLeft}
                  </div>
                  <span style={styles.hudRoundCounter}>{t.round} {currentQIndex + 1}/{gameQuestions.length}</span>
                </div>

                <div style={{ ...styles.hudTeamPanel, alignItems: 'flex-end' }}>
                  <span style={styles.hudTeamName} className="text-glow-accent">{rightTeamName}</span>
                  <span style={styles.hudTeamScore}>{rightTeamScore} pts</span>
                </div>
              </div>

              {/* Live Leaderboard for FFA/Multiplayer */}
              {gameMode === 'FREE_FOR_ALL' && participants.filter(p => !p.isSpectator).length > 2 && (
                <div style={{
                  display: 'flex',
                  gap: '6px',
                  padding: '6px 12px',
                  overflowX: 'auto',
                  backgroundColor: 'rgba(0,0,0,0.3)',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none'
                }}>
                  {[...participants]
                    .filter(p => !p.isSpectator)
                    .sort((a, b) => b.score - a.score)
                    .map((p, idx) => {
                      const isSelf = p.userId === user?.id;
                      return (
                        <div key={p.userId} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '2px 8px',
                          backgroundColor: isSelf ? 'rgba(0, 245, 255, 0.1)' : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${isSelf ? '#00f5ff' : 'rgba(255,255,255,0.08)'}`,
                          borderRadius: '12px',
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          color: isSelf ? '#00f5ff' : '#8a93c0'
                        }}>
                          <span>#{idx + 1}</span>
                          <span>{p.username}</span>
                          <span style={{ color: '#ffffff' }}>{p.score}</span>
                        </div>
                      );
                    })}
                </div>
              )}

              <div style={styles.questionZone}>
                <div style={styles.qHeaderRow}>
                  <span style={styles.categoryBadge}>{gameQuestions[currentQIndex].category}</span>
                  <span style={styles.difficultyBadge}>{gameQuestions[currentQIndex].difficulty}</span>
                </div>
                
                <div style={styles.qTextBody}>
                  {gameQuestions[currentQIndex].body}
                </div>

                {/* Buzzer Alert */}
                {isBuzzed && buzzedUser && (
                  <div style={{
                    ...styles.buzzedAlertBadge,
                    borderColor: buzzedUser === user?.username ? '#00ff87' : '#ff3b5c',
                    backgroundColor: buzzedUser === user?.username ? 'rgba(0, 255, 135, 0.08)' : 'rgba(255, 59, 92, 0.08)'
                  }}>
                    🚨 {buzzedUser} buzzed in!
                  </div>
                )}

                {gameQuestions[currentQIndex].imageUrl && (
                  <div style={styles.questionImageFrame}>
                    <img src={gameQuestions[currentQIndex].imageUrl} alt="Question Graphic" style={styles.questionImage} />
                  </div>
                )}
              </div>

              <div style={styles.answerZone}>
                
                {(gameQuestions[currentQIndex].type === 'MULTIPLE_CHOICE' ||
                  gameQuestions[currentQIndex].type === 'CIRCUIT_QUESTION' ||
                  gameQuestions[currentQIndex].type === 'IMAGE_QUESTION') && (
                  <div style={styles.mcqGrid}>
                    {gameQuestions[currentQIndex].options?.map((opt) => (
                      <button
                        key={opt.id}
                        disabled={isInputDisabled}
                        onClick={() => {
                          playSFX('click');
                          setSelectedOption(opt.id);
                          if (bt === 'TEAM_CONSULTATION' && currentRoom && gameSyncRef.current) {
                            const selfId = user?.id;
                            const activeParts = gameSyncRef.current.activeParticipants || [];
                            const selfPart = activeParts.find(p => p.userId === selfId);
                            const myTeamId = selfPart?.teamId || null;
                            gameSyncRef.current.sendChatMessage('__VOTE__:' + opt.id, myTeamId);
                          }
                        }}
                        style={{
                          ...styles.answerCardBtn,
                          borderColor: selectedOption === opt.id ? '#00f2fe' : 'rgba(255, 255, 255, 0.08)',
                          backgroundColor: selectedOption === opt.id ? 'rgba(0, 242, 254, 0.08)' : 'rgba(17, 19, 31, 0.65)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          width: '100%'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={styles.optLetterBadge}>{opt.id.toUpperCase()}</span>
                          <span style={styles.optText}>{opt.text}</span>
                        </div>
                        {bt === 'TEAM_CONSULTATION' && teammateVotes[opt.id]?.length > 0 && (
                          <div style={{
                            display: 'flex',
                            gap: '4px',
                            alignItems: 'center',
                            fontSize: '0.75rem',
                            backgroundColor: 'rgba(0, 242, 254, 0.2)',
                            padding: '2px 8px',
                            borderRadius: '10px',
                            color: '#00f2fe'
                          }}>
                            👥 {teammateVotes[opt.id].length} ({teammateVotes[opt.id].join(', ')})
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {gameQuestions[currentQIndex].type === 'TRUE_FALSE' && (
                  <div style={styles.tfStack}>
                    <button
                      disabled={isInputDisabled}
                      onClick={() => {
                        playSFX('click');
                        setSelectedOption('true');
                        if (bt === 'TEAM_CONSULTATION' && currentRoom && gameSyncRef.current) {
                          const selfId = user?.id;
                          const activeParts = gameSyncRef.current.activeParticipants || [];
                          const selfPart = activeParts.find(p => p.userId === selfId);
                          const myTeamId = selfPart?.teamId || null;
                          gameSyncRef.current.sendChatMessage('__VOTE__:true', myTeamId);
                        }
                      }}
                      style={{
                        ...styles.tfCardBtn,
                        borderColor: selectedOption === 'true' ? '#00ff87' : 'rgba(255, 255, 255, 0.08)',
                        backgroundColor: selectedOption === 'true' ? 'rgba(0, 255, 135, 0.08)' : 'rgba(17, 19, 31, 0.65)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px'
                      }}
                    >
                      <span>✓ TRUE / صحيح</span>
                      {bt === 'TEAM_CONSULTATION' && teammateVotes['true']?.length > 0 && (
                        <div style={{
                          fontSize: '0.75rem',
                          backgroundColor: 'rgba(0, 255, 135, 0.2)',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          color: '#00ff87'
                        }}>
                          👥 {teammateVotes['true'].length} ({teammateVotes['true'].join(', ')})
                        </div>
                      )}
                    </button>
                    <button
                      disabled={isInputDisabled}
                      onClick={() => {
                        playSFX('click');
                        setSelectedOption('false');
                        if (bt === 'TEAM_CONSULTATION' && currentRoom && gameSyncRef.current) {
                          const selfId = user?.id;
                          const activeParts = gameSyncRef.current.activeParticipants || [];
                          const selfPart = activeParts.find(p => p.userId === selfId);
                          const myTeamId = selfPart?.teamId || null;
                          gameSyncRef.current.sendChatMessage('__VOTE__:false', myTeamId);
                        }
                      }}
                      style={{
                        ...styles.tfCardBtn,
                        borderColor: selectedOption === 'false' ? '#ff3b5c' : 'rgba(255, 255, 255, 0.08)',
                        backgroundColor: selectedOption === 'false' ? 'rgba(255, 59, 92, 0.08)' : 'rgba(17, 19, 31, 0.65)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px'
                      }}
                    >
                      <span>✕ FALSE / خطأ</span>
                      {bt === 'TEAM_CONSULTATION' && teammateVotes['false']?.length > 0 && (
                        <div style={{
                          fontSize: '0.75rem',
                          backgroundColor: 'rgba(255, 59, 92, 0.2)',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          color: '#ff3b5c'
                        }}>
                          👥 {teammateVotes['false'].length} ({teammateVotes['false'].join(', ')})
                        </div>
                      )}
                    </button>
                  </div>
                )}

                {(gameQuestions[currentQIndex].type === 'FILL_IN_THE_BLANK' ||
                  gameQuestions[currentQIndex].type === 'CALCULATION_QUESTION') && (
                  <div style={styles.blankInputWrapper}>
                    <input
                      style={styles.blankInputField}
                      type="text"
                      disabled={isInputDisabled}
                      placeholder="Type answer here..."
                      value={textAnswer}
                      onChange={(e) => setTextAnswer(e.target.value)}
                    />
                  </div>
                )}

                {gameQuestions[currentQIndex].type === 'ORDERING_QUESTION' && (
                  <div style={styles.orderingContainer}>
                    {orderIds.map((id, index) => {
                      const opt = gameQuestions[currentQIndex].options?.find(o => o.id === id);
                      return (
                        <div key={id} style={styles.orderingCard}>
                          <span style={styles.orderLabelBadge}>{index + 1}</span>
                          <span style={styles.orderingText}>{opt?.text}</span>
                          <div style={styles.orderControls}>
                            <button 
                              disabled={isInputDisabled || index === 0} 
                              onClick={() => moveOrderItem(index, 'up')}
                              style={styles.orderArrowBtn}
                            >
                              ▲
                            </button>
                            <button 
                              disabled={isInputDisabled || index === orderIds.length - 1} 
                              onClick={() => moveOrderItem(index, 'down')}
                              style={styles.orderArrowBtn}
                            >
                              ▼
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {gameQuestions[currentQIndex].type === 'MATCHING_QUESTION' && (
                  <div style={styles.matchingPanel}>
                    <div style={styles.matchingDesc}>{t.matchingInstructions}</div>
                    <div style={styles.matchingColumns}>
                      <div style={styles.matchingCol}>
                        {gameQuestions[currentQIndex].matchingPairs?.map(pair => (
                          <button
                            key={pair.leftId}
                            disabled={isInputDisabled}
                            onClick={() => handleMatchingClick(pair.leftId, 'left')}
                            style={{
                              ...styles.matchCardBtn,
                              borderColor: activeLeftTerm === pair.leftId ? '#00f2fe' : matchingSelections[pair.leftId] ? '#00ff87' : 'rgba(255, 255, 255, 0.08)',
                              backgroundColor: matchingSelections[pair.leftId] ? 'rgba(0, 255, 135, 0.04)' : 'transparent'
                            }}
                          >
                            {pair.leftText}
                          </button>
                        ))}
                      </div>

                      <div style={styles.matchingCol}>
                        {gameQuestions[currentQIndex].matchingPairs?.map(pair => {
                          const isConnected = Object.values(matchingSelections).includes(pair.rightId);
                          const leftConnectedId = Object.keys(matchingSelections).find(key => matchingSelections[key] === pair.rightId);
                          const leftText = leftConnectedId ? gameQuestions[currentQIndex].matchingPairs?.find(p => p.leftId === leftConnectedId)?.leftText.split('/')[0] : '';
                          
                          return (
                            <button
                              key={pair.rightId}
                              disabled={isInputDisabled}
                              onClick={() => handleMatchingClick(pair.rightId, 'right')}
                              style={{
                                ...styles.matchCardBtn,
                                borderColor: isConnected ? '#00ff87' : 'rgba(255, 255, 255, 0.08)',
                                backgroundColor: isConnected ? 'rgba(0, 255, 135, 0.04)' : 'transparent'
                              }}
                            >
                              <div>{pair.rightText}</div>
                              {isConnected && (
                                <div style={styles.connectedMatchLabel}>
                                  {t.matchedPair}: {leftText}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {!isInputDisabled && (
                      <button style={styles.resetMatchBtn} onClick={() => setMatchingSelections({})}>
                        {t.resetMatches}
                      </button>
                    )}
                  </div>
                )}

                {gameQuestions[currentQIndex].type === 'MULTI_SELECT' && (
                  <div style={styles.mcqGrid}>
                    {gameQuestions[currentQIndex].options?.map((opt) => {
                      const isSelected = (selectedOption || []).includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          disabled={isInputDisabled}
                          onClick={() => toggleMultiSelect(opt.id)}
                          style={{
                            ...styles.answerCardBtn,
                            borderColor: isSelected ? '#00f2fe' : 'rgba(255, 255, 255, 0.08)',
                            backgroundColor: isSelected ? 'rgba(0, 242, 254, 0.08)' : 'rgba(17, 19, 31, 0.65)'
                          }}
                        >
                          <span style={styles.optLetterBadge}>
                            {isSelected ? '✓' : opt.id.toUpperCase()}
                          </span>
                          <span style={styles.optText}>{opt.text}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {gameQuestions[currentQIndex].type === 'CODING_QUESTION' && (
                  <div style={styles.codingWorkspace}>
                    <textarea
                      style={styles.codeTextarea}
                      disabled={isInputDisabled}
                      value={textAnswer}
                      placeholder={`function sum(a, b) {\n  // write code here\n}`}
                      onChange={(e) => setTextAnswer(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {answerSubmitted && (
                <div style={{
                  ...styles.feedbackPanel,
                  borderColor: isAnswerCorrect ? '#00ff87' : '#ff3b5c',
                  backgroundColor: isAnswerCorrect ? 'rgba(0, 255, 135, 0.05)' : 'rgba(255, 59, 92, 0.05)'
                }}>
                  <div style={{
                    ...styles.feedbackTitle,
                    color: isAnswerCorrect ? '#00ff87' : '#ff3b5c'
                  }}>
                    {isAnswerCorrect ? t.correctText : t.wrongText}
                  </div>
                  {revealedCorrectAnswer && (
                    <div style={{ fontSize: '0.8rem', color: '#ffffff', margin: '4px 0' }}>
                      <strong>{isRtl ? 'الإجابة الصحيحة:' : 'Correct Answer:'}</strong> {JSON.stringify(revealedCorrectAnswer)}
                    </div>
                  )}
                  <div style={styles.explanationText}>
                    <strong>{t.explanation}:</strong> {gameQuestions[currentQIndex].explanation}
                  </div>
                </div>
              )}

              <div style={styles.gameActionBar}>
                {isSpectator ? (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    padding: '10px',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    borderRadius: '8px',
                    color: '#8a93c0',
                    fontSize: '0.95rem',
                    fontWeight: 700,
                    letterSpacing: '1px',
                    textAlign: 'center',
                    animation: 'pulse-glow 2s infinite'
                  }}>
                    👁️ {isRtl ? 'وضع المتفرج · شاشة عرض فقط' : 'SPECTATOR MODE · READ ONLY'}
                  </div>
                ) : (
                  <>
                    <div style={styles.powerUpInventoryBox}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={styles.inventoryTitle}>{t.powerups}</span>
                        {isTeamMode && (
                          <div style={{ position: 'relative' }}>
                            <button
                              onClick={() => setShowSignalMenu(!showSignalMenu)}
                              style={{
                                backgroundColor: 'rgba(0, 242, 254, 0.1)',
                                border: '1px solid rgba(0, 242, 254, 0.3)',
                                borderRadius: '4px',
                                padding: '2px 6px',
                                fontSize: '0.6rem',
                                color: '#00f2fe',
                                cursor: 'pointer',
                                fontWeight: 700,
                                outline: 'none'
                              }}
                            >
                              📣 {isRtl ? 'إشارة' : 'SIGNAL'}
                            </button>
                            {showSignalMenu && (
                              <div style={{
                                position: 'absolute',
                                bottom: '24px',
                                right: isRtl ? 'auto' : 0,
                                left: isRtl ? 0 : 'auto',
                                backgroundColor: '#111528',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '6px',
                                padding: '4px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '4px',
                                zIndex: 1000,
                                width: '120px',
                                boxShadow: '0 0 10px rgba(0,0,0,0.5)'
                              }}>
                                {[
                                  { text: isRtl ? "ساعدني هنا!" : "Need help!", icon: "🆘" },
                                  { text: isRtl ? "جمّده!" : "Freeze them!", icon: "❄️" },
                                  { text: isRtl ? "ركّز!" : "Focus!", icon: "🎯" },
                                  { text: isRtl ? "أعرف الإجابة!" : "I know this!", icon: "🧠" }
                                ].map((sig, idx) => (
                                  <button
                                    key={idx}
                                    onClick={() => {
                                      const activeParts = gameSyncRef.current?.activeParticipants || [];
                                      const selfPart = activeParts.find(p => p.userId === user?.id);
                                      const myTeamId = selfPart?.teamId || null;
                                      gameSyncRef.current?.sendChatMessage(sig.text, myTeamId);
                                      setShowSignalMenu(false);
                                      playSFX('click');
                                    }}
                                    style={{
                                      backgroundColor: 'transparent',
                                      border: 'none',
                                      color: '#ffffff',
                                      padding: '4px 6px',
                                      fontSize: '0.65rem',
                                      textAlign: isRtl ? 'right' : 'left',
                                      cursor: 'pointer',
                                      borderRadius: '4px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      direction: isRtl ? 'rtl' : 'ltr',
                                      width: '100%'
                                    }}
                                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)')}
                                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                                  >
                                    <span>{sig.icon}</span>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sig.text}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div style={styles.powerupList}>
                        {inventoryPowerUps.map((p) => (
                          <button
                            key={p}
                            disabled={answerSubmitted}
                            onClick={() => activatePowerUp(p)}
                            style={{
                              ...styles.powerUpChipBtn,
                              backgroundColor: activePowerUps.includes(p) ? '#00f2fe' : 'rgba(255, 255, 255, 0.04)',
                              color: activePowerUps.includes(p) ? '#05060f' : '#f0f4ff',
                              borderColor: activePowerUps.includes(p) ? '#00f2fe' : 'rgba(255, 255, 255, 0.08)'
                            }}
                          >
                            {p === 'JOKER' && '⚡ Joker'}
                            {p === 'FREEZE' && '❄ Freeze'}
                            {p === 'SHIELD' && '🛡 Shield'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {buzzerActive && !isBuzzed && !answerSubmitted && (
                      <button style={styles.buzzerCircBtn} onClick={() => handleBuzz(0)}>
                        {t.buzzBtn}
                      </button>
                    )}

                    {/* Answering State */}
                    {(!buzzerActive || (isBuzzed && buzzedUser === user?.username)) && !answerSubmitted && (
                      <button style={styles.submitAnsBtn} onClick={submitAnswer}>
                        {t.submitBtn}
                      </button>
                    )}

                    {/* Waiting state for buzzer matches */}
                    {isBuzzed && buzzedUser !== user?.username && !answerSubmitted && (
                      <div style={styles.waitingForPlayerMessage}>
                        {bt === 'TEAM_CONSULTATION' && isMyTeamBuzzed ? (
                          <div style={{ color: '#00f2fe', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', textAlign: 'center' }}>
                            <span style={{ fontWeight: 'bold' }}>👥 {isRtl ? 'تشاور الفريق: صوّت على الإجابة الصحيحة مع فريقك!' : 'TEAM CONSULTATION: Vote on the correct answer with your team!'}</span>
                            <span style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.6)' }}>
                              {isRtl ? '(صوتك يظهر فوراً لزملائك، وسيتم تقديم خيار الأغلبية)' : '(Your vote is shared instantly; majority choice will be submitted)'}
                            </span>
                          </div>
                        ) : (
                          isRtl ? 'بانتظار إجابة الخصم...' : 'Waiting for opponent to answer...'
                        )}
                      </div>
                    )}

                    {answerSubmitted && !currentRoom && (
                      <button style={styles.nextQBtn} onClick={nextQuestion}>
                        {t.nextBtn}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {/* SCREEN: GAME SUMMARY */}
        {/* SCREEN: GAME SUMMARY */}
        {screen === 'summary' && (
          <div style={styles.screenContainer}>
            {loadingReportDetails ? (
              <div style={{ ...styles.statCard, padding: '40px', gap: '16px', justifyContent: 'center' }}>
                <span className="animate-float" style={{ fontSize: '3rem' }}>⏳</span>
                <span style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--primary)' }}>
                  {t.loadingReport}
                </span>
              </div>
            ) : matchReportDetails ? (() => {
              const players = matchReportDetails.players as ReportParticipant[];
              const rounds = matchReportDetails.rounds as MatchReportData['rounds'];
              
              // Determine Victory/Defeat
              const isTeamMode = currentRoom?.config?.mode === 'TEAM_BATTLE';
              const myParticipant = players.find(p => p.userId === user?.id);
              const myTeamId = myParticipant?.teamId || null;

              const teamAScore = players
                .filter(p => p.teamId === 'team_a')
                .reduce((sum, p) => sum + p.score, 0);
              const teamBScore = players
                .filter(p => p.teamId === 'team_b')
                .reduce((sum, p) => sum + p.score, 0);

              let isVictory = false;
              if (isTeamMode && myTeamId) {
                const myTeamScore = myTeamId === 'team_a' ? teamAScore : teamBScore;
                const oppTeamScore = myTeamId === 'team_a' ? teamBScore : teamAScore;
                isVictory = myTeamScore >= oppTeamScore;
              } else {
                const topScore = players.length > 0 ? players[0].score : 0;
                isVictory = !currentRoom 
                  ? (gameQuestions.length > 0 ? (correctAnswersCount / gameQuestions.length) >= 0.5 : true)
                  : (score >= topScore && score > 0);
              }

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%' }}>
                  
                  {/* Victory/Defeat Premium Banner */}
                  <div 
                    className={isVictory ? "victory-banner" : "defeat-banner"}
                    style={{
                      borderRadius: '16px',
                      padding: '24px',
                      textAlign: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '12px',
                      boxShadow: isVictory ? '0 0 30px rgba(0, 230, 118, 0.15)' : '0 0 30px rgba(255, 23, 68, 0.15)',
                      transition: 'var(--transition-smooth)'
                    }}
                  >
                    <span 
                      className="animate-float" 
                      style={{ 
                        fontSize: '4.5rem',
                        filter: isVictory ? 'drop-shadow(0 0 15px rgba(0,230,118,0.5))' : 'drop-shadow(0 0 15px rgba(255,23,68,0.5))'
                      }}
                    >
                      {isVictory ? '👑' : '💀'}
                    </span>
                    <h1 
                      style={{ 
                        fontSize: '2.5rem', 
                        fontWeight: 900, 
                        letterSpacing: '1px',
                        textShadow: isVictory ? '0 0 15px rgba(0, 230, 118, 0.6)' : '0 0 15px rgba(255, 23, 68, 0.6)',
                        color: '#ffffff'
                      }}
                    >
                      {isVictory ? t.victoryTitle : t.defeatTitle}
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', maxWidth: '320px', lineHeight: 1.5 }}>
                      {isVictory 
                        ? (currentRoom ? (isRtl ? 'لقد سيطرت على ساحة المعركة المعرفية وتفوقت على الجميع!' : 'You dominated the cognitive arena and outsmarted everyone!') : (isRtl ? 'أداء رائع! لقد أكملت التحدي بدقة عالية!' : 'Fantastic job! You completed the challenge successfully!'))
                        : (currentRoom ? (isRtl ? 'الهزيمة ليست النهاية، بل بداية طريق التميز والتعلم!' : 'Defeat is not the end, but the beginning of mastery!') : (isRtl ? 'استمر في التحدي! الممارسة تصنع الفارق دائماً!' : 'Keep practicing! Repetition is the key to mastery!'))
                      }
                    </p>
                  </div>

                  {/* Personal Summary Stats */}
                  <div style={styles.summaryStatsGrid}>
                    <div style={styles.statCard}>
                      <span style={styles.statHeading}>{t.score}</span>
                      <span style={styles.statNum} className="text-glow">{score}</span>
                    </div>

                    <div style={styles.statCard}>
                      <span style={styles.statHeading}>{t.accuracy}</span>
                      <span style={styles.statNum} className="text-glow-accent">
                        {gameQuestions.length > 0 ? Math.round((correctAnswersCount / gameQuestions.length) * 100) : 0}%
                      </span>
                    </div>
                  </div>

                  {/* Team Battle Score Comparison Grid */}
                  {isTeamMode && (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '16px',
                      padding: '16px',
                      backgroundColor: 'rgba(17, 19, 31, 0.8)',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                      borderRadius: '12px',
                      textAlign: 'center',
                      marginTop: '-8px'
                    }}>
                      {/* Team A */}
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        padding: '12px',
                        border: `2px solid ${teamAScore >= teamBScore ? '#00f2fe' : 'transparent'}`,
                        backgroundColor: 'rgba(0, 242, 254, 0.02)',
                        borderRadius: '8px',
                        position: 'relative'
                      }}>
                        {teamAScore >= teamBScore && (
                          <span style={{ position: 'absolute', top: '-14px', left: '50%', transform: 'translateX(-50%)', fontSize: '1.2rem' }}>👑</span>
                        )}
                        <span style={{ fontSize: '0.8rem', color: '#00f2fe', fontWeight: 800 }}>
                          {isRtl ? 'الفريق أ (الأزرق)' : 'TEAM A (Blue)'}
                        </span>
                        <span style={{ fontSize: '1.8rem', fontWeight: 900, color: '#ffffff' }}>
                          {teamAScore}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: '#8a93c0' }}>
                          {`${players.filter(p => p.teamId === 'team_a').length} ${isRtl ? 'لاعبين' : 'Players'}`}
                        </span>
                      </div>

                      {/* Team B */}
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        padding: '12px',
                        border: `2px solid ${teamBScore >= teamAScore ? '#ff3b5c' : 'transparent'}`,
                        backgroundColor: 'rgba(255, 59, 92, 0.02)',
                        borderRadius: '8px',
                        position: 'relative'
                      }}>
                        {teamBScore >= teamAScore && (
                          <span style={{ position: 'absolute', top: '-14px', left: '50%', transform: 'translateX(-50%)', fontSize: '1.2rem' }}>👑</span>
                        )}
                        <span style={{ fontSize: '0.8rem', color: '#ff3b5c', fontWeight: 800 }}>
                          {isRtl ? 'الفريق ب (الأحمر)' : 'TEAM B (Red)'}
                        </span>
                        <span style={{ fontSize: '1.8rem', fontWeight: 900, color: '#ffffff' }}>
                          {teamBScore}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: '#8a93c0' }}>
                          {`${players.filter(p => p.teamId === 'team_b').length} ${isRtl ? 'لاعبين' : 'Players'}`}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Rewards Panel */}
                  <div style={styles.rewardsPanelCard}>
                    <div style={styles.rewardDetailRow}>
                      <span style={{ color: 'var(--text-secondary)' }}>{t.coinsEarned}</span>
                      <span style={{ color: '#ffb300', fontWeight: 800 }}>+ {Math.floor(score / 10)} 🪙</span>
                    </div>
                    <div style={styles.rewardDetailRow}>
                      <span style={{ color: 'var(--text-secondary)' }}>{t.xpGained}</span>
                      <span style={{ color: '#00e676', fontWeight: 800 }}>+ 250 XP</span>
                    </div>
                  </div>

                  {/* Standings Table / Scoreboard */}
                  <div style={{ ...styles.rewardsPanelCard, gap: '16px' }}>
                    <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--primary)', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '10px' }}>
                      🏆 {t.standingsTitle}
                    </h2>
                    <div style={{ overflowX: 'auto', width: '100%' }}>
                      <table className="glass-table">
                        <thead>
                          <tr>
                            <th>{t.rankHeader}</th>
                            <th>{t.playerHeader}</th>
                            <th>{t.scoreHeader}</th>
                            <th>{t.accuracyHeader}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {players.map((p, idx) => {
                            const isSelf = p.userId === user?.id;
                            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
                            return (
                              <tr key={p.userId} className={isSelf ? "glass-table-row self" : "glass-table-row"}>
                                <td style={{ fontWeight: 800, fontSize: idx < 3 ? '1.2rem' : '0.9rem' }}>{medal}</td>
                                <td>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: isRtl ? 'flex-end' : 'flex-start' }}>
                                    <div className="avatar-container" style={{ border: isSelf ? '2px solid var(--primary)' : '2px solid var(--border-glass)' }}>
                                      {p.username.substring(0, 2).toUpperCase()}
                                    </div>
                                    <span style={{ fontWeight: isSelf ? 800 : 500 }}>
                                      {p.username}
                                    </span>
                                    {isSelf && (
                                      <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: 'rgba(0, 242, 254, 0.2)', border: '1px solid var(--primary)', borderRadius: '4px', color: 'var(--primary)', fontWeight: 800 }}>
                                        {isRtl ? 'أنت' : 'YOU'}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td style={{ fontWeight: 700, color: isSelf ? 'var(--primary)' : '#ffffff' }}>{p.score}</td>
                                <td style={{ color: 'var(--text-secondary)' }}>{p.accuracy}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Round-by-Round Breakdown Matrix */}
                  <div style={{ ...styles.rewardsPanelCard, gap: '16px' }}>
                    <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--primary)', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '10px' }}>
                      📊 {t.detailedReportTitle}
                    </h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {rounds.map((r) => {
                        const isExpanded = expandedRound === r.roundNumber;
                        return (
                          <div 
                            key={r.roundNumber} 
                            style={{ 
                              background: 'rgba(255, 255, 255, 0.01)', 
                              border: '1px solid rgba(255, 255, 255, 0.04)', 
                              borderRadius: '8px',
                              overflow: 'hidden'
                            }}
                          >
                            {/* Accordion Trigger Header */}
                            <div 
                              className="accordion-trigger"
                              style={{ 
                                padding: '14px 16px', 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center',
                                gap: '12px',
                                background: isExpanded ? 'rgba(255, 255, 255, 0.03)' : 'transparent'
                              }}
                              onClick={() => setExpandedRound(isExpanded ? null : r.roundNumber)}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <span style={{ fontWeight: 800, color: 'var(--primary)' }}>Q{r.roundNumber}</span>
                                <span style={{ color: '#ffffff', fontSize: '0.88rem', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '180px' }}>
                                  {r.questionBody}
                                </span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {/* Mini indicators for players' accuracy */}
                                <div style={{ display: 'flex', gap: '4px' }}>
                                  {players.map((p) => {
                                    const pAns = r.answers.find((a) => a.userId === p.userId);
                                    return (
                                      <div 
                                        key={p.userId} 
                                        title={`${p.username}: ${pAns ? (pAns.isCorrect ? 'Correct' : 'Incorrect') : 'No Answer'}`}
                                        style={{ 
                                          width: '8px', 
                                          height: '8px', 
                                          borderRadius: '50%', 
                                          background: pAns ? (pAns.isCorrect ? '#00e676' : '#ff1744') : 'rgba(255,255,255,0.1)' 
                                        }} 
                                      />
                                    );
                                  })}
                                </div>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  {isExpanded ? '▲' : '▼'}
                                </span>
                              </div>
                            </div>

                            {/* Accordion Content */}
                            {isExpanded && (
                              <div style={{ padding: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.04)', display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(0, 0, 0, 0.15)' }}>
                                <div style={{ fontSize: '0.9rem', color: '#ffffff', lineHeight: 1.5, background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.03)' }}>
                                  <span style={{ fontWeight: 700, display: 'block', color: 'var(--primary)', marginBottom: '4px' }}>
                                    {isRtl ? 'السؤال الكامل:' : 'Full Question:'}
                                  </span>
                                  {r.questionBody}
                                </div>

                                {/* Player results details */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', margin: '4px 0' }}>
                                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                                    {isRtl ? 'إجابات اللاعبين:' : 'Player Performance:'}
                                  </span>
                                  {players.map((p) => {
                                    const pAns = r.answers.find((a) => a.userId === p.userId);
                                    const isSelf = p.userId === user?.id;
                                    return (
                                      <div 
                                        key={p.userId} 
                                        style={{ 
                                          display: 'flex', 
                                          justifyContent: 'space-between', 
                                          alignItems: 'center', 
                                          padding: '8px 12px', 
                                          background: isSelf ? 'rgba(0, 242, 254, 0.03)' : 'rgba(255,255,255,0.01)', 
                                          borderRadius: '6px',
                                          border: isSelf ? '1px solid rgba(0, 242, 254, 0.1)' : '1px solid rgba(255,255,255,0.02)'
                                        }}
                                      >
                                        <span style={{ fontSize: '0.85rem', color: '#ffffff', fontWeight: isSelf ? 700 : 500 }}>
                                          {p.username} {isSelf && `(${isRtl ? 'أنت' : 'You'})`}
                                        </span>
                                        {pAns ? (
                                          <span className={pAns.isCorrect ? "status-badge correct" : "status-badge incorrect"}>
                                            {pAns.isCorrect ? '✔' : '✘'} {pAns.isCorrect ? t.correctLabel : t.incorrectLabel} ({(pAns.timeSpentMs / 1000).toFixed(1)}s)
                                          </span>
                                        ) : (
                                          <span className="status-badge no-answer">
                                            {t.noAnswerLabel}
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* summary footer / return btn */}
                  <div style={styles.summaryFooter}>
                    <button style={styles.returnHubBtn} onClick={() => { playSFX('click'); setScreen('dashboard'); }}>
                      {t.dashboardBtn}
                    </button>
                  </div>

                </div>
              );
            })() : (
              <div style={{ ...styles.statCard, padding: '40px', gap: '16px', justifyContent: 'center' }}>
                <span className="animate-float" style={{ fontSize: '3rem' }}>🔍</span>
                <span style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--primary)' }}>
                  No match details found.
                </span>
                <button style={styles.returnHubBtn} onClick={() => setScreen('dashboard')}>
                  {t.dashboardBtn}
                </button>
              </div>
            )}
          </div>
        )}

        {/* CUSTOM GAMING ALERT POPUP */}
        {gamingAlert.show && (() => {
          const alertColor = 
            gamingAlert.type === 'error' ? '#ff3b5c' : 
            gamingAlert.type === 'warning' ? '#ffb800' : 
            gamingAlert.type === 'success' ? '#00ff87' : '#00f2fe';

          const alertBgGradient = 
            gamingAlert.type === 'error' ? 'linear-gradient(135deg, #ff3b5c 0%, #ff8a9a 100%)' : 
            gamingAlert.type === 'warning' ? 'linear-gradient(135deg, #ffb800 0%, #ffd066 100%)' : 
            gamingAlert.type === 'success' ? 'linear-gradient(135deg, #00ff87 0%, #66ffb3 100%)' : 
            'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)';

          return (
            <div style={customStyles.alertOverlay}>
              <div style={{ ...customStyles.alertBox, border: `2px solid ${alertColor}`, boxShadow: `0 0 20px ${alertColor}40, inset 0 0 10px ${alertColor}15` }}>
                <div style={customStyles.alertHeader}>
                  <span style={{ ...customStyles.alertTitle, color: alertColor }}>
                    {gamingAlert.type === 'error' ? (isRtl ? '⚠️ خطأ في النظام' : '⚠️ SYSTEM ERROR') : 
                     gamingAlert.type === 'warning' ? (isRtl ? '⚡ تنبيه هام' : '⚡ ALERT') : 
                     gamingAlert.type === 'success' ? (isRtl ? '🏆 إنجاز جديد' : '🏆 SUCCESS') : 
                     (isRtl ? '📢 تنبيه النظام' : '📢 SYSTEM NOTIFICATION')}
                  </span>
                </div>
                <div style={customStyles.alertBody}>
                  <p style={customStyles.alertMessage}>{gamingAlert.message}</p>
                </div>
                <button 
                  style={{ ...customStyles.alertBtn, background: alertBgGradient, boxShadow: `0 4px 12px ${alertColor}40` }} 
                  onClick={() => { playSFX('click'); setGamingAlert(prev => ({ ...prev, show: false })); }}
                >
                  {isRtl ? 'حسناً' : 'OK'}
                </button>
              </div>
            </div>
          );
        })()}

        {/* AUCTION BIDDING MODAL */}
        {showBidModal && (
          <div style={customStyles.alertOverlay}>
            <div style={{ ...customStyles.alertBox, border: `2px solid #ffcc00`, boxShadow: `0 0 20px #ffcc0040, inset 0 0 10px #ffcc0015` }}>
              <div style={customStyles.alertHeader}>
                <span style={{ ...customStyles.alertTitle, color: '#ffcc00' }}>
                  {isRtl ? '🪙 مزاد النقاط' : '🪙 POINTS AUCTION'}
                </span>
              </div>
              <div style={{ ...customStyles.alertBody, display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
                <p style={{ ...customStyles.alertMessage, textAlign: 'center', margin: 0 }}>
                  {isRtl ? 'اختر عدد النقاط التي تريد المراهنة بها على هذا السؤال:' : 'Choose the points you want to bid on this question:'}
                </p>
                <div style={{ fontSize: '2rem', fontWeight: 900, color: '#ffcc00' }}>
                  {bidValue} pts
                </div>
                <input
                  type="range"
                  min="10"
                  max="500"
                  step="10"
                  value={bidValue}
                  onChange={(e) => setBidValue(Number(e.target.value))}
                  style={{
                    width: '100%',
                    accentColor: '#ffcc00',
                    cursor: 'pointer'
                  }}
                />
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  {[50, 100, 200, 300, 500].map(val => (
                    <button
                      key={val}
                      onClick={() => { playSFX('click'); setBidValue(val); }}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        backgroundColor: bidValue === val ? '#ffcc00' : 'rgba(255, 255, 255, 0.05)',
                        color: bidValue === val ? '#111528' : '#ffffff',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: 'bold'
                      }}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <button
                  style={{
                    flex: 1,
                    padding: '12px',
                    backgroundColor: 'transparent',
                    color: '#ffffff',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '0.85rem'
                  }}
                  onClick={() => { playSFX('click'); setShowBidModal(false); }}
                >
                  {isRtl ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  style={{
                    flex: 1,
                    padding: '12px',
                    backgroundColor: '#ffcc00',
                    color: '#111528',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 'bold'
                  }}
                  onClick={() => {
                    playSFX('click');
                    setShowBidModal(false);
                    handleBuzz(bidValue);
                  }}
                >
                  {isRtl ? 'تأكيد المزايدة' : 'Confirm Bid'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ==========================================
// MOBILE-FIRST DESIGN STYLES (CENTERED DECK)
// ==========================================
const styles: { [key: string]: React.CSSProperties } = {
  appContainer: {
    minHeight: '100vh',
    width: '100%',
    backgroundColor: '#05060f',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    fontFamily: 'var(--font-en)'
  },
  arenaFrame: {
    width: '100%',
    maxWidth: '480px',
    height: '100vh',
    maxHeight: '844px',
    backgroundColor: '#0b0d1a',
    borderRadius: '16px',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.5)',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxSizing: 'border-box'
  },
  ambientGrid: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundImage: `
      linear-gradient(rgba(255, 255, 255, 0.01) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.01) 1px, transparent 1px)
    `,
    backgroundSize: '24px 24px',
    pointerEvents: 'none',
    zIndex: 1
  },
  screenContainer: {
    width: '100%',
    height: '100%',
    zIndex: 5,
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    boxSizing: 'border-box',
    minHeight: 0
  },
  topProfileBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: '52px',
    marginBottom: '10px',
    flexShrink: 0
  },
  avatarGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  avatarRing: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    border: '2px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    fontSize: '1.1rem'
  },
  levelBadge: {
    fontSize: '0.75rem',
    fontWeight: 700,
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: '2px 6px',
    borderRadius: '4px',
    color: '#00f2fe'
  },
  xpTrack: {
    width: '60px',
    height: '4px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: '2px',
    overflow: 'hidden'
  },
  xpBarFill: {
    width: '60%',
    height: '100%',
    backgroundColor: '#00f2fe'
  },
  topRightControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  walletCount: {
    color: '#ffb300',
    fontWeight: 700,
    fontSize: '0.95rem'
  },
  langBtn: {
    background: 'none',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '4px',
    color: '#f0f4ff',
    padding: '4px 8px',
    fontSize: '0.75rem',
    cursor: 'pointer',
    fontWeight: 600
  },
  logoutBtn: {
    background: 'none',
    border: 'none',
    fontSize: '1.2rem',
    cursor: 'pointer'
  },
  rankBadgeCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '10px',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.04)',
    borderRadius: '8px',
    marginBottom: '20px',
    flexShrink: 0
  },
  rankGlowText: {
    fontSize: '1.2rem',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '1px',
    color: '#ffffff'
  },
  latencyLabel: {
    fontSize: '0.7rem',
    color: '#8a93c0',
    marginTop: '4px'
  },
  titleWrapper: {
    textAlign: 'center',
    margin: '10px 0',
    flexShrink: 0
  },
  glowTitle: {
    fontSize: '2.2rem',
    fontWeight: 900,
    letterSpacing: '3px',
    background: 'linear-gradient(to right, #ffffff, #a0aec0)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent'
  },
  playHeroContainer: {
    display: 'flex',
    justifyContent: 'center',
    margin: '20px 0',
    flexShrink: 0
  },
  playHeroBtn: {
    width: '180px',
    height: '180px',
    borderRadius: '50%',
    border: 'none',
    background: 'radial-gradient(circle, #00f2fe 0%, #4facfe 100%)',
    color: '#05060f',
    fontSize: '1.4rem',
    fontWeight: 800,
    letterSpacing: '2px',
    cursor: 'pointer',
    boxShadow: '0 0 30px rgba(0, 242, 254, 0.35)',
    transition: 'all 0.2s',
    outline: 'none'
  },
  modesContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    margin: '10px 0'
  },
  modeCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '12px 16px',
    backgroundColor: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255, 255, 255, 0.04)',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  modeIcon: {
    fontSize: '1.8rem'
  },
  modeMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  modeTitle: {
    fontSize: '0.95rem',
    fontWeight: 700,
    color: '#f0f4ff'
  },
  modeDesc: {
    fontSize: '0.75rem',
    color: '#8a93c0'
  },
  multiplayerBox: {
    backgroundColor: 'rgba(17, 19, 31, 0.8)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    borderRadius: '12px',
    padding: '16px',
    marginTop: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  multiTitle: {
    fontSize: '0.95rem',
    fontWeight: 700,
    color: '#00f2fe'
  },
  multiDesc: {
    fontSize: '0.75rem',
    color: '#8a93c0'
  },
  btnRow: {
    width: '100%'
  },
  cyberBtn: {
    width: '100%',
    padding: '10px',
    background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    border: 'none',
    color: '#05060f',
    fontWeight: 700,
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.85rem'
  },
  inputJointRow: {
    display: 'flex',
    gap: '8px'
  },
  jointInput: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '6px',
    padding: '8px 12px',
    color: '#ffffff',
    fontSize: '0.85rem',
    outline: 'none'
  },
  cyberOutlineBtn: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    border: '1px solid #00f2fe',
    color: '#00f2fe',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 700
  },
  bottomNavMock: {
    display: 'flex',
    justifyContent: 'space-around',
    alignItems: 'center',
    height: '56px',
    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
    paddingTop: '10px',
    fontSize: '1.3rem',
    color: '#8a93c0',
    flexShrink: 0
  },
  activeNavTab: {
    color: '#00f2fe',
    textShadow: '0 0 10px rgba(0, 242, 254, 0.5)'
  },
  lobbyHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: '48px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
    paddingBottom: '10px'
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: '#f0f4ff',
    fontSize: '1.1rem',
    cursor: 'pointer'
  },
  lobbyTitleText: {
    fontSize: '1.1rem',
    fontWeight: 800,
    color: '#ffffff'
  },
  configModeBadge: {
    fontSize: '0.7rem',
    backgroundColor: 'rgba(0, 242, 254, 0.1)',
    color: '#00f2fe',
    padding: '2px 8px',
    borderRadius: '10px',
    fontWeight: 700
  },
  roomParamsCard: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '12px',
    padding: '12px 16px',
    backgroundColor: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.04)',
    borderRadius: '8px',
    margin: '12px 0'
  },
  paramItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    fontSize: '0.8rem',
    textAlign: 'center'
  },
  paramLabel: {
    color: '#8a93c0',
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  paramVal: {
    fontWeight: 700,
    color: '#ffffff',
    fontSize: '0.85rem',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '100%'
  },
  participantsGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    flex: 1,
    margin: '10px 0'
  },
  playerCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    borderRadius: '8px'
  },
  playerCardDashed: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '60px',
    border: '1px dashed rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    backgroundColor: 'transparent'
  },
  dashText: {
    fontSize: '0.8rem',
    color: '#8a93c0',
    fontStyle: 'italic'
  },
  playerMetaLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  avatarCircleMock: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.95rem'
  },
  playerTexts: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  pCardUsername: {
    fontSize: '0.9rem',
    fontWeight: 700,
    color: '#ffffff'
  },
  pCardRank: {
    fontSize: '0.7rem',
    color: '#8a93c0'
  },
  playerMetaRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  hostBadge: {
    fontSize: '0.65rem',
    backgroundColor: '#ffb300',
    color: '#05060f',
    padding: '1px 5px',
    borderRadius: '4px',
    fontWeight: 800
  },
  lobbyReadyIndicator: {
    fontSize: '0.75rem',
    fontWeight: 700
  },
  lobbyActionsRow: {
    display: 'flex',
    gap: '12px',
    marginTop: '10px'
  },
  leaveLobbyBtn: {
    flex: 1,
    padding: '12px',
    backgroundColor: 'rgba(255, 23, 68, 0.1)',
    border: '1px solid rgba(255, 23, 68, 0.25)',
    color: '#ff1744',
    fontWeight: 700,
    borderRadius: '6px',
    cursor: 'pointer'
  },
  startLobbyBtn: {
    flex: 1.5,
    padding: '12px',
    backgroundColor: '#00e676',
    border: 'none',
    color: '#05060f',
    fontWeight: 700,
    borderRadius: '6px',
    cursor: 'pointer'
  },
  cinematicOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundColor: '#05060f',
    zIndex: 100,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-around',
    alignItems: 'center',
    padding: '40px',
    boxSizing: 'border-box',
    cursor: 'pointer'
  },
  cinematicPulseText: {
    fontSize: '2.5rem',
    fontWeight: 900,
    color: '#00f2fe',
    letterSpacing: '4px'
  },
  cinematicFlexRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%'
  },
  cinematicTeamSide: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px'
  },
  avatarCircleHuge: {
    width: '72px',
    height: '72px',
    borderRadius: '50%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '2px solid #00f2fe',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '2rem'
  },
  teamSlamName: {
    fontSize: '1rem',
    fontWeight: 700,
    color: '#ffffff'
  },
  teamSlamRank: {
    fontSize: '0.75rem',
    color: '#8a93c0'
  },
  cinematicVsText: {
    fontSize: '3rem',
    fontWeight: 900,
    color: '#ffb300',
    fontStyle: 'italic'
  },
  cinematicInstructions: {
    fontSize: '0.75rem',
    color: '#8a93c0',
    fontStyle: 'italic'
  },
  hudBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: '52px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
    paddingBottom: '8px'
  },
  hudTeamPanel: {
    display: 'flex',
    flexDirection: 'column',
    width: '38%',
    gap: '2px'
  },
  hudTeamName: {
    fontSize: '0.75rem',
    color: '#8a93c0',
    fontWeight: 600,
    textOverflow: 'ellipsis',
    overflow: 'hidden',
    whiteSpace: 'nowrap'
  },
  hudTeamScore: {
    fontSize: '1.1rem',
    fontWeight: 800,
    color: '#ffffff'
  },
  heartsRow: {
    display: 'flex',
    gap: '2px',
    fontSize: '0.7rem'
  },
  hudTimerPanel: {
    width: '24%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  },
  timerCircularRing: {
    width: '42px',
    height: '42px',
    borderRadius: '50%',
    border: '2px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.05rem',
    fontWeight: 800,
    color: '#ffffff',
    backgroundColor: 'rgba(5, 6, 15, 0.6)'
  },
  hudRoundCounter: {
    fontSize: '0.55rem',
    color: '#8a93c0',
    marginTop: '2px',
    fontWeight: 700
  },
  questionZone: {
    backgroundColor: 'rgba(17, 19, 31, 0.6)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    borderRadius: '10px',
    padding: '12px 16px',
    margin: '12px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minHeight: '130px',
    justifyContent: 'center',
    position: 'relative'
  },
  qHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  categoryBadge: {
    fontSize: '0.65rem',
    backgroundColor: 'rgba(0, 242, 254, 0.1)',
    color: '#00f2fe',
    padding: '2px 8px',
    borderRadius: '10px',
    fontWeight: 700
  },
  difficultyBadge: {
    fontSize: '0.65rem',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    color: '#8a93c0',
    padding: '2px 8px',
    borderRadius: '10px',
    fontWeight: 600
  },
  qTextBody: {
    fontSize: '0.95rem',
    fontWeight: 700,
    color: '#f0f4ff',
    lineHeight: '1.4',
    whiteSpace: 'pre-line'
  },
  buzzedAlertBadge: {
    padding: '6px 12px',
    border: '1px solid',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '0.8rem',
    fontWeight: 700,
    textAlign: 'center',
    marginTop: '6px',
    animation: 'pulse-glow 0.8s infinite'
  },
  questionImageFrame: {
    width: '100%',
    height: '110px',
    borderRadius: '6px',
    overflow: 'hidden',
    marginTop: '6px'
  },
  questionImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  answerZone: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    margin: '10px 0'
  },
  mcqGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '10px'
  },
  answerCardBtn: {
    height: '80px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '10px',
    borderRadius: '8px',
    border: '1px solid',
    cursor: 'pointer',
    color: '#ffffff',
    textAlign: 'center',
    gap: '4px',
    outline: 'none',
    transition: 'all 0.15s'
  },
  optLetterBadge: {
    fontSize: '0.75rem',
    fontWeight: 800,
    backgroundColor: 'rgba(255,255,255,0.05)',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#00f2fe'
  },
  optText: {
    fontSize: '0.8rem',
    fontWeight: 600
  },
  tfStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  tfCardBtn: {
    height: '76px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '1.05rem',
    fontWeight: 700,
    cursor: 'pointer',
    outline: 'none',
    transition: 'all 0.15s'
  },
  blankInputWrapper: {
    display: 'flex',
    justifyContent: 'center',
    padding: '20px 0'
  },
  blankInputField: {
    width: '100%',
    height: '52px',
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: '2px solid #00f2fe',
    color: '#ffffff',
    fontSize: '1.2rem',
    textAlign: 'center',
    outline: 'none',
    letterSpacing: '1px'
  },
  orderingContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  orderingCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    backgroundColor: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '8px',
    height: '46px'
  },
  orderLabelBadge: {
    fontSize: '0.75rem',
    fontWeight: 800,
    color: '#00f2fe',
    width: '20px'
  },
  orderingText: {
    fontSize: '0.85rem',
    fontWeight: 600,
    flex: 1
  },
  orderControls: {
    display: 'flex',
    gap: '6px'
  },
  orderArrowBtn: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: 'none',
    color: '#f0f4ff',
    width: '26px',
    height: '26px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.65rem'
  },
  matchingPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  matchingDesc: {
    fontSize: '0.75rem',
    color: '#8a93c0',
    fontStyle: 'italic',
    textAlign: 'center'
  },
  matchingColumns: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px'
  },
  matchingCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  matchCardBtn: {
    height: '56px',
    border: '1px solid',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '0.75rem',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6px',
    outline: 'none',
    transition: 'all 0.15s'
  },
  connectedMatchLabel: {
    fontSize: '0.55rem',
    color: '#00ff87',
    marginTop: '2px',
    fontWeight: 700
  },
  resetMatchBtn: {
    margin: '0 auto',
    padding: '6px 12px',
    backgroundColor: 'transparent',
    border: '1px solid rgba(255, 59, 92, 0.3)',
    color: '#ff3b5c',
    borderRadius: '4px',
    fontSize: '0.7rem',
    cursor: 'pointer',
    fontWeight: 600
  },
  codingWorkspace: {
    display: 'flex',
    flexDirection: 'column',
    height: '140px'
  },
  codeTextarea: {
    flex: 1,
    backgroundColor: 'rgba(5, 6, 15, 0.8)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '8px',
    padding: '12px',
    color: '#00ff87',
    fontFamily: 'monospace',
    fontSize: '0.8rem',
    outline: 'none',
    resize: 'none'
  },
  feedbackPanel: {
    padding: '12px 16px',
    border: '1px solid',
    borderRadius: '8px',
    margin: '10px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  feedbackTitle: {
    fontSize: '1rem',
    fontWeight: 800,
    letterSpacing: '1px'
  },
  explanationText: {
    fontSize: '0.75rem',
    color: '#f0f4ff',
    lineHeight: '1.4'
  },
  gameActionBar: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
    paddingTop: '12px',
    height: '110px',
    justifyContent: 'center'
  },
  powerUpInventoryBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  inventoryTitle: {
    fontSize: '0.65rem',
    color: '#8a93c0',
    fontWeight: 700,
    letterSpacing: '0.5px'
  },
  powerupList: {
    display: 'flex',
    gap: '8px'
  },
  powerUpChipBtn: {
    flex: 1,
    padding: '4px 6px',
    border: '1px solid',
    borderRadius: '4px',
    fontSize: '0.7rem',
    fontWeight: 700,
    cursor: 'pointer',
    outline: 'none'
  },
  buzzerCircBtn: {
    width: '100%',
    height: '46px',
    borderRadius: '8px',
    border: 'none',
    background: 'radial-gradient(circle, #ff1744 0%, #ff3b5c 100%)',
    color: '#ffffff',
    fontSize: '1rem',
    fontWeight: 900,
    letterSpacing: '2px',
    cursor: 'pointer',
    boxShadow: '0 0 16px rgba(255, 23, 68, 0.35)',
    outline: 'none'
  },
  submitAnsBtn: {
    width: '100%',
    height: '46px',
    borderRadius: '8px',
    border: 'none',
    background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
    color: '#05060f',
    fontSize: '0.9rem',
    fontWeight: 800,
    cursor: 'pointer',
    outline: 'none'
  },
  nextQBtn: {
    width: '100%',
    height: '46px',
    borderRadius: '8px',
    border: 'none',
    background: 'linear-gradient(135deg, #00e676 0%, #00ff87 100%)',
    color: '#05060f',
    fontSize: '0.9rem',
    fontWeight: 800,
    cursor: 'pointer',
    outline: 'none'
  },
  waitingForPlayerMessage: {
    fontSize: '0.9rem',
    color: '#ffb300',
    fontWeight: 600,
    textAlign: 'center',
    height: '46px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    animation: 'pulse-glow 1s infinite'
  },
  summaryBadgeWrapper: {
    fontSize: '4.5rem',
    textAlign: 'center',
    margin: '30px 0'
  },
  summaryStatsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
    margin: '20px 0'
  },
  statCard: {
    padding: '16px',
    backgroundColor: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.04)',
    borderRadius: '10px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px'
  },
  statHeading: {
    fontSize: '0.8rem',
    color: '#8a93c0'
  },
  statNum: {
    fontSize: '1.8rem',
    fontWeight: 900,
    color: '#ffffff'
  },
  rewardsPanelCard: {
    backgroundColor: 'rgba(17, 19, 31, 0.8)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    borderRadius: '12px',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    margin: '20px 0'
  },
  rewardDetailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.9rem'
  },
  summaryFooter: {
    marginTop: '20px'
  },
  returnHubBtn: {
    width: '100%',
    padding: '14px',
    background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    border: 'none',
    color: '#05060f',
    fontWeight: 800,
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.95rem'
  }
};

const customStyles: { [key: string]: React.CSSProperties } = {
  alertOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(5, 6, 15, 0.85)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
    padding: '24px',
    boxSizing: 'border-box'
  },
  alertBox: {
    width: '100%',
    maxWidth: '360px',
    backgroundColor: '#111528',
    borderRadius: '16px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxSizing: 'border-box'
  },
  alertHeader: {
    padding: '14px 16px',
    background: 'linear-gradient(90deg, rgba(255, 255, 255, 0.05) 0%, transparent 100%)',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
    display: 'flex',
    alignItems: 'center'
  },
  alertTitle: {
    fontSize: '0.85rem',
    fontWeight: 800,
    letterSpacing: '1px'
  },
  alertBody: {
    padding: '24px 20px',
    textAlign: 'center'
  },
  alertMessage: {
    fontSize: '0.95rem',
    color: '#f0f4ff',
    fontWeight: 600,
    lineHeight: '1.5',
    margin: 0
  },
  alertBtn: {
    margin: '0 20px 20px 20px',
    padding: '12px',
    border: 'none',
    color: '#05060f',
    fontWeight: 900,
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.9rem',
    transition: 'all 0.15s ease'
  }
};
