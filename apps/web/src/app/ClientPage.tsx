'use client';

import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { GameEvents, BuzzerType, GameModeType, Question } from '@mind-race/shared';
import { useAuth } from '../context/AuthContext';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';

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

  // Configuration and Room States
  const [selectedMode, setSelectedMode] = useState<GameModeType>('FREE_FOR_ALL');
  const [selectedBuzzer, setSelectedBuzzer] = useState<BuzzerType>('STANDARD');
  const [selectedRounds, setSelectedRounds] = useState<number>(5);
  const [selectedTimeLimit, setSelectedTimeLimit] = useState<number>(30);
  const [selectedMaxPlayers, setSelectedMaxPlayers] = useState<number>(6);
  const [isSpectatorJoin, setIsSpectatorJoin] = useState<boolean>(false);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [currentRoom, setCurrentRoom] = useState<any>(null);
  const [participants, setParticipants] = useState<any[]>([]);
  
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
  
  // Timers and Refs
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // -----------------------------------------------------------------
  // HOISTED FUNCTION DECLARATIONS (Resolves eslint variable access order)
  // -----------------------------------------------------------------

  function handleAutoSubmitWrong() {
    playSFX('wrong');
    setIsAnswerCorrect(false);
    setAnswerSubmitted(true);
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

    if (q.type === 'MULTIPLE_CHOICE' || q.type === 'TRUE_FALSE' || q.type === 'IMAGE_QUESTION' || q.type === 'CIRCUIT_QUESTION') {
      userAns = selectedOption;
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
      alert(isRtl ? 'من فضلك اختر أو اكتب إجابة أولاً!' : 'Please select or enter an answer first!');
      return;
    }

    // Co-ordinate multiplayer matches via Socket.io instead of local grading
    if (currentRoom) {
      if (socketRef.current) {
        socketRef.current.emit('game:submit_answer', {
          roomId: currentRoom.id,
          answer: userAns
        });
      }
      setAnswerSubmitted(true);
      return;
    }

    try {
      let isCorrect = false;

      if (apiStatus === 'online') {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`http://localhost:5000/api/v1/questions/${q.id}/grade`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ answer: userAns })
        });

        if (res.ok) {
          const grading = await res.json();
          isCorrect = grading.isCorrect;
        } else {
          isCorrect = evaluateLocalAnswer(q, userAns);
        }
      } else {
        isCorrect = evaluateLocalAnswer(q, userAns);
      }

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

    } catch (e) {
      console.error(e);
      const isCorrect = evaluateLocalAnswer(q, userAns);
      setIsAnswerCorrect(isCorrect);
      setAnswerSubmitted(true);
      if (isCorrect) playSFX('correct'); else playSFX('wrong');
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
    
    try {
      await supabase
        .from('profiles')
        .update({ coins: updatedCoins })
        .eq('id', user.id);
        
      refreshProfile(); // Refresh profile state inside auth cleanly
    } catch (e) {
      console.log('Error saving coins:', e);
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

  // Health check polling
  useEffect(() => {
    const checkApi = async () => {
      const startTime = Date.now();
      try {
        const res = await fetch('http://localhost:5000/api/v1/health');
        if (res.ok) {
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

    checkApi();
    const interval = setInterval(checkApi, 5000);
    return () => clearInterval(interval);
  }, []);

  // WebSocket setup
  useEffect(() => {
    if (!user) return;

    const setupSocket = async () => {
      setSocketStatus('connecting');
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) return;

      const socket = io('http://localhost:5000', {
        reconnectionAttempts: 5,
        timeout: 10000,
        auth: { token },
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        setSocketStatus('connected');
      });

      socket.on('disconnect', () => {
        setSocketStatus('disconnected');
        if (screen === 'lobby') {
          setScreen('dashboard');
        }
      });

      socket.on(GameEvents.ROOM_STATE_CHANGE, (data: { event: string; participants?: any[] }) => {
        if (data.event === 'PARTICIPANTS_UPDATE' && data.participants) {
          setParticipants(data.participants);
        }
      });

      socket.on('room:config_updated', (data: { config: any }) => {
        setCurrentRoom((prev: any) => prev ? { ...prev, config: data.config } : null);
      });

      socket.on(GameEvents.START_GAME, () => {
        playSFX('slam');
        triggerVibrate([200, 100, 200]);
        setScreen('cinematic');
      });

      // Multiplayer synchronized gameplay events
      socket.on('game:round_start', (data: { roundIndex: number; totalRounds: number; question: any; timeLeft: number; scores: any }) => {
        setGameMode('FREE_FOR_ALL');
        setGameQuestions(prev => {
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

        if (data.question.type === 'ORDERING_QUESTION' && data.question.options) {
          const shuffled = [...data.question.options].sort(() => Math.random() - 0.5);
          setOrderIds(shuffled.map((o: any) => o.id));
        }

        setScreen('game');
      });

      socket.on('game:tick', (data: { timeLeft: number }) => {
        setTimeLeft(data.timeLeft);
      });

      socket.on('game:buzzed', (data: { userId: string; username: string }) => {
        playSFX('buzz');
        setIsBuzzed(true);
        setBuzzedUser(data.username);
      });

      socket.on('game:round_ended', (data: { userId: string | null; isCorrect: boolean; correctAnswer: any; explanation: string; scores: any }) => {
        setIsAnswerCorrect(data.isCorrect);
        setRevealedCorrectAnswer(data.correctAnswer);
        setAnswerSubmitted(true);
        
        if (data.isCorrect) {
          playSFX('correct');
        } else {
          playSFX('wrong');
        }

        if (data.scores) {
          const selfScore = data.scores[user.id] || 0;
          setScore(selfScore);
          
          const oppId = Object.keys(data.scores).find(id => id !== user.id);
          if (oppId) {
            setOpponentScore(data.scores[oppId]);
          }
        }
      });

      socket.on('game:ended', () => {
        playSFX('slam');
        setScreen('summary');
        refreshProfile();
      });
    };

    setupSocket();

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [user, screen, refreshProfile]);

  // Handle Game Timer Tick (Only in local solo modes)
  useEffect(() => {
    if (screen !== 'game' || answerSubmitted || currentRoom) {
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
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('http://localhost:5000/api/v1/rooms', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'PUBLIC',
          config: {
            mode: selectedMode,
            maxPlayers: selectedMaxPlayers,
            roundsCount: selectedRounds,
            questionTimeLimitSeconds: selectedTimeLimit,
            buzzerType: selectedBuzzer,
            allowedPowerUps: ['JOKER', 'FREEZE', 'SHIELD'],
            categoryWeights: { 'General': 100 }
          }
        })
      });

      if (!res.ok) {
        alert('Failed to create room. Make sure API server is running.');
        return;
      }

      const room = await res.json();
      setCurrentRoom(room);
      setParticipants([{
        userId: user?.id,
        username: user?.username,
        isHost: true,
        isReady: true,
        score: 0
      }]);
      setScreen('lobby');

      if (socketRef.current) {
        socketRef.current.emit(GameEvents.JOIN_ROOM, {
          roomId: room.id,
          username: user?.username
        });
      }
    } catch (e) {
      console.error(e);
      alert('Error connecting to the API server.');
    }
  };

  const joinRoomByCode = async () => {
    playSFX('click');
    if (!roomCodeInput.trim()) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('http://localhost:5000/api/v1/rooms/join', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code: roomCodeInput.trim().toUpperCase(),
          isSpectator: isSpectatorJoin
        })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to join room');
        return;
      }

      const detailsRes = await fetch(`http://localhost:5000/api/v1/rooms/${data.roomId}`, {
        headers: {
          'Authorization': `Bearer ${session?.access_token}`
        }
      });
      const details = await detailsRes.json();
      
      setCurrentRoom(details);
      setParticipants(details.participants);
      setScreen('lobby');

      if (socketRef.current) {
        socketRef.current.emit(GameEvents.JOIN_ROOM, {
          roomId: details.id,
          username: user?.username
        });
      }
    } catch (e) {
      console.error(e);
      alert('Error joining room.');
    }
  };

  const leaveRoom = async () => {
    playSFX('click');
    if (!currentRoom) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`http://localhost:5000/api/v1/rooms/${currentRoom.id}/leave`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`
        }
      });

      if (socketRef.current) {
        socketRef.current.emit(GameEvents.LEAVE_ROOM, { roomId: currentRoom.id });
      }

      setScreen('dashboard');
      setCurrentRoom(null);
      setParticipants([]);
    } catch (e) {
      console.error(e);
    }
  };

  const toggleReady = () => {
    playSFX('click');
    if (!currentRoom || !socketRef.current) return;
    
    const self = participants.find(p => p.userId === user?.id);
    const nextReady = !self?.isReady;

    socketRef.current.emit(GameEvents.PLAYER_READY, {
      roomId: currentRoom.id,
      isReady: nextReady
    });
  };

  const startLobbyGame = () => {
    playSFX('click');
    if (!currentRoom || !socketRef.current) return;
    
    socketRef.current.emit(GameEvents.START_GAME, {
      roomId: currentRoom.id
    });
  };

  const updateRoomConfig = (newConfig: any) => {
    if (!currentRoom || !socketRef.current || currentRoom.host_id !== user?.id) return;
    const updatedConfig = {
      ...currentRoom.config,
      ...newConfig
    };
    socketRef.current.emit('room:update_config', {
      roomId: currentRoom.id,
      config: updatedConfig
    });
  };

  const changeTeam = (teamId: 'team_a' | 'team_b' | null) => {
    playSFX('click');
    if (!currentRoom || !socketRef.current) return;
    socketRef.current.emit('room:change_team', {
      roomId: currentRoom.id,
      teamId
    });
  };

  // ==========================================
  // Game Board Operations
  // ==========================================
  const startSoloGame = (mode: GameModeType) => {
    playSFX('slam');
    setGameMode(mode);
    setScore(0);
    setOpponentScore(0);
    setLives(3);
    setCorrectAnswersCount(0);
    setAnswerSubmitted(false);
    setGameQuestions(SAMPLE_QUESTIONS);
    
    setScreen('cinematic');
  };

  const enterGameScreen = () => {
    setScreen('game');
    loadQuestion(0);
  };

  const handleBuzz = () => {
    if (!buzzerActive || isBuzzed) return;
    
    if (currentRoom) {
      if (socketRef.current) {
        socketRef.current.emit('game:buzz', { roomId: currentRoom.id });
      }
      return;
    }

    playSFX('buzz');
    triggerVibrate(150);
    setIsBuzzed(true);
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
      resetMatches: 'Reset Connections'
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
      resetMatches: 'إعادة تعيين التوصيل'
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
                API: <span style={{ color: apiStatus === 'online' ? '#00ff87' : '#ff3b5c' }}>
                  {apiStatus === 'online' ? `${latency}ms` : 'offline'}
                </span>
                {' | '} Socket: <span style={{ color: socketStatus === 'connected' ? '#00f2fe' : '#ff3b5c' }}>
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

            <div style={styles.bottomNavMock}>
              <span style={styles.activeNavTab}>🎒</span>
              <span>🛒</span>
              <span>⚔️</span>
              <span>🏰</span>
              <span>🏆</span>
            </div>
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
                      <option value="STANDARD">Standard</option>
                      <option value="RISK">Risk Buzzer</option>
                      <option value="SAFE">Safe Buzzer</option>
                      <option value="COMPETITIVE">Competitive</option>
                      <option value="SUDDEN_DEATH">Sudden Death</option>
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
                    <span style={styles.paramVal}>{currentRoom.config?.buzzerType}</span>
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
        {screen === 'cinematic' && (
          <div style={styles.cinematicOverlay} onClick={enterGameScreen}>
            <div style={styles.cinematicPulseText} className="text-glow">
              {t.vsSlam}
            </div>
            
            <div style={styles.cinematicFlexRow}>
              <div style={styles.cinematicTeamSide}>
                <div style={styles.avatarCircleHuge}>👤</div>
                <div style={styles.teamSlamName}>{user.username}</div>
                <div style={styles.teamSlamRank}>{user.rank}</div>
              </div>

              <div style={styles.cinematicVsText}>VS</div>

              <div style={styles.cinematicTeamSide}>
                <div style={styles.avatarCircleHuge}>🤖</div>
                <div style={styles.teamSlamName}>{t.opponent}</div>
                <div style={styles.teamSlamRank}>TITAN I</div>
              </div>
            </div>

            <div style={styles.cinematicInstructions}>
              (Tap Screen to Begin)
            </div>
          </div>
        )}

        {/* SCREEN: GAME BOARD */}
        {screen === 'game' && gameQuestions.length > 0 && (() => {
          const isInputDisabled = answerSubmitted || isSpectator || (isBuzzed && buzzedUser !== user?.username);
          return (
            <div style={styles.screenContainer}>
              <div style={styles.hudBar}>
                <div style={styles.hudTeamPanel}>
                  <span style={styles.hudTeamName}>{user?.username}</span>
                  <span style={styles.hudTeamScore}>{score} pts</span>
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
                    borderColor: timeLeft <= 5 ? '#ff3b5c' : '#00f2fe',
                    animation: timeLeft <= 5 ? 'pulse-glow 0.5s infinite' : 'none'
                  }}>
                    {timeLeft}
                  </div>
                  <span style={styles.hudRoundCounter}>{t.round} {currentQIndex + 1}/{gameQuestions.length}</span>
                </div>

                <div style={styles.hudTeamPanel}>
                  <span style={styles.hudTeamName} className="text-glow-accent">{t.opponent}</span>
                  <span style={styles.hudTeamScore}>{opponentScore} pts</span>
                </div>
              </div>

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
                        onClick={() => { playSFX('click'); setSelectedOption(opt.id); }}
                        style={{
                          ...styles.answerCardBtn,
                          borderColor: selectedOption === opt.id ? '#00f2fe' : 'rgba(255, 255, 255, 0.08)',
                          backgroundColor: selectedOption === opt.id ? 'rgba(0, 242, 254, 0.08)' : 'rgba(17, 19, 31, 0.65)'
                        }}
                      >
                        <span style={styles.optLetterBadge}>{opt.id.toUpperCase()}</span>
                        <span style={styles.optText}>{opt.text}</span>
                      </button>
                    ))}
                  </div>
                )}

                {gameQuestions[currentQIndex].type === 'TRUE_FALSE' && (
                  <div style={styles.tfStack}>
                    <button
                      disabled={isInputDisabled}
                      onClick={() => { playSFX('click'); setSelectedOption('true'); }}
                      style={{
                        ...styles.tfCardBtn,
                        borderColor: selectedOption === 'true' ? '#00ff87' : 'rgba(255, 255, 255, 0.08)',
                        backgroundColor: selectedOption === 'true' ? 'rgba(0, 255, 135, 0.08)' : 'rgba(17, 19, 31, 0.65)'
                      }}
                    >
                      ✓ TRUE / صحيح
                    </button>
                    <button
                      disabled={isInputDisabled}
                      onClick={() => { playSFX('click'); setSelectedOption('false'); }}
                      style={{
                        ...styles.tfCardBtn,
                        borderColor: selectedOption === 'false' ? '#ff3b5c' : 'rgba(255, 255, 255, 0.08)',
                        backgroundColor: selectedOption === 'false' ? 'rgba(255, 59, 92, 0.08)' : 'rgba(17, 19, 31, 0.65)'
                      }}
                    >
                      ✕ FALSE / خطأ
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
                      <span style={styles.inventoryTitle}>{t.powerups}</span>
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
                      <button style={styles.buzzerCircBtn} onClick={handleBuzz}>
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
                        {isRtl ? 'بانتظار إجابة الخصم...' : 'Waiting for opponent to answer...'}
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
        {screen === 'summary' && (
          <div style={styles.screenContainer}>
            <div style={styles.summaryBadgeWrapper}>
              🏆
            </div>
            
            <h1 style={styles.glowTitle} className="text-glow">{t.summaryTitle}</h1>
            
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

            <div style={styles.rewardsPanelCard}>
              <div style={styles.rewardDetailRow}>
                <span>{t.coinsEarned}</span>
                <span style={{ color: '#ffb300', fontWeight: 700 }}>+ {Math.floor(score / 10)} 🪙</span>
              </div>
              <div style={styles.rewardDetailRow}>
                <span>{t.xpGained}</span>
                <span style={{ color: '#00e676', fontWeight: 700 }}>+ 250 XP</span>
              </div>
            </div>

            <div style={styles.summaryFooter}>
              <button style={styles.returnHubBtn} onClick={() => { playSFX('click'); setScreen('dashboard'); }}>
                {t.dashboardBtn}
              </button>
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
    boxSizing: 'border-box'
  },
  topProfileBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: '52px',
    marginBottom: '10px'
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
    marginBottom: '20px'
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
    margin: '10px 0'
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
    margin: '20px 0'
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
    color: '#8a93c0'
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
    display: 'flex',
    justifyContent: 'space-between',
    padding: '12px 16px',
    backgroundColor: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.04)',
    borderRadius: '8px',
    margin: '12px 0'
  },
  paramItem: {
    display: 'flex',
    gap: '8px',
    fontSize: '0.85rem'
  },
  paramLabel: {
    color: '#8a93c0'
  },
  paramVal: {
    fontWeight: 700,
    color: '#ffffff'
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
