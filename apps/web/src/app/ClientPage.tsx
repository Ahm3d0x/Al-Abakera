'use client';

import React, { useState, useEffect, useRef } from 'react';
import { BuzzerType, GameModeType, Question, TournamentFormat, GameEvents, QuestionPack, LocalizedText } from '@mind-race/shared';
import { GameSyncService } from '../lib/gameSync';
import { useAuth } from '../context/AuthContext';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';
import { io, Socket } from 'socket.io-client';
import { RankBadge } from '../components/RankBadge';
import { PlayerProfileModal, BADGES_METADATA } from '../components/PlayerProfileModal';
import { CosmeticShopModal } from '../components/CosmeticShopModal';
import { QuestsPanel } from '../components/QuestsPanel';
import { SeasonTrackerPanel } from '../components/SeasonTrackerPanel';
import { SettingsModal } from '../components/SettingsModal';
import { getDeviceFingerprint } from '../lib/fingerprint';
import { AdminModerationModal } from '../components/AdminModerationModal';
import { OnboardingTutorial } from '../components/OnboardingTutorial';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:5000';
const CDN_URL = process.env.NEXT_PUBLIC_CDN_URL || '';

const getAssetUrl = (path: string | null | undefined): string => {
  if (!path) return '';
  if (/^(https?:|data:)/i.test(path)) {
    return path;
  }
  if (CDN_URL) {
    const base = CDN_URL.endsWith('/') ? CDN_URL.slice(0, -1) : CDN_URL;
    const relative = path.startsWith('/') ? path : `/${path}`;
    return `${base}${relative}`;
  }
  return path;
};

// ==========================================
// Web Audio API Sound Generator (No external assets required!)
// ==========================================
// Global audio settings object updated by the ClientPage component
const audioSettings = {
  enabled: true,
  volume: 0.7
};

// Track active audio sources to allow stopping long-running sounds
let activeAudioSources: { ctx: AudioContext; osc: OscillatorNode; gain: GainNode }[] = [];

const stopAllAudio = () => {
  activeAudioSources.forEach(src => {
    try {
      src.osc.stop();
      src.osc.disconnect();
      src.gain.disconnect();
      src.ctx.close();
    } catch (e) {}
  });
  activeAudioSources = [];
};

const playSFX = (type: string) => {
  if (typeof window === 'undefined' || !audioSettings.enabled) return;
  try {
    const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'correct' || type === 'correct_chime') {
      ctx.close(); // Close unused base context
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        setTimeout(() => {
          if (!audioSettings.enabled) return;
          try {
            const noteCtx = new AudioContextClass();
            const noteOsc = noteCtx.createOscillator();
            const noteGain = noteCtx.createGain();
            noteOsc.connect(noteGain);
            noteGain.connect(noteCtx.destination);

            noteOsc.type = 'triangle';
            noteOsc.frequency.setValueAtTime(freq, noteCtx.currentTime);
            noteGain.gain.setValueAtTime(0.12 * audioSettings.volume, noteCtx.currentTime);
            noteGain.gain.exponentialRampToValueAtTime(0.01, noteCtx.currentTime + 0.4);
            noteOsc.start();
            noteOsc.stop(noteCtx.currentTime + 0.45);
            
            activeAudioSources.push({ ctx: noteCtx, osc: noteOsc, gain: noteGain });
            setTimeout(() => {
              noteCtx.close();
            }, 500);
          } catch (e) {}
        }, idx * 100);
      });
    } else if (type === 'wrong' || type === 'wrong_buzz') {
      const osc2 = ctx.createOscillator();
      osc2.connect(gain);

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(135, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(65, ctx.currentTime + 0.5);

      osc2.type = 'square';
      osc2.frequency.setValueAtTime(130, ctx.currentTime);
      osc2.frequency.linearRampToValueAtTime(60, ctx.currentTime + 0.5);

      gain.gain.setValueAtTime(0.2 * audioSettings.volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

      osc.start();
      osc2.start();
      osc.stop(ctx.currentTime + 0.55);
      osc2.stop(ctx.currentTime + 0.55);
      
      activeAudioSources.push({ ctx, osc, gain });
      setTimeout(() => ctx.close(), 600);
    } else if (type === 'buzz' || type === 'buzzer_press') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(280, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(560, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.25 * audioSettings.volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.18);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);

      activeAudioSources.push({ ctx, osc, gain });
      setTimeout(() => ctx.close(), 250);
    } else if (type === 'tick' || type === 'countdown_tick') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(900, ctx.currentTime);
      gain.gain.setValueAtTime(0.04 * audioSettings.volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
      osc.start();
      osc.stop(ctx.currentTime + 0.06);
      
      setTimeout(() => ctx.close(), 100);
    } else if (type === 'final_beep') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1400, ctx.currentTime);
      gain.gain.setValueAtTime(0.15 * audioSettings.volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
      osc.start();
      osc.stop(ctx.currentTime + 0.28);

      activeAudioSources.push({ ctx, osc, gain });
      setTimeout(() => ctx.close(), 350);
    } else if (type === 'round_start') {
      ctx.close();
      const notes = [261.63, 392.00, 523.25, 659.25, 783.99]; // C4, G4, C5, E5, G5
      notes.forEach((freq, idx) => {
        setTimeout(() => {
          if (!audioSettings.enabled) return;
          try {
            const fCtx = new AudioContextClass();
            const fOsc = fCtx.createOscillator();
            const fGain = fCtx.createGain();
            fOsc.connect(fGain);
            fGain.connect(fCtx.destination);

            fOsc.type = 'triangle';
            fOsc.frequency.setValueAtTime(freq, fCtx.currentTime);
            fGain.gain.setValueAtTime(0.12 * audioSettings.volume, fCtx.currentTime);
            fGain.gain.exponentialRampToValueAtTime(0.01, fCtx.currentTime + 0.5);
            fOsc.start();
            fOsc.stop(fCtx.currentTime + 0.55);

            activeAudioSources.push({ ctx: fCtx, osc: fOsc, gain: fGain });
            setTimeout(() => fCtx.close(), 650);
          } catch (e) {}
        }, idx * 80);
      });
    } else if (type === 'round_end') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(420, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.5);
      gain.gain.setValueAtTime(0.12 * audioSettings.volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.55);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);

      activeAudioSources.push({ ctx, osc, gain });
      setTimeout(() => ctx.close(), 700);
    } else if (type === 'victory_music') {
      ctx.close();
      const arpeggio = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50];
      let noteIdx = 0;
      const interval = setInterval(() => {
        if (!audioSettings.enabled || noteIdx >= 16) {
          clearInterval(interval);
          return;
        }
        try {
          const vCtx = new AudioContextClass();
          const vOsc = vCtx.createOscillator();
          const vGain = vCtx.createGain();
          vOsc.connect(vGain);
          vGain.connect(vCtx.destination);

          const freq = arpeggio[noteIdx % arpeggio.length] * (Math.floor(noteIdx / arpeggio.length) + 1);
          vOsc.type = 'sine';
          vOsc.frequency.setValueAtTime(freq, vCtx.currentTime);
          vGain.gain.setValueAtTime(0.1 * audioSettings.volume, vCtx.currentTime);
          vGain.gain.exponentialRampToValueAtTime(0.01, vCtx.currentTime + 0.3);
          vOsc.start();
          vOsc.stop(vCtx.currentTime + 0.35);

          activeAudioSources.push({ ctx: vCtx, osc: vOsc, gain: vGain });
          setTimeout(() => vCtx.close(), 400);
        } catch (e) {}
        noteIdx++;
      }, 150);
    } else if (type === 'defeat_sound') {
      ctx.close();
      const notes = [392.00, 349.23, 311.13, 261.63]; // G4, F4, Eb4, C4
      notes.forEach((freq, idx) => {
        setTimeout(() => {
          if (!audioSettings.enabled) return;
          try {
            const dCtx = new AudioContextClass();
            const dOsc = dCtx.createOscillator();
            const dGain = dCtx.createGain();
            dOsc.connect(dGain);
            dGain.connect(dCtx.destination);

            dOsc.type = 'sawtooth';
            dOsc.frequency.setValueAtTime(freq, dCtx.currentTime);
            dGain.gain.setValueAtTime(0.12 * audioSettings.volume, dCtx.currentTime);
            dGain.gain.exponentialRampToValueAtTime(0.01, dCtx.currentTime + 0.7);
            dOsc.start();
            dOsc.stop(dCtx.currentTime + 0.75);

            activeAudioSources.push({ ctx: dCtx, osc: dOsc, gain: dGain });
            setTimeout(() => dCtx.close(), 900);
          } catch (e) {}
        }, idx * 250);
      });
    } else if (type === 'power_up') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.75);
      
      const oscMod = ctx.createOscillator();
      const modGain = ctx.createGain();
      oscMod.connect(modGain);
      modGain.connect(osc.frequency);
      oscMod.frequency.setValueAtTime(45, ctx.currentTime);
      modGain.gain.setValueAtTime(150, ctx.currentTime);

      gain.gain.setValueAtTime(0.15 * audioSettings.volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.75);

      osc.start();
      oscMod.start();
      osc.stop(ctx.currentTime + 0.8);
      oscMod.stop(ctx.currentTime + 0.8);

      activeAudioSources.push({ ctx, osc, gain });
      setTimeout(() => ctx.close(), 900);
    } else if (type === 'tournament_intro') {
      const droneOsc = ctx.createOscillator();
      const subOsc = ctx.createOscillator();
      droneOsc.connect(gain);
      subOsc.connect(gain);

      droneOsc.type = 'sawtooth';
      droneOsc.frequency.setValueAtTime(80, ctx.currentTime);
      droneOsc.frequency.linearRampToValueAtTime(160, ctx.currentTime + 2.5);

      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(40, ctx.currentTime);
      subOsc.frequency.linearRampToValueAtTime(80, ctx.currentTime + 2.5);

      gain.gain.setValueAtTime(0.25 * audioSettings.volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 2.8);

      droneOsc.start();
      subOsc.start();
      droneOsc.stop(ctx.currentTime + 2.9);
      subOsc.stop(ctx.currentTime + 2.9);

      activeAudioSources.push({ ctx, osc: droneOsc, gain });
      setTimeout(() => ctx.close(), 3000);
    } else if (type === 'audience_cheer') {
      const bufferSize = ctx.sampleRate * 2.0;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1000;
      filter.Q.value = 1.0;

      whiteNoise.connect(filter);
      filter.connect(gain);

      gain.gain.setValueAtTime(0.01, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.25 * audioSettings.volume, ctx.currentTime + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.95);

      whiteNoise.start();
      whiteNoise.stop(ctx.currentTime + 2.0);

      activeAudioSources.push({ ctx, osc: whiteNoise as unknown as OscillatorNode, gain });
      setTimeout(() => ctx.close(), 2100);
    } else if (type === 'sudden_death') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(900, ctx.currentTime + 0.35);
      
      gain.gain.setValueAtTime(0.18 * audioSettings.volume, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.38);

      osc.start();
      osc.stop(ctx.currentTime + 0.4);

      activeAudioSources.push({ ctx, osc, gain });
      setTimeout(() => ctx.close(), 450);
    } else if (type === 'slam') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(90, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.6);
      gain.gain.setValueAtTime(0.35 * audioSettings.volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.65);
      osc.start();
      osc.stop(ctx.currentTime + 0.7);

      activeAudioSources.push({ ctx, osc, gain });
      setTimeout(() => ctx.close(), 750);
    } else if (type === 'click') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      gain.gain.setValueAtTime(0.05 * audioSettings.volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);

      activeAudioSources.push({ ctx, osc, gain });
      setTimeout(() => ctx.close(), 150);
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
  },
  {
    id: 'q6',
    type: 'MULTI_SELECT',
    category: 'Math / الرياضيات',
    body: {
      en: 'Select all of the following numbers that are prime.',
      ar: 'اختر جميع الأعداد الأولية من القائمة التالية.'
    },
    options: [
      { id: 'a', text: { en: '2', ar: '2' } },
      { id: 'b', text: { en: '3', ar: '3' } },
      { id: 'c', text: { en: '9', ar: '9' } },
      { id: 'd', text: { en: '11', ar: '11' } }
    ],
    difficulty: 'Medium',
    correctAnswer: ['a', 'b', 'd'],
    explanation: {
      en: '2, 3, and 11 have no divisors other than 1 and themselves. 9 is divisible by 3.',
      ar: 'الأعداد 2 و 3 و 11 لا تقبل القسمة إلا على نفسها وعلى 1. العدد 9 يقبل القسمة على 3.'
    },
    rating: 4.4,
    createdAt: new Date()
  },
  {
    id: 'q7',
    type: 'CALCULATION_QUESTION',
    category: 'Electronics / إلكترونيات',
    body: {
      en: 'Calculate the current (in Amperes) flowing in a circuit with a 12V voltage source and a 4 Ohm resistor.',
      ar: 'احسب شدة التيار (بالأمبير) المار في دائرة كهربائية بها مصدر جهد 12 فولت ومقاومة 4 أوم.'
    },
    difficulty: 'Easy',
    explanation: {
      en: 'Using Ohm\'s law (I = V / R), Current = 12V / 4 Ohms = 3 Amperes.',
      ar: 'باستخدام قانون أوم (ت = جـ / م)، التيار = 12 / 4 = 3 أمبير.'
    },
    correctAnswer: '3',
    rating: 4.3,
    createdAt: new Date()
  },
  {
    id: 'q8',
    type: 'CIRCUIT_QUESTION',
    category: 'Electronics / إلكترونيات',
    body: {
      en: 'What is the equivalent resistance of two 10 Ohm resistors connected in parallel?',
      ar: 'ما هي المقاومة المكافئة لمقاومتين قيمة كل منهما 10 أوم متصلتين على التوازي؟'
    },
    options: [
      { id: 'a', text: { en: '20 Ohms', ar: 'أوم 20' } },
      { id: 'b', text: { en: '5 Ohms', ar: 'أوم 5' } },
      { id: 'c', text: { en: '10 Ohms', ar: 'أوم 10' } }
    ],
    difficulty: 'Medium',
    correctAnswer: 'b',
    explanation: {
      en: 'For parallel resistors: R_eq = (R1 * R2) / (R1 + R2) = 100 / 20 = 5 Ohms.',
      ar: 'للمقاومات على التوازي: م المكافئة = (م1 * م2) / (م1 + م2) = 100 / 20 = 5 أوم.'
    },
    rating: 4.5,
    createdAt: new Date()
  },
  {
    id: 'q9',
    type: 'IMAGE_QUESTION',
    category: 'Chemistry / الكيمياء',
    body: {
      en: 'Identify the chemical compound represented by this hexagonal ring structure.',
      ar: 'تعرف على المركب الكيميائي الممثل بحلقة السداسي العطري الموضحة.'
    },
    imageUrl: 'https://images.unsplash.com/photo-1603126857599-f6e157fa2fe6?auto=format&fit=crop&w=500&q=80',
    options: [
      { id: 'a', text: { en: 'Cyclohexane', ar: 'سيكلوهكسان' } },
      { id: 'b', text: { en: 'Benzene', ar: 'بنزين' } },
      { id: 'c', text: { en: 'Toluene', ar: 'تولوين' } }
    ],
    difficulty: 'Medium',
    correctAnswer: 'b',
    explanation: {
      en: 'Benzene (C6H6) is represented by a hexagonal ring with a circle or alternating double bonds.',
      ar: 'البنزين العطري (C6H6) يمثل بحلقة سداسية تحتوي على روابط ثنائية متبادلة.'
    },
    rating: 4.8,
    createdAt: new Date()
  },
  {
    id: 'q10',
    type: 'CODING_QUESTION',
    category: 'Programming / البرمجة',
    body: {
      en: 'Write a JavaScript function sum(a, b) that returns the sum of both parameters.',
      ar: 'اكتب دالة برمجية بلغة جافا سكربت sum(a, b) تقوم بإعادة مجموع المتغيرين.'
    },
    difficulty: 'Hard',
    codingTestCases: [
      { input: 'sum(2, 3)', output: '5' }
    ],
    explanation: {
      en: 'A simple return statement: function sum(a, b) { return a + b; }',
      ar: 'دالة بسيطة تعيد الناتج مباشرة: function sum(a, b) { return a + b; }'
    },
    correctAnswer: 'function sum(a, b) {\n  return a + b;\n}',
    rating: 4.9,
    createdAt: new Date()
  }
];

// ==========================================
// Correct Answer Celebration Effect Component
// ==========================================
const AnswerEffectCelebration: React.FC<{ effectKey: string | null | undefined }> = ({ effectKey }) => {
  if (!effectKey) return null;

  if (effectKey === 'laser_strike') {
    return (
      <div className="laser-sweep-overlay" id="effect-laser-strike">
        <div className="laser-line" />
      </div>
    );
  }

  if (effectKey === 'firework') {
    return (
      <div className="fireworks-overlay" id="effect-firework">
        {Array.from({ length: 24 }).map((_, i) => {
          const left = (i * 17) % 100;
          const delay = (i * 0.13) % 1.5;
          const size = ((i * 3) % 8) + 4;
          const rotation = (i * 47) % 360;
          const bgColors = ['#ffd700', '#ff007f', '#00f2fe', '#00ff87', '#ffb300'];
          const bgColor = bgColors[i % 5];
          return (
            <span 
              key={i} 
              className="sparkle-particle" 
              style={{
                left: `${left}%`,
                animationDelay: `${delay}s`,
                backgroundColor: bgColor,
                width: `${size}px`,
                height: `${size}px`,
                transform: `rotate(${rotation}deg)`
              }}
            />
          );
        })}
      </div>
    );
  }

  if (effectKey === 'matrix_rain') {
    return (
      <div className="matrix-rain-overlay" id="effect-matrix-rain">
        {Array.from({ length: 15 }).map((_, col) => {
          const delay = (col * 0.23) % 2;
          const duration = 2 + ((col * 0.37) % 3);
          const characters = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$#@%&";
          const randomText = Array.from({ length: 15 }, (_, i) => {
            const charIdx = (col * 7 + i * 13) % characters.length;
            return characters[charIdx];
          }).join('\n');

          return (
            <div 
              key={col} 
              className="matrix-column" 
              style={{
                left: `${col * 7}%`,
                animationDelay: `${delay}s`,
                animationDuration: `${duration}s`
              }}
            >
              {randomText}
            </div>
          );
        })}
      </div>
    );
  }

  return null;
};

export default function ClientPage() {
  const { user, loading, signOut, refreshProfile } = useAuth();
  const router = useRouter();

  const [isRtl, setIsRtl] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [activeSeason, setActiveSeason] = useState<any>(null);
  const [daysRemaining, setDaysRemaining] = useState<number>(0);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);

  // Audio settings states
  const [sfxEnabled, setSfxEnabled] = useState<boolean>(true);
  const [sfxVolume, setSfxVolume] = useState<number>(0.7);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isTournamentMatch, setIsTournamentMatch] = useState<boolean>(false);
  const [matchStartRP, setMatchStartRP] = useState<number>(0);
  const [matchStartBadges, setMatchStartBadges] = useState<string[]>([]);
  const [progressWidth, setProgressWidth] = useState<number>(0);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedSfxEnabled = window.localStorage.getItem('mindrace_sfx_enabled');
      if (storedSfxEnabled !== null) {
        const enabled = storedSfxEnabled === 'true';
        setSfxEnabled(enabled);
        audioSettings.enabled = enabled;
      }
      const storedSfxVolume = window.localStorage.getItem('mindrace_sfx_volume');
      if (storedSfxVolume !== null) {
        const vol = parseFloat(storedSfxVolume);
        setSfxVolume(vol);
        audioSettings.volume = vol;
      }
      const storedRtl = window.localStorage.getItem('mindrace_rtl');
      if (storedRtl !== null) {
        setIsRtl(storedRtl === 'true');
      }
      const onboardingCompleted = window.localStorage.getItem('mindrace_onboarding_completed');
      if (onboardingCompleted !== 'true') {
        setShowOnboarding(true);
      }
    }
  }, [setIsRtl]);

  useEffect(() => {
    audioSettings.enabled = sfxEnabled;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('mindrace_sfx_enabled', String(sfxEnabled));
    }
  }, [sfxEnabled]);

  useEffect(() => {
    audioSettings.volume = sfxVolume;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('mindrace_sfx_volume', String(sfxVolume));
    }
  }, [sfxVolume]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('mindrace_rtl', String(isRtl));
    }
  }, [isRtl]);

  useEffect(() => {
    const fetchActiveSeason = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;

        const res = await fetch(`${API_URL}/api/v1/seasons/active`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (res.ok) {
          const data = await res.json();
          if (data.activeSeason) {
            setActiveSeason(data.activeSeason);
            setDaysRemaining(data.daysRemaining);
          }
        }
      } catch (err) {
        console.error('Error fetching active season in ClientPage:', err);
      }
    };
    if (user) {
      fetchActiveSeason();
    }
  }, [user]);
  const [isShopOpen, setIsShopOpen] = useState(false);
  const [leaderboardCategory, setLeaderboardCategory] = useState<string>('Global');
  const [rankUpCelebration, setRankUpCelebration] = useState<{ show: boolean; oldRank: string; newRank: string } | null>(null);
  const previousRankRef = useRef<string | null>(null);
  const [unlockedBadge, setUnlockedBadge] = useState<{ show: boolean; key: string } | null>(null);
  const previousBadgesRef = useRef<string[] | null>(null);



  // Navigation and Layout states

  const getLocalizedText = (textObj: any): string => {
    if (!textObj) return '';
    if (typeof textObj === 'string') return textObj;
    return isRtl ? (textObj.ar || textObj.en || '') : (textObj.en || textObj.ar || '');
  };

  const getEquippedBorderStyle = (borderKey: string | null | undefined, rank: string): React.CSSProperties => {
    if (!borderKey) {
      return {
        borderColor: `var(--color-${rank.toLowerCase().replace(' ', '')})`,
        borderStyle: 'solid',
        borderWidth: '3px'
      };
    }
    switch (borderKey) {
      case 'cyber_neon':
        return {
          border: '4px solid transparent',
          backgroundImage: 'linear-gradient(rgba(15,18,30,1), rgba(15,18,30,1)), linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
          backgroundOrigin: 'border-box',
          backgroundClip: 'padding-box, border-box',
          boxShadow: '0 0 10px rgba(0, 242, 254, 0.6)'
        };
      case 'gold_halo':
        return {
          border: '4px solid transparent',
          backgroundImage: 'linear-gradient(rgba(15,18,30,1), rgba(15,18,30,1)), linear-gradient(135deg, #ffd700 0%, #fbbf24 100%)',
          backgroundOrigin: 'border-box',
          backgroundClip: 'padding-box, border-box',
          animation: 'gold-halo-spin 4s linear infinite'
        };
      case 'dark_matter':
        return {
          border: '4px solid transparent',
          backgroundImage: 'linear-gradient(rgba(15,18,30,1), rgba(15,18,30,1)), linear-gradient(135deg, #8b5cf6 0%, #090d16 100%)',
          backgroundOrigin: 'border-box',
          backgroundClip: 'padding-box, border-box',
          animation: 'dark-matter-pulse 2s infinite alternate'
        };
      default:
        return {
          borderColor: `var(--color-${rank.toLowerCase().replace(' ', '')})`,
          borderStyle: 'solid',
          borderWidth: '3px'
        };
    }
  };

  const parseLocalizedInput = (text: string): { ar: string; en: string } => {
    const trimmed = text ? text.trim() : '';
    if (!trimmed) return { ar: '', en: '' };
    
    // If it contains a newline, it's likely a multi-line body with English and Arabic separated
    if (trimmed.includes('\n')) {
      const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length >= 2) {
        return { en: lines[0], ar: lines[1] };
      }
    }
    
    // If it contains a slash, it's likely "English / Arabic"
    if (trimmed.includes('/')) {
      const parts = trimmed.split('/').map(p => p.trim());
      if (parts.length >= 2) {
        return { en: parts[0], ar: parts[1] };
      }
    }
    
    // Fallback: assign same text to both languages
    return { ar: trimmed, en: trimmed };
  };

  const [screen, setScreen] = useState<'dashboard' | 'lobby' | 'cinematic' | 'game' | 'summary'>('dashboard');
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  
  // Anti-Cheat states
  const [deviceBlockedStatus, setDeviceBlockedStatus] = useState<'LOADING' | 'VERIFIED' | 'BLOCKED' | 'SUSPENDED'>('VERIFIED');
  const [suspensionReason, setSuspensionReason] = useState('');
  const [isAppealSubmitted, setIsAppealSubmitted] = useState(false);
  const [appealReason, setAppealReason] = useState('');
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [socketStatus, setSocketStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [latency, setLatency] = useState<number | null>(null);
  
  // Streamer / Audience Spectator States
  const [isAudienceSpectator, setIsAudienceSpectator] = useState(false);
  const [audienceNickname, setAudienceNickname] = useState('');
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [audienceScore, setAudienceScore] = useState(0);
  const [audienceLeaderboard, setAudienceLeaderboard] = useState<{ userId: string; username: string; score: number }[]>([]);
  const [spectatorAnswerSubmitted, setSpectatorAnswerSubmitted] = useState(false);
  const [spectatorIsAnswerCorrect, setSpectatorIsAnswerCorrect] = useState<boolean | null>(null);
  const [spectatorCorrectAnswer, setSpectatorCorrectAnswer] = useState<unknown>(null);
  const [spectatorExplanation, setSpectatorExplanation] = useState<string | LocalizedText>('');
  const [spectatorPointsEarned, setSpectatorPointsEarned] = useState(0);
  const socketRef = useRef<Socket | null>(null);

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
    isMvp?: boolean;
    rankChange?: number;
    coinsEarned?: number;
    tokensEarned?: number;
    fastestAnswerMs?: number | null;
  }

  const [participants, setParticipants] = useState<PlayerParticipant[]>([]);

  // Tournament States
  const [viewingTournaments, setViewingTournaments] = useState(false);
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [selectedTournament, setSelectedTournament] = useState<any>(null);
  const [loadingTournaments, setLoadingTournaments] = useState(false);
  const [creatingTournament, setCreatingTournament] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Question Packs States
  const [viewingPacks, setViewingPacks] = useState(false);
  const [packs, setPacks] = useState<QuestionPack[]>([]);
  const [selectedPack, setSelectedPack] = useState<any>(null);
  const [loadingPacks, setLoadingPacks] = useState(false);
  const [creatingPack, setCreatingPack] = useState(false);
  const [packTitle, setPackTitle] = useState('');
  const [packDesc, setPackDesc] = useState('');
  const [packCategory, setPackCategory] = useState<'Science' | 'Math' | 'Electronics' | 'Programming' | 'Custom'>('Science');
  const [packIsPublic, setPackIsPublic] = useState(false);
  
  interface PackQuestionInput {
    type: 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'FILL_IN_THE_BLANK' | 'ORDERING_QUESTION' | 'MATCHING_QUESTION';
    body: string;
    imageUrl?: string;
    options: { id: string; text: string }[];
    correctAnswer: string;
    orderingItems: string[];
    matchingPairs: { leftId: string; leftText: string; rightId: string; rightText: string }[];
    difficulty: 'Easy' | 'Medium' | 'Hard';
    explanation: string;
  }
  const [packQuestions, setPackQuestions] = useState<PackQuestionInput[]>([
    {
      type: 'MULTIPLE_CHOICE',
      body: '',
      options: [
        { id: 'a', text: '' },
        { id: 'b', text: '' },
        { id: 'c', text: '' },
        { id: 'd', text: '' }
      ],
      correctAnswer: 'a',
      orderingItems: [],
      matchingPairs: [],
      difficulty: 'Medium',
      explanation: ''
    }
  ]);
  const [packReviewRating, setPackReviewRating] = useState<number>(5);
  const [packReviewComment, setPackReviewComment] = useState<string>('');

  // Forms state
  const [tourName, setTourName] = useState('');
  const [tourDesc, setTourDesc] = useState('');
  const [tourFormat, setTourFormat] = useState<TournamentFormat>('KNOCKOUT');
  const [tourSize, setTourSize] = useState<number>(8);
  const [tourFeeCoins, setTourFeeCoins] = useState<number>(0);
  const [tourFeeTokens, setTourFeeTokens] = useState<number>(0);
  const [tourPrizeTokens, setTourPrizeTokens] = useState<number>(10);

  // Tournament visualizer state
  const [tourActiveRoundTab, setTourActiveRoundTab] = useState<number>(1);
  const [tourActiveTab, setTourActiveTab] = useState<'bracket' | 'standings' | 'players'>('bracket');

  
  interface SoloHistoryItem {
    roundNumber: number;
    questionText: string;
    questionType: string;
    isCorrect: boolean;
    userAnswer: unknown;
    correctAnswer: unknown;
    explanation: string;
    timeSpent: number;
    powerUpsUsed?: string[];
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
        powerUpsUsed?: string[];
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
    power_ups_used?: string[];
  }

  // Enhanced summary screen states
  const [soloHistory, setSoloHistory] = useState<SoloHistoryItem[]>([]);
  const [matchReportDetails, setMatchReportDetails] = useState<MatchReportData | null>(null);
  const [loadingReportDetails, setLoadingReportDetails] = useState<boolean>(false);
  const [expandedRound, setExpandedRound] = useState<number | null>(null);
  const [copiedToastVisible, setCopiedToastVisible] = useState<boolean>(false);
  
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
  const [submittedAnswers, setSubmittedAnswers] = useState<{ [userId: string]: any }>({});
  
  // Chat and Signaling states
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<{ sender: string; message: string; teamId: string | null }[]>([]);
  const [floatingMessage, setFloatingMessage] = useState<{ sender: string; message: string; teamId: string | null } | null>(null);
  const [showSignalMenu, setShowSignalMenu] = useState(false);
  
  // Buzzer & Bidding & Voting states
  const [showBidModal, setShowBidModal] = useState(false);
  const [bidValue, setBidValue] = useState(100);
  const [teammateVotes, setTeammateVotes] = useState<{ [optionId: string]: string[] }>({}); // optionId -> usernames
  
  const [votingActive, setVotingActive] = useState(false);
  const [votingTimeLeft, setVotingTimeLeft] = useState(20);
  const [votingCandidates, setVotingCandidates] = useState<{
    bestPlayer: { id: string; username: string }[];
    bestTeam?: string[];
    bestAnswer?: { id: string; username: string }[];
  } | null>(null);
  const [myVotes, setMyVotes] = useState<Record<string, string>>({}); // category -> candidateId
  const [liveVotes, setLiveVotes] = useState<Record<string, Record<string, number>>>({}); // category -> { candidateId: count }
  const [votingWinners, setVotingWinners] = useState<{
    bestPlayer: string | null;
    bestTeam: string | null;
    bestAnswer: string | null;
  } | null>(null);
  
  // Power-Ups states
  const [showStoreModal, setShowStoreModal] = useState(false);
  const [hiddenOptions, setHiddenOptions] = useState<string[]>([]);
  const [hasDoubleChanceActive, setHasDoubleChanceActive] = useState(false);
  const [powerUpBlockActive, setPowerUpBlockActive] = useState(false);

  const ALL_POWER_UPS = [
    { type: 'JOKER', label: '⚡ Joker', desc: isRtl ? 'مضاعفة نقاط السؤال الصحيح' : 'Doubles correct question points', cost: 50 },
    { type: 'FREEZE', label: '❄ Freeze', desc: isRtl ? 'خصم 10 ثوان من مؤقت الخصم' : 'Deducts 10s from opponents timer', cost: 50 },
    { type: 'SHIELD', label: '🛡 Shield', desc: isRtl ? 'إلغاء عقوبة الإجابة الخاطئة' : 'Cancels wrong answer penalty', cost: 50 },
    { type: 'REVEAL_HINT', label: '💡 Hint', desc: isRtl ? 'حذف خيارين خاطئين من السؤال' : 'Hides two wrong MCQ options', cost: 50 },
    { type: 'DOUBLE_CHANCE', label: '🎯 Double', desc: isRtl ? 'فرصة ثانية عند الخطأ في الإجابة' : 'Gives a second attempt on error', cost: 50 },
    { type: 'STEAL', label: '🪝 Steal', desc: isRtl ? 'سرقة السؤال بعد ضغط الخصم' : 'Steals buzz if opponent hasnt answered', cost: 50 },
    { type: 'TIME_BOOST', label: '⏱ Boost', desc: isRtl ? 'إضافة 10 ثوان لمؤقتك الخاص' : 'Adds 10 seconds to your timer', cost: 50 },
    { type: 'POINT_MULTIPLIER', label: '✨ Multiplier', desc: isRtl ? 'مضاعفة نقاط الجولة بمقدار 1.5x' : 'Multiplies round points by 1.5x', cost: 50 },
    { type: 'CATEGORY_SWAP', label: '🔄 Swap', desc: isRtl ? 'تغيير فئة السؤال الحالي' : 'Swaps current question category', cost: 50 },
    { type: 'SKIP_QUESTION', label: '⏭ Skip', desc: isRtl ? 'تجاوز السؤال الحالي بالكامل' : 'Skips the current question entirely', cost: 50 },
    { type: 'BLOCK_POWER_UP', label: '🚫 Block', desc: isRtl ? 'منع الخصوم من تفعيل المساعدات' : 'Blocks opponent power-ups this round', cost: 50 }
  ];

  // Timers and Refs
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const gameSyncRef = useRef<GameSyncService | null>(null);
  const activeRoundRef = useRef<{ id: string; started_at: number } | null>(null);

  const connectToSocketServer = (roomCode: string, nickname: string, playerToken?: string) => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    const socketUrl = SOCKET_URL;
    console.log(`[Socket] Connecting to ${socketUrl} for room ${roomCode}...`);

    const connectionAuth: { token?: string; isAudience?: boolean; username?: string } = {};
    if (playerToken) {
      connectionAuth.token = playerToken;
    } else {
      connectionAuth.isAudience = true;
      connectionAuth.username = nickname;
    }

    const socket = io(socketUrl, {
      auth: connectionAuth,
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log(`[Socket] Connected to Socket.io server. ID: ${socket.id}`);
      setSocketStatus('connected');
      socket.emit(GameEvents.JOIN_ROOM, { roomId: roomCode, username: nickname });
      
      // Save joined room code for display
      setCurrentRoom((prev: unknown) => {
        if (prev) return prev;
        return {
          id: roomCode, // Fallback room ID if spectator
          code: roomCode,
          status: 'WAITING',
          config: { mode: 'FREE_FOR_ALL', roundsCount: 5, questionTimeLimitSeconds: 30, buzzerType: 'STANDARD', allowedPowerUps: [] },
          participants: []
        };
      });
      setScreen('lobby');
    });

    socket.on('disconnect', () => {
      console.log('[Socket] Disconnected from Socket.io server.');
      setSocketStatus('disconnected');
    });

    socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err);
      setSocketStatus('disconnected');
    });

    // Game lifecycle events for spectators
    socket.on(GameEvents.START_GAME, () => {
      stopAllAudio();
      if (isTournamentMatch) {
        playSFX('tournament_intro');
      } else {
        playSFX('slam');
      }
      triggerVibrate([200, 100, 200]);
      setVotingActive(false);
      setVotingWinners(null);
      setMyVotes({});
      setLiveVotes({});
      setMatchStartRP(user?.rankPoints || 0);
      setMatchStartBadges(user?.badges || []);
      setScreen('cinematic');
    });

    socket.on('game:round_start', (data: { roundIndex: number; totalRounds: number; question: { id: string; type: string; category: string; body: LocalizedText; image_url?: string; options?: { id: string; text: LocalizedText }[]; difficulty: string; explanation?: LocalizedText }; timeLeft: number; scores: Record<string, number> }) => {
      console.log('[Socket] Spectator Round Start:', data);
      setGameMode('FREE_FOR_ALL'); // Match layout style
      
      // Clean question format
      const rawQuestion = data.question;
      const formattedQ: Question = {
        id: rawQuestion.id,
        type: rawQuestion.type as any,
        category: rawQuestion.category,
        body: rawQuestion.body,
        imageUrl: rawQuestion.image_url,
        options: rawQuestion.options,
        difficulty: rawQuestion.difficulty as any,
        explanation: rawQuestion.explanation,
        rating: 0,
        createdAt: new Date(),
      };

      setGameQuestions((prev) => {
        const list = [...prev];
        list[data.roundIndex] = formattedQ;
        return list;
      });

      setCurrentQIndex(data.roundIndex);
      setTimeLeft(data.timeLeft);
      setIsBuzzed(false);
      setBuzzedUser(null);
      setSelectedOption(null);
      setTextAnswer('');
      setMatchingSelections({});
      setActiveLeftTerm(null);
      
      // Reset spectator specific grading feedback
      setSpectatorAnswerSubmitted(false);
      setSpectatorIsAnswerCorrect(null);
      setSpectatorCorrectAnswer(null);
      setSpectatorExplanation('');
      setSpectatorPointsEarned(0);

      // Local countdown timer for spectators
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current!);
            return 0;
          }
          if (prev <= 6) {
            if (prev % 2 === 0) {
              playSFX('countdown_tick');
            } else {
              playSFX('final_beep');
            }
          }
          return prev - 1;
        });
      }, 1000);

      setScreen('game');
    });

    socket.on('game:tick', (data: { timeLeft: number }) => {
      // High-frequency tick. Spectators don't receive this normally (room optimization).
      // But if they do, we sync it.
      setTimeLeft(data.timeLeft);
    });

    socket.on('game:buzzed', (data: { username: string }) => {
      console.log('[Socket] Buzzer pressed:', data);
      playSFX('buzz');
      setIsBuzzed(true);
      setBuzzedUser(data.username);
      // Restart local timer at 10 seconds
      setTimeLeft(10);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current!);
            return 0;
          }
          if (prev <= 6) {
            if (prev % 2 === 0) {
              playSFX('countdown_tick');
            } else {
              playSFX('final_beep');
            }
          }
          return prev - 1;
        });
      }, 1000);
    });

    socket.on('game:round_ended', (data: { scores?: Record<string, number>; audienceLeaderboard?: { userId: string; username: string; score: number }[]; correctAnswer: unknown; explanation?: string }) => {
      console.log('[Socket] Spectator Round Ended:', data);
      if (timerRef.current) clearInterval(timerRef.current);

      // Save audience leaderboard if present
      if (data.audienceLeaderboard) {
        setAudienceLeaderboard(data.audienceLeaderboard);
      }

      // Sync active player scores if present
      if (data.scores) {
        setParticipants((prev) =>
          prev.map((p) => ({
            ...p,
            score: data.scores![p.userId] !== undefined ? data.scores![p.userId] : p.score,
          }))
        );
      }

      // If this client hasn't submitted yet, reveal correct answer
      setSpectatorCorrectAnswer(data.correctAnswer);
      setSpectatorExplanation(data.explanation || '');
      setSpectatorAnswerSubmitted(true);
    });

    socket.on('game:ended', (data: { scores?: Record<string, number>; audienceLeaderboard?: { userId: string; username: string; score: number }[] }) => {
      console.log('[Socket] Spectator Game Ended:', data);
      if (timerRef.current) clearInterval(timerRef.current);
      
      if (data.audienceLeaderboard) {
        setAudienceLeaderboard(data.audienceLeaderboard);
      }

      // Set up a mock report details for spectators
      const playerDetails = participants.map((p) => {
        const pScore = data.scores?.[p.userId] || 0;
        return {
          ...p,
          score: pScore,
          accuracy: 0,
          correctCount: 0,
          totalAnswered: 0,
        };
      }).sort((a, b) => b.score - a.score);

      setMatchReportDetails({
        players: playerDetails,
        rounds: [],
        isMultiplayer: true,
      });

      setScreen('summary');
    });

    socket.on(GameEvents.AUDIENCE_ANSWER_GRADED, (data: { isCorrect: boolean; pointsEarned: number; correctAnswer: unknown; explanation?: string; score: number }) => {
      console.log('[Socket] Individual Audience Answer Graded:', data);
      setSpectatorIsAnswerCorrect(data.isCorrect);
      setSpectatorPointsEarned(data.pointsEarned);
      setSpectatorCorrectAnswer(data.correctAnswer);
      setSpectatorExplanation(data.explanation || '');
      setAudienceScore(data.score);
      setSpectatorAnswerSubmitted(true);

      if (data.isCorrect) {
        playSFX('correct');
      } else {
        playSFX('wrong');
      }
    });

    socket.on('game:voting_start', (data: { candidates: any; timeLeft: number }) => {
      console.log('[Socket] Voting Start:', data);
      setVotingCandidates(data.candidates);
      setVotingTimeLeft(data.timeLeft);
      setVotingActive(true);
      setMyVotes({});
      setLiveVotes({
        best_player: {},
        best_team: {},
        best_answer: {}
      });
      setVotingWinners(null);
    });

    socket.on('game:voting_tick', (data: { timeLeft: number }) => {
      setVotingTimeLeft(data.timeLeft);
      if (data.timeLeft <= 5) {
        playSFX('tick');
      }
    });

    socket.on('game:vote_update', (data: { category: string; votes: Record<string, number> }) => {
      setLiveVotes((prev) => ({
        ...prev,
        [data.category]: data.votes
      }));
    });

    socket.on('game:voting_results', (data: { bestPlayer: string | null; bestTeam: string | null; bestAnswer: string | null }) => {
      console.log('[Socket] Voting Results:', data);
      setVotingWinners(data);
      setVotingActive(false);
      playSFX('correct');
    });
  };

  const submitSpectatorAnswer = (ans: unknown) => {
    if (!currentRoom || !socketRef.current) return;
    setSpectatorAnswerSubmitted(true);
    socketRef.current.emit(GameEvents.SUBMIT_AUDIENCE_ANSWER, {
      roomId: currentRoom.id,
      answer: ans,
    });
  };

  const handleJoinAsAudienceGuest = (nicknameStr: string) => {
    if (!nicknameStr.trim()) return;
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const room = params.get('room');
      if (room) {
        setAudienceNickname(nicknameStr.trim());
        setShowNicknameModal(false);
        connectToSocketServer(room, nicknameStr.trim());
      }
    }
  };

  const setupGameSyncCallbacks = (sync: GameSyncService) => {
    sync.setCallbacks({
      onParticipantsUpdate: (list) => {
        setParticipants(list as unknown as PlayerParticipant[]);
      },
      onConfigUpdate: (config) => {
        setCurrentRoom((prev: any) => prev ? { ...prev, config } : null);
      },
      onGameStart: () => {
        stopAllAudio();
        if (isTournamentMatch) {
          playSFX('tournament_intro');
        } else {
          playSFX('slam');
        }
        triggerVibrate([200, 100, 200]);
        setVotingActive(false);
        setVotingWinners(null);
        setMyVotes({});
        setLiveVotes({});
        setMatchStartRP(user?.rankPoints || 0);
        setMatchStartBadges(user?.badges || []);
        setScreen('cinematic');
      },
      onRoundStart: async (data) => {
        setGameMode(currentRoom?.config?.mode || 'FREE_FOR_ALL');
        activeRoundRef.current = { id: data.roundId, started_at: Date.now() };
        setSubmittedAnswers({});

        const bt = currentRoom?.config?.buzzerType || 'STANDARD';
        if (bt === 'SUDDEN_DEATH') {
          playSFX('sudden_death');
        } else {
          playSFX('round_start');
        }

        const { data: existingAnswers } = await supabase
          .from('round_answers')
          .select('*')
          .eq('round_id', data.roundId);

        if (existingAnswers) {
          const mapped: any = {};
          existingAnswers.forEach((ans: any) => {
            mapped[ans.user_id] = ans;
          });
          setSubmittedAnswers(mapped);
        }
        
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
        setHiddenOptions([]);
        setHasDoubleChanceActive(false);
        setPowerUpBlockActive(false);
        const mode = currentRoom?.config?.mode || 'FREE_FOR_ALL';
        if (mode === 'PRACTICE') {
          setInventoryPowerUps(['JOKER', 'FREEZE', 'SHIELD', 'REVEAL_HINT', 'DOUBLE_CHANCE', 'STEAL', 'TIME_BOOST', 'POINT_MULTIPLIER', 'CATEGORY_SWAP', 'SKIP_QUESTION', 'BLOCK_POWER_UP']);
        }

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
        playSFX('buzzer_press');
        setIsBuzzed(true);
        setBuzzedUser(data.username);
        if (data.username === user?.username && socketRef.current) {
          socketRef.current.emit(GameEvents.BUZZ, { roomId: currentRoom?.code });
        }
      },
      onBuzzerReset: () => {
        setIsBuzzed(false);
        setBuzzedUser(null);
      },
      onRoundEnded: (data) => {
        setIsAnswerCorrect(data.isCorrect);
        setRevealedCorrectAnswer(data.correctAnswer);
        setAnswerSubmitted(true);

        playSFX('round_end');

        if (data.isCorrect) {
          setTimeout(() => playSFX('correct'), 300);
        } else {
          setTimeout(() => playSFX('wrong'), 300);
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
        stopAllAudio();
        if (data && data.winnerId === user?.id) {
          playSFX('victory_music');
        } else {
          playSFX('defeat_sound');
        }
        setScreen('summary');
        refreshProfile();
      },
      onAnswerSubmitted: (data: any) => {
        setSubmittedAnswers(prev => ({
          ...prev,
          [data.user_id]: data
        }));
      },
      onPowerUpUsed: (data) => {
        playSFX('power_up');
        const oppName = participants.find(p => p.userId === data.userId)?.username || (isRtl ? 'الخصم' : 'Opponent');
        if (data.powerUpType === 'FREEZE' && data.targetUserId === user!.id) {
          triggerGamingAlert(isRtl ? 'تم تجميدك من قبل الخصم!' : 'You have been frozen by the opponent!', 'warning');
          setTimeLeft(prev => Math.max(0, prev - 10));
        }
        if (data.powerUpType === 'BLOCK_POWER_UP' && data.userId !== user!.id) {
          triggerGamingAlert(isRtl ? 'تم حظر مساعداتك لهذه الجولة!' : 'Your power-ups have been blocked for this round!', 'error');
          setPowerUpBlockActive(true);
        }
        if (data.powerUpType === 'STEAL' && data.userId !== user!.id) {
          triggerGamingAlert(isRtl ? `قام ${oppName} بسرقة البازر الخاص بك!` : `${oppName} stole your buzz!`, 'warning');
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
          questionText: getLocalizedText(q.body),
          questionType: q.type,
          isCorrect: false,
          userAnswer: null,
          correctAnswer: q.correctAnswer || q.orderingItems || q.matchingPairs,
          explanation: getLocalizedText(q.explanation),
          timeSpent: 30,
          powerUpsUsed: [...activePowerUps]
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

  async function handleSubmitAnswer() {
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
    } else if (q.type === 'FILL_IN_THE_BLANK' || q.type === 'CALCULATION_QUESTION' || q.type === 'CODING_QUESTION' || q.type === 'SHORT_ANSWER') {
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

    if (hasDoubleChanceActive) {
      const res = await supabase.rpc('check_answer_correct', {
        p_question_id: q.id,
        p_answer: typeof userAns === 'object' ? userAns : JSON.stringify(userAns)
      });
      
      if (!res.error) {
        const isCorrect = res.data;
        if (!isCorrect) {
          playSFX('wrong');
          setHasDoubleChanceActive(false);
          triggerGamingAlert(
            isRtl ? 'إجابة خاطئة! تم تفعيل الفرصة الثانية، حاول مجدداً.' : 'Wrong answer! Second chance activated, try again.',
            'warning'
          );
          if (typeof userAns === 'string') {
            setHiddenOptions(prev => [...prev, userAns]);
          }
          return;
        } else {
          setHasDoubleChanceActive(false);
        }
      }
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
      
      if (socketRef.current) {
        socketRef.current.emit(GameEvents.SUBMIT_ANSWER, {
          roomId: currentRoom.code,
          answer: finalAns
        });
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
          questionText: getLocalizedText(q.body),
          questionType: q.type,
          isCorrect,
          userAnswer: userAns,
          correctAnswer: q.correctAnswer || q.orderingItems || q.matchingPairs,
          explanation: getLocalizedText(q.explanation),
          timeSpent: 30 - timeLeft,
          powerUpsUsed: [...activePowerUps]
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
          questionText: getLocalizedText(q.body),
          questionType: q.type,
          isCorrect,
          userAnswer: userAns,
          correctAnswer: q.correctAnswer || q.orderingItems || q.matchingPairs,
          explanation: getLocalizedText(q.explanation),
          timeSpent: 30 - timeLeft,
          powerUpsUsed: [...activePowerUps]
        }
      ]);
    }
  }

  const submitVote = (category: string, candidateId: string) => {
    if (!currentRoom || !socketRef.current) return;
    setMyVotes((prev) => ({
      ...prev,
      [category]: candidateId
    }));
    playSFX('click');
    socketRef.current.emit('game:submit_vote', {
      roomId: currentRoom.code || currentRoom.id,
      category,
      candidateId
    });
  };

  function loadQuestion(index: number) {
    setCurrentQIndex(index);
    setTimeLeft(gameMode === 'PRACTICE' ? 99 : 30);
    setBuzzerActive(gameMode !== 'PRACTICE');
    setIsBuzzed(false);
    setSelectedOption(null);
    setTextAnswer('');
    setSubmittedAnswers({});
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
      const prevDateStr = nextStats.lastDailyChallengeCompleted;
      let currentStreak = nextStats.dailyStreak || 0;
      
      if (prevDateStr) {
        const today = new Date(todayDateStr);
        const prev = new Date(prevDateStr);
        const diffDays = Math.floor((today.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
        
        if (diffDays === 1) {
          currentStreak += 1;
        } else if (diffDays > 1) {
          currentStreak = 1;
        }
      } else {
        currentStreak = 1;
      }
      
      nextStats.lastDailyChallengeCompleted = todayDateStr;
      nextStats.dailyStreak = currentStreak;
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

  // Verify Device on load/user change
  useEffect(() => {
    async function verifyDevice() {
      if (!user) {
        setDeviceBlockedStatus('VERIFIED');
        return;
      }
      
      setDeviceBlockedStatus('LOADING');
      try {
        const fingerprint = getDeviceFingerprint();
        const { data: { session } } = await supabase.auth.getSession();
        
        const res = await fetch(`${API_URL}/api/v1/security/verify-device`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token || ''}`
          },
          body: JSON.stringify({ fingerprint })
        });
        const data = await res.json();
        
        if (data.status === 'verified') {
          setDeviceBlockedStatus('VERIFIED');
        } else if (data.status === 'suspended') {
          setDeviceBlockedStatus('SUSPENDED');
          setSuspensionReason(data.reason || '');
        } else if (data.status === 'blocked') {
          const { data: appeal } = await supabase
            .from('device_appeals')
            .select('status')
            .eq('user_id', user.id)
            .eq('device_fingerprint', fingerprint)
            .eq('status', 'PENDING')
            .maybeSingle();
            
          if (appeal) {
            setIsAppealSubmitted(true);
          }
          setDeviceBlockedStatus('BLOCKED');
        }
      } catch (err) {
        console.error('Verify device error:', err);
        setDeviceBlockedStatus('VERIFIED');
      }
    }
    
    verifyDevice();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAppealSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appealReason.trim()) return;
    try {
      const fingerprint = getDeviceFingerprint();
      const { data: { session } } = await supabase.auth.getSession();
      
      const res = await fetch(`${API_URL}/api/v1/security/appeal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`
        },
        body: JSON.stringify({ fingerprint, reason: appealReason })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setIsAppealSubmitted(true);
      }
    } catch (err) {
      console.error('Error submitting appeal:', err);
    }
  };

  // Capture previous rank when gameplay starts
  useEffect(() => {
    if ((screen === 'game' || screen === 'cinematic') && user) {
      previousRankRef.current = user.rank;
      console.log('[Progression] Stored previous rank for match check:', user.rank);
    }
  }, [screen, user]);

  // Check for rank promotion after profile refresh
  useEffect(() => {
    if (user && previousRankRef.current && previousRankRef.current !== user.rank) {
      const ranks = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grand Master', 'Legend', 'Mythic', 'Titan'];
      const oldIdx = ranks.indexOf(previousRankRef.current);
      const newIdx = ranks.indexOf(user.rank);
      
      if (newIdx > oldIdx) {
        console.log('[Progression] Rank UP detected! Old:', previousRankRef.current, 'New:', user.rank);
        setRankUpCelebration({ show: true, oldRank: previousRankRef.current, newRank: user.rank });
        playSFX('correct');
      }
      previousRankRef.current = null;
    }
  }, [user]);

  // Check for newly unlocked badges
  useEffect(() => {
    if (user) {
      if (previousBadgesRef.current !== null) {
        const newlyUnlocked = (user.badges || []).filter(b => !previousBadgesRef.current!.includes(b));
        if (newlyUnlocked.length > 0) {
          console.log('[Progression] Badge UNLOCKED detected:', newlyUnlocked);
          setUnlockedBadge({ show: true, key: newlyUnlocked[0] });
          playSFX('correct');
        }
      }
      previousBadgesRef.current = user.badges || [];
    }
  }, [user]);

  // ==========================================
  // Redirect if not logged in
  // ==========================================
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('role') === 'audience') {
        return; // Bypass redirect for stream audience
      }
    }
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  // ==========================================
  // URL Query Detection for Streamer Mode Audience
  // ==========================================
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const room = params.get('room');
      const role = params.get('role');
      if (room && role === 'audience') {
        setTimeout(() => {
          setIsAudienceSpectator(true);
          if (!loading) {
            if (user) {
              connectToSocketServer(room, user.username);
            } else {
              setShowNicknameModal(true);
            }
          }
        }, 0);
      }
    }
  }, [user, loading]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Real-time listener for the active tournament
  useEffect(() => {
    if (!selectedTournament) return;

    const channel = supabase
      .channel(`tournament-detail:${selectedTournament.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tournaments',
          filter: `id=eq.${selectedTournament.id}`
        },
        (payload) => {
          console.log('Realtime tournament update:', payload);
          fetchTournamentDetails(selectedTournament.id);
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [selectedTournament?.id]);


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
          if (prev % 2 === 0) {
            playSFX('countdown_tick');
          } else {
            playSFX('final_beep');
          }
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

        const { data: { session } } = await supabase.auth.getSession();
        connectToSocketServer(roomData.code, user!.username, session?.access_token || undefined);
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

         const { data: { session } } = await supabase.auth.getSession();
         connectToSocketServer(room.code, user!.username, session?.access_token || undefined);
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
  // Tournament API Operations
  // ==========================================
  function copyStreamerLink() {
    if (!currentRoom) return;
    const link = `${window.location.origin}/?room=${currentRoom.code}&role=audience`;
    navigator.clipboard.writeText(link);
    setCopiedLink(true);
    triggerGamingAlert(isRtl ? 'تم نسخ رابط البث!' : 'Streamer link copied!', 'success');
    playSFX('click');
    setTimeout(() => setCopiedLink(false), 2000);
  }

  async function fetchTournaments() {
    setLoadingTournaments(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${API_URL}/api/v1/tournaments`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setTournaments(data);
      } else {
        console.error('Failed to fetch tournaments list');
      }
    } catch (e) {
      console.error('Error fetching tournaments:', e);
    } finally {
      setLoadingTournaments(false);
    }
  }

  async function fetchTournamentDetails(id: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${API_URL}/api/v1/tournaments/${id}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedTournament(data);
      } else {
        console.error('Failed to fetch tournament details');
      }
    } catch (e) {
      console.error('Error fetching tournament details:', e);
    }
  }

  async function registerForTournament(id: string) {
    playSFX('click');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${API_URL}/api/v1/tournaments/${id}/register`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (res.ok) {
        triggerGamingAlert(isRtl ? 'تم التسجيل بنجاح!' : 'Registered successfully!', 'success');
        await fetchTournamentDetails(id);
        await refreshProfile();
      } else {
        const err = await res.json();
        triggerGamingAlert(err.error || (isRtl ? 'فشل التسجيل' : 'Registration failed'), 'error');
      }
    } catch (e) {
      console.error('Registration error:', e);
      triggerGamingAlert(isRtl ? 'حدث خطأ أثناء التسجيل' : 'Error registering for tournament', 'error');
    }
  }

  async function handleCreateTournament(e: React.FormEvent) {
    e.preventDefault();
    if (!tourName.trim()) {
      triggerGamingAlert(isRtl ? 'الرجاء إدخال اسم البطولة' : 'Please enter tournament name', 'warning');
      return;
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${API_URL}/api/v1/tournaments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: tourName,
          description: tourDesc,
          format: tourFormat,
          bracketSize: tourSize,
          entryFeeCoins: tourFeeCoins,
          entryFeeTokens: tourFeeTokens,
          prizePool: { first_place_tokens: tourPrizeTokens }
        })
      });
      if (res.ok) {
        const created = await res.json();
        triggerGamingAlert(isRtl ? 'تم إنشاء البطولة بنجاح!' : 'Tournament created successfully!', 'success');
        setCreatingTournament(false);
        setTourName('');
        setTourDesc('');
        setTourFeeCoins(0);
        setTourFeeTokens(0);
        setTourPrizeTokens(10);
        await fetchTournamentDetails(created.id);
        await refreshProfile();
      } else {
        const err = await res.json();
        triggerGamingAlert(err.error || (isRtl ? 'فشل إنشاء البطولة' : 'Failed to create tournament'), 'error');
      }
    } catch (err) {
      console.error('Create tournament error:', err);
      triggerGamingAlert(isRtl ? 'حدث خطأ أثناء إنشاء البطولة' : 'Error hosting tournament', 'error');
    }
  }

  async function joinTournamentRoom(matchId: string, isSpectator = false) {
    playSFX('click');
    try {
      const { data: room, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', matchId)
        .maybeSingle();

      if (roomError || !room) {
        triggerGamingAlert(isRtl ? 'لم يتم العثور على الغرفة أو لم تبدأ بعد.' : 'Match room not found or not active yet.', 'error');
        return;
      }

      const { error: joinError } = await supabase
        .from('room_participants')
        .upsert({
          room_id: room.id,
          user_id: user!.id,
          is_host: room.host_id === user!.id,
          is_ready: true,
          score: 0,
          is_spectator: isSpectator
        }, {
          onConflict: 'room_id,user_id'
        });

      if (joinError) {
        triggerGamingAlert('Failed to join match: ' + joinError.message, 'error');
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

      const { data: { session } } = await supabase.auth.getSession();
      connectToSocketServer(room.code, user!.username, session?.access_token || undefined);
    } catch (e) {
      console.error('joinTournamentRoom error:', e);
      triggerGamingAlert('Error joining tournament match.', 'error');
    }
  }

  // ==========================================
  // Game Board Operations
  // ==========================================
  const loadLeaderboardData = async (category: string = 'Global') => {
    setLeaderboardCategory(category);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      if (token) {
        const res = await fetch(`${API_URL}/api/v1/leaderboard?category=${category}&limit=10`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (res.ok) {
          const body = await res.json();
          if (body.status === 'success' && body.leaderboard) {
            setLeaderboard(body.leaderboard);
            return;
          }
        }
      }

      // Fallback if backend API is offline or returns error
      console.warn('[Leaderboard] Backend cached route failed or token missing. Falling back to direct Supabase RPC.');
      const { data, error } = await supabase.rpc('get_category_leaderboard', {
        p_category: category,
        p_limit: 10
      });
      
      if (!error && data) {
        setLeaderboard(data);
      } else {
        console.error('Error fetching leaderboard RPC fallback:', error);
        // Fallback to basic profiles query for Global if RPC is not deployed yet
        if (category === 'Global') {
          const { data: fbData, error: fbErr } = await supabase
            .from('profiles')
            .select('username, rank, rank_points, coins, stats')
            .order('rank_points', { ascending: false })
            .limit(10);
          if (!fbErr && fbData) {
            setLeaderboard(fbData);
          }
        } else {
          setLeaderboard([]);
        }
      }
    } catch (e) {
      console.error('Error in loadLeaderboardData:', e);
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
    setMatchStartRP(user?.rankPoints || 0);
    setMatchStartBadges(user?.badges || []);

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
          points_earned,
          power_ups_used
        `)
        .in('round_id', roundIds);

      if (aError || !answers) {
        console.error("Error fetching answers:", aError);
        setLoadingReportDetails(false);
        return;
      }

      const typedAnswers = answers as unknown as DbAnswer[];

      // 3.5 Fetch match participant rewards and stats
      const { data: matchParticipantsStats, error: mpError } = await supabase
        .from('match_participants')
        .select(`
          user_id,
          team_id,
          score,
          correct_count,
          incorrect_count,
          fastest_answer_ms,
          is_mvp,
          rank_change,
          coins_earned,
          tokens_earned
        `)
        .eq('match_id', matchId);

      if (mpError) {
        console.warn("Could not fetch match participant stats, utilizing fallbacks:", mpError);
      }

      // 4. Group details by player and by round
      const activePlayers = participants.filter((p) => !p.isSpectator);

      // Compute accuracy rate for each player
      const playerDetails = activePlayers.map((p) => {
        const playerAnswers = typedAnswers.filter((a) => a.user_id === p.userId);
        const correctCount = playerAnswers.filter((a) => a.is_correct).length;
        const totalAnswered = playerAnswers.length;
        const accuracy = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;
        
        // Find matching stats row
        const statsRow = matchParticipantsStats?.find((s) => s.user_id === p.userId);

        return {
          ...p,
          accuracy,
          correctCount,
          totalAnswered,
          answers: playerAnswers,
          isMvp: statsRow ? statsRow.is_mvp : false,
          rankChange: statsRow ? statsRow.rank_change : 0,
          coinsEarned: statsRow ? statsRow.coins_earned : 0,
          tokensEarned: statsRow ? statsRow.tokens_earned : 0,
          fastestAnswerMs: statsRow ? statsRow.fastest_answer_ms : null
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
              pointsEarned: ans.points_earned,
              powerUpsUsed: ans.power_ups_used || []
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

  // Animate rank progression bar
  useEffect(() => {
    if (screen === 'summary' && !loadingReportDetails && matchReportDetails) {
      const getTierInfoLocal = (rp: number) => {
        const tiers = [
          { name: 'Bronze', min: 0, max: 999 },
          { name: 'Silver', min: 1000, max: 1999 },
          { name: 'Gold', min: 2000, max: 2999 },
          { name: 'Platinum', min: 3000, max: 3999 },
          { name: 'Diamond', min: 4000, max: 4999 },
          { name: 'Master', min: 5000, max: 5999 },
          { name: 'Grand Master', min: 6000, max: 6999 },
          { name: 'Legend', min: 7000, max: 7999 },
          { name: 'Mythic', min: 8000, max: 8999 },
          { name: 'Titan', min: 9000, max: 999999 }
        ];
        const tier = tiers.find(t => rp >= t.min && rp <= t.max) || tiers[0];
        const range = tier.name === 'Titan' ? 1000 : (tier.max - tier.min + 1);
        return Math.min(100, Math.max(0, ((rp - tier.min) / range) * 100));
      };

      const startPercent = getTierInfoLocal(matchStartRP);
      const endPercent = getTierInfoLocal(user?.rankPoints || 0);
      
      setProgressWidth(startPercent);
      
      const timer = setTimeout(() => {
        setProgressWidth(endPercent);
      }, 600);
      
      return () => clearTimeout(timer);
    }
  }, [screen, loadingReportDetails, matchReportDetails, matchStartRP, user?.rankPoints]);

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
      if (ok) {
        if (socketRef.current) {
          socketRef.current.emit(GameEvents.BUZZ, { roomId: currentRoom.code });
        }
        if (bt === 'HIDDEN' || bt === 'AUCTION') {
          playSFX('buzz');
          triggerVibrate(150);
          setIsBuzzed(true);
          setBuzzedUser(user!.username);
        }
      }
      return;
    }

    playSFX('buzz');
    triggerVibrate(150);
    setIsBuzzed(true);
    setBuzzedUser(user!.username);
    setTimeLeft(10);
  };

  const purchasePowerUp = async (type: string) => {
    if (!user) return;
    if (user.coins < 50) {
      triggerGamingAlert(isRtl ? 'ليس لديك نقود كافية!' : 'Not enough coins!', 'error');
      return;
    }
    
    const { error } = await supabase
      .from('profiles')
      .update({ coins: user.coins - 50 })
      .eq('id', user.id);
      
    if (error) {
      triggerGamingAlert(isRtl ? 'فشل شراء المساعد!' : 'Failed to purchase power-up!', 'error');
      return;
    }
    
    setInventoryPowerUps(prev => [...prev, type]);
    await refreshProfile();
    triggerGamingAlert(isRtl ? 'تم الشراء بنجاح!' : 'Purchased successfully!', 'success');
  };

  const activatePowerUp = async (type: string) => {
    if (activePowerUps.includes(type)) return;
    
    const q = gameQuestions[currentQIndex];

    // Steal logic
    if (type === 'STEAL') {
      if (!isBuzzed || buzzedUser === user?.username) {
        triggerGamingAlert(isRtl ? 'يمكنك استخدام السرقة فقط عندما يضغط الخصم البازر أولاً!' : 'You can only use Steal when the opponent buzzes first!', 'warning');
        return;
      }
      if (currentRoom && activeRoundRef.current) {
        const ok = await supabase.rpc('steal_round_buzz', {
          p_round_id: activeRoundRef.current.id,
          p_user_id: user!.id
        });
        if (ok.data) {
          playSFX('correct');
          triggerGamingAlert(isRtl ? 'تمت سرقة السؤال بنجاح!' : 'Question stolen successfully!', 'success');
          gameSyncRef.current?.broadcastPowerUp('STEAL', user!.id);
        } else {
          triggerGamingAlert(isRtl ? 'فشل سرقة السؤال، ربما أجاب الخصم بالفعل!' : 'Failed to steal question, opponent might have answered!', 'error');
          return;
        }
      }
    }

    // Category Swap logic
    if (type === 'CATEGORY_SWAP') {
      if (isBuzzed) {
        triggerGamingAlert(isRtl ? 'لا يمكنك تبديل الفئة بعد ضغط البازر!' : 'Cannot swap category after buzzer is pressed!', 'warning');
        return;
      }
      if (currentRoom && activeRoundRef.current) {
        const ok = await supabase.rpc('swap_round_category', {
          p_round_id: activeRoundRef.current.id,
          p_user_id: user!.id
        });
        if (ok.data) {
          playSFX('correct');
          triggerGamingAlert(isRtl ? 'تم تبديل الفئة بنجاح!' : 'Category swapped successfully!', 'success');
        } else {
          triggerGamingAlert(isRtl ? 'فشل تبديل الفئة!' : 'Failed to swap category!', 'error');
          return;
        }
      }
    }

    // Skip Question logic
    if (type === 'SKIP_QUESTION') {
      if (currentRoom && activeRoundRef.current) {
        const ok = await supabase.rpc('skip_round_question', {
          p_round_id: activeRoundRef.current.id,
          p_user_id: user!.id
        });
        if (ok.data) {
          playSFX('correct');
          triggerGamingAlert(isRtl ? 'تم تخطي السؤال!' : 'Question skipped!', 'success');
        } else {
          triggerGamingAlert(isRtl ? 'فشل تخطي السؤال!' : 'Failed to skip question!', 'error');
          return;
        }
      } else {
        nextQuestion();
      }
    }

    // Client-side execution
    playSFX('buzz');
    triggerVibrate(80);
    setActivePowerUps(prev => [...prev, type]);
    
    if (gameMode !== 'PRACTICE') {
      setInventoryPowerUps(prev => {
        const index = prev.indexOf(type);
        if (index > -1) {
          const nextInv = [...prev];
          nextInv.splice(index, 1);
          return nextInv;
        }
        return prev;
      });
    }

    if (type === 'FREEZE') {
      if (currentRoom && gameSyncRef.current) {
        const opp = participants.find(p => p.userId !== user?.id && !p.isSpectator);
        if (opp) {
          gameSyncRef.current.broadcastPowerUp('FREEZE', opp.userId);
        }
      }
    }

    if (type === 'BLOCK_POWER_UP') {
      if (currentRoom && gameSyncRef.current) {
        gameSyncRef.current.broadcastPowerUp('BLOCK_POWER_UP');
      }
    }

    if (type === 'TIME_BOOST') {
      setTimeLeft(prev => prev + 10);
    }

    if (type === 'REVEAL_HINT') {
      if (q && q.correctAnswer) {
        const incorrect = q.options?.filter(o => o.id !== q.correctAnswer) || [];
        const toHide = incorrect.sort(() => Math.random() - 0.5).slice(0, 2).map(o => o.id);
        setHiddenOptions(toHide);
        triggerGamingAlert(isRtl ? 'تم حذف خيارين خاطئين!' : 'Two incorrect options removed!', 'success');
      } else {
        if (q && q.explanation) {
          triggerGamingAlert(isRtl ? `تلميح: ${getLocalizedText(q.explanation)}` : `Hint: ${getLocalizedText(q.explanation)}`, 'info');
        } else if (q && q.options && q.options.length > 1) {
          let hiddenOne = false;
          for (const opt of q.options) {
            const res = await supabase.rpc('check_answer_correct', {
              p_question_id: q.id,
              p_answer: JSON.stringify(opt.id)
            });
            if (!res.error && !res.data) {
              setHiddenOptions([opt.id]);
              triggerGamingAlert(isRtl ? 'تم حذف خيار خاطئ!' : 'One incorrect option removed!', 'success');
              hiddenOne = true;
              break;
            }
          }
          if (!hiddenOne) {
            triggerGamingAlert(isRtl ? 'لا يوجد تلميح متاح!' : 'No hint available!', 'info');
          }
        } else {
          triggerGamingAlert(isRtl ? 'لا يوجد تلميح متاح!' : 'No hint available!', 'info');
        }
      }
    }

    if (type === 'DOUBLE_CHANCE') {
      setHasDoubleChanceActive(true);
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
      expandQuestion: 'Click to expand question body & explanation',
      votingTitle: 'Awards Voting',
      votingSub: 'Vote for the best players and answers of this match!',
      timeLeft: 'Time Left',
      mvpLabel: 'Match MVP (Best Player)',
      bestTeamLabel: 'Best Team',
      bestAnswerLabel: 'Best Answer',
      voteCast: 'Vote Cast!',
      awardsWinnersTitle: '🏆 Match Awards Winners 🏆',
      mvpWinner: '🏆 Match MVP',
      bestTeamWinner: '🔥 Best Team',
      bestAnswerWinner: '💡 Best Answer',
      votingConcluded: 'Voting Concluded',
      rankProgression: 'Rank Progression',
      highlightsTitle: 'Highlight Reel (Top Moments)',
      avgSpeed: 'Average Speed',
      fastestSpeed: 'Fastest Correct',
      powerupsUsed: 'Power-ups Used',
      shareResult: 'Share Result',
      copiedToast: 'Copied to clipboard!'
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
      expandQuestion: 'اضغط لعرض نص السؤال والشرح',
      votingTitle: 'التصويت على الجوائز',
      votingSub: 'صوت لأفضل اللاعبين والإجابات في هذه المواجهة!',
      timeLeft: 'الوقت المتبقي',
      mvpLabel: 'أفضل لاعب في المباراة (MVP)',
      bestTeamLabel: 'أفضل فريق',
      bestAnswerLabel: 'صاحب أفضل إجابة',
      voteCast: 'تم التصويت!',
      awardsWinnersTitle: '🏆 الفائزون بجوائز المواجهة 🏆',
      mvpWinner: '🏆 أفضل لاعب (MVP)',
      bestTeamWinner: '🔥 أفضل فريق',
      bestAnswerWinner: '💡 صاحب أفضل إجابة',
      votingConcluded: 'انتهى التصويت',
      rankProgression: 'تقدم الرتبة',
      highlightsTitle: 'أبرز لحظات المواجهة',
      avgSpeed: 'متوسط سرعة الإجابة',
      fastestSpeed: 'أسرع إجابة صحيحة',
      powerupsUsed: 'المساعدات المستخدمة',
      shareResult: 'مشاركة النتيجة',
      copiedToast: 'تم نسخ النص إلى الحافظة!'
    }
  };

  const renderTournamentsView = () => {
    if (creatingTournament) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
              <button style={styles.backBtn} onClick={() => setCreatingTournament(false)}>◀</button>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ffffff' }}>
                {isRtl ? 'إنشاء بطولة جديدة' : 'Create New Tournament'}
              </h2>
            </div>
            
            <form onSubmit={handleCreateTournament} style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', maxHeight: '420px', paddingRight: '4px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.75rem', color: '#8a93c0' }}>{isRtl ? 'اسم البطولة' : 'Tournament Name'}</label>
                <input
                  type="text"
                  required
                  placeholder={isRtl ? 'أدخل اسم البطولة...' : 'Enter tournament name...'}
                  value={tourName}
                  onChange={(e) => setTourName(e.target.value)}
                  style={{
                    padding: '10px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#ffffff',
                    fontSize: '0.85rem'
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.75rem', color: '#8a93c0' }}>{isRtl ? 'وصف البطولة' : 'Description'}</label>
                <textarea
                  placeholder={isRtl ? 'أدخل وصف البطولة...' : 'Enter description...'}
                  value={tourDesc}
                  onChange={(e) => setTourDesc(e.target.value)}
                  style={{
                    padding: '10px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#ffffff',
                    fontSize: '0.85rem',
                    minHeight: '60px',
                    resize: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.75rem', color: '#8a93c0' }}>{isRtl ? 'نظام البطولة' : 'Format'}</label>
                  <select
                    value={tourFormat}
                    onChange={(e) => setTourFormat(e.target.value as TournamentFormat)}
                    style={{
                      padding: '10px',
                      borderRadius: '6px',
                      backgroundColor: '#111528',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      color: '#ffffff',
                      fontSize: '0.85rem'
                    }}
                  >
                    <option value="KNOCKOUT">{isRtl ? 'خروج المغلوب' : 'Knockout'}</option>
                    <option value="DOUBLE_ELIMINATION">{isRtl ? 'الفرصة المزدوجة' : 'Double Elimination'}</option>
                    <option value="LEAGUE">{isRtl ? 'دوري' : 'League'}</option>
                    <option value="SWISS">{isRtl ? 'سويسري' : 'Swiss'}</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.75rem', color: '#8a93c0' }}>{isRtl ? 'حجم البطولة' : 'Bracket Size'}</label>
                  <select
                    value={tourSize}
                    onChange={(e) => setTourSize(Number(e.target.value))}
                    style={{
                      padding: '10px',
                      borderRadius: '6px',
                      backgroundColor: '#111528',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      color: '#ffffff',
                      fontSize: '0.85rem'
                    }}
                  >
                    <option value={8}>8 {isRtl ? 'فرق' : 'teams'}</option>
                    <option value={16}>16 {isRtl ? 'فريق' : 'teams'}</option>
                    <option value={32}>32 {isRtl ? 'فريق' : 'teams'}</option>
                    <option value={64}>64 {isRtl ? 'فريق' : 'teams'}</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.75rem', color: '#8a93c0' }}>{isRtl ? 'رسوم الدخول (نقود)' : 'Entry Fee (Coins)'}</label>
                  <input
                    type="number"
                    min="0"
                    value={tourFeeCoins}
                    onChange={(e) => setTourFeeCoins(Number(e.target.value))}
                    style={{
                      padding: '10px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      color: '#ffffff',
                      fontSize: '0.85rem'
                    }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.75rem', color: '#8a93c0' }}>{isRtl ? 'رسوم الدخول (توكن)' : 'Entry Fee (Tokens)'}</label>
                  <input
                    type="number"
                    min="0"
                    value={tourFeeTokens}
                    onChange={(e) => setTourFeeTokens(Number(e.target.value))}
                    style={{
                      padding: '10px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      color: '#ffffff',
                      fontSize: '0.85rem'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.75rem', color: '#8a93c0' }}>{isRtl ? 'الجائزة الكبرى (توكن)' : 'Prize Pool (Tokens)'}</label>
                <input
                  type="number"
                  min="1"
                  value={tourPrizeTokens}
                  onChange={(e) => setTourPrizeTokens(Number(e.target.value))}
                  style={{
                    padding: '10px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#ffffff',
                    fontSize: '0.85rem'
                  }}
                />
              </div>

              <button
                type="submit"
                style={{
                  marginTop: '10px',
                  padding: '12px',
                  borderRadius: '6px',
                  background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
                  color: '#05060f',
                  fontWeight: 'bold',
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 4px 15px rgba(0, 242, 254, 0.3)'
                }}
              >
                {isRtl ? 'تأكيد الإنشاء' : 'Confirm Creation'}
              </button>
            </form>
          </div>
          
          <div style={styles.bottomNavMock}>
            <span style={{ cursor: 'pointer' }} onClick={() => { setCreatingTournament(false); setViewingTournaments(false); }}>🎒</span>
            <span>🛒</span>
            <span>⚔️</span>
            <span style={{ cursor: 'pointer', ...styles.activeNavTab }}>🏰</span>
            <span style={{ cursor: 'pointer' }} onClick={() => { setCreatingTournament(false); setViewingLeaderboard(true); loadLeaderboardData(); }}>🏆</span>
          </div>
        </div>
      );
    }

    if (selectedTournament) {
      const isRegistered = selectedTournament.participants?.some((p: any) => p.userId === user?.id);
      const isFull = (selectedTournament.participants?.length || 0) >= selectedTournament.bracket_size;

      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexShrink: 0 }}>
              <button style={styles.backBtn} onClick={() => { playSFX('click'); setSelectedTournament(null); fetchTournaments(); }}>◀</button>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <h2 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#ffffff', margin: 0 }}>{selectedTournament.name}</h2>
                <span style={{ fontSize: '0.65rem', color: '#8a93c0' }}>
                  {selectedTournament.format} • {selectedTournament.bracket_size} {isRtl ? 'فرق' : 'teams'}
                </span>
              </div>
              <span style={{
                marginLeft: 'auto',
                fontSize: '0.65rem',
                backgroundColor: selectedTournament.status === 'REGISTRATION' ? 'rgba(0, 255, 135, 0.1)' : 'rgba(0, 242, 254, 0.1)',
                color: selectedTournament.status === 'REGISTRATION' ? '#00ff87' : '#00f2fe',
                padding: '2px 6px',
                borderRadius: '4px',
                fontWeight: 'bold'
              }}>
                {selectedTournament.status}
              </span>
            </div>

            {/* Main Area */}
            {selectedTournament.status === 'REGISTRATION' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
                <div style={{ padding: '12px', backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '0.8rem', color: '#8a93c0' }}>{selectedTournament.description || (isRtl ? 'لا يوجد وصف.' : 'No description available.')}</p>
                  <div style={{ display: 'flex', gap: '12px', fontSize: '0.75rem', color: '#ffffff', fontWeight: 'bold' }}>
                    <span>🪙 {selectedTournament.entry_fee_coins} {isRtl ? 'نقود' : 'coins'}</span>
                    <span>⚡ {selectedTournament.entry_fee_tokens} {isRtl ? 'توكن' : 'tokens'}</span>
                    <span style={{ color: '#ffd700' }}>🏆 {selectedTournament.prize_pool?.first_place_tokens || 10} {isRtl ? 'توكن جائزة' : 'tokens prize'}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <h4 style={{ margin: '4px 0', fontSize: '0.85rem', color: '#ffffff', fontWeight: 'bold' }}>
                    {isRtl ? 'اللاعبون المسجلون' : 'Registered Players'} ({selectedTournament.participants?.length || 0} / {selectedTournament.bracket_size})
                  </h4>

                  {isRegistered ? (
                    <div style={{ padding: '10px', textAlign: 'center', backgroundColor: 'rgba(0, 255, 135, 0.05)', border: '1px solid rgba(0, 255, 135, 0.15)', borderRadius: '6px', color: '#00ff87', fontSize: '0.8rem', fontWeight: 'bold' }}>
                      ✓ {isRtl ? 'أنت مسجل في هذه البطولة!' : 'You are registered for this tournament!'}
                    </div>
                  ) : isFull ? (
                    <div style={{ padding: '10px', textAlign: 'center', backgroundColor: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '6px', color: '#8a93c0', fontSize: '0.8rem' }}>
                      {isRtl ? 'البطولة ممتلئة، بانتظار البدء...' : 'Tournament is full, waiting to start...'}
                    </div>
                  ) : (
                    <button
                      onClick={() => registerForTournament(selectedTournament.id)}
                      style={{
                        padding: '12px',
                        backgroundColor: '#00ff87',
                        color: '#05060f',
                        border: 'none',
                        borderRadius: '6px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                        boxShadow: '0 4px 12px rgba(0, 255, 135, 0.2)'
                      }}
                    >
                      {isRtl ? 'سجل الآن في البطولة' : 'Register Now'}
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', overflowY: 'auto', maxHeight: '180px' }}>
                  {selectedTournament.participants?.map((p: any, idx: number) => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '6px' }}>
                      <span style={{ fontSize: '0.8rem', color: '#ffffff', fontWeight: 'bold' }}>
                        {idx + 1}. {p.username}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: '#8a93c0' }}>{p.rank}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                {selectedTournament.format === 'KNOCKOUT' || selectedTournament.format === 'DOUBLE_ELIMINATION' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', marginBottom: '8px', paddingBottom: '4px', flexShrink: 0 }}>
                      {selectedTournament.bracket?.map((round: any) => (
                        <button
                          key={round.roundNumber}
                          onClick={() => setTourActiveRoundTab(round.roundNumber)}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '4px',
                            backgroundColor: tourActiveRoundTab === round.roundNumber ? '#00f2fe' : 'rgba(255,255,255,0.03)',
                            color: tourActiveRoundTab === round.roundNumber ? '#05060f' : '#8a93c0',
                            border: 'none',
                            fontSize: '0.75rem',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {round.name}
                        </button>
                      ))}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1, minHeight: 0, paddingRight: '4px' }}>
                      {selectedTournament.bracket?.find((r: any) => r.roundNumber === tourActiveRoundTab)?.matchups.map((matchup: any) => {
                        const isUserP1 = matchup.p1 === user?.id;
                        const isUserP2 = matchup.p2 === user?.id;
                        const isUserInMatch = isUserP1 || isUserP2;

                        return (
                          <div
                            key={matchup.id}
                            style={{
                              padding: '10px 14px',
                              backgroundColor: isUserInMatch ? 'rgba(0, 242, 254, 0.04)' : 'rgba(255, 255, 255, 0.02)',
                              border: `1px solid ${isUserInMatch ? '#00f2fe' : 'rgba(255, 255, 255, 0.05)'}`,
                              borderRadius: '8px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px'
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
                                <span style={{
                                  fontWeight: 'bold',
                                  color: matchup.winner === matchup.p1 && matchup.winner ? '#00ff87' : '#ffffff',
                                  textDecoration: matchup.winner && matchup.winner !== matchup.p1 ? 'line-through' : 'none'
                                }}>
                                  {matchup.p1Username || 'TBD'} {isUserP1 && `(${isRtl ? 'أنت' : 'You'})`}
                                </span>
                                <span style={{
                                  fontWeight: 'bold',
                                  color: matchup.winner === matchup.p2 && matchup.winner ? '#00ff87' : '#ffffff',
                                  textDecoration: matchup.winner && matchup.winner !== matchup.p2 ? 'line-through' : 'none'
                                }}>
                                  {matchup.p2Username || 'TBD'} {isUserP2 && `(${isRtl ? 'أنت' : 'You'})`}
                                </span>
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                                <span style={{
                                  fontSize: '0.65rem',
                                  backgroundColor: matchup.status === 'COMPLETED' ? 'rgba(0, 255, 135, 0.1)' : matchup.status === 'PLAYING' ? 'rgba(0, 242, 254, 0.1)' : 'rgba(255,255,255,0.05)',
                                  color: matchup.status === 'COMPLETED' ? '#00ff87' : matchup.status === 'PLAYING' ? '#00f2fe' : '#8a93c0',
                                  padding: '1px 5px',
                                  borderRadius: '3px',
                                  fontWeight: 'bold'
                                }}>
                                  {matchup.status}
                                </span>
                              </div>
                            </div>

                            {matchup.status === 'PLAYING' && (
                              <div style={{ display: 'flex', marginTop: '4px' }}>
                                {isUserInMatch ? (
                                  <button
                                    onClick={() => joinTournamentRoom(matchup.matchId)}
                                    style={{
                                      width: '100%',
                                      padding: '8px',
                                      backgroundColor: '#00f2fe',
                                      color: '#05060f',
                                      border: 'none',
                                      borderRadius: '4px',
                                      fontSize: '0.75rem',
                                      fontWeight: 'bold',
                                      cursor: 'pointer',
                                      boxShadow: '0 0 10px rgba(0, 242, 254, 0.3)'
                                    }}
                                  >
                                    ⚔️ {isRtl ? 'العب مباراتك الآن' : 'PLAY MATCH NOW'}
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => joinTournamentRoom(matchup.matchId, true)}
                                    style={{
                                      width: '100%',
                                      padding: '8px',
                                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                      color: '#ffffff',
                                      border: '1px solid rgba(255, 255, 255, 0.1)',
                                      borderRadius: '4px',
                                      fontSize: '0.75rem',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    👁️ {isRtl ? 'شاهد المباراة' : 'Spectate Match'}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: '8px', flexShrink: 0 }}>
                      <button
                        onClick={() => setTourActiveTab('bracket')}
                        style={{
                          flex: 1,
                          padding: '10px',
                          background: 'none',
                          border: 'none',
                          borderBottom: tourActiveTab === 'bracket' ? '2px solid #00f2fe' : 'none',
                          color: tourActiveTab === 'bracket' ? '#00f2fe' : '#8a93c0',
                          fontSize: '0.8rem',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        {isRtl ? 'المباريات' : 'Matches'}
                      </button>
                      <button
                        onClick={() => setTourActiveTab('standings')}
                        style={{
                          flex: 1,
                          padding: '10px',
                          background: 'none',
                          border: 'none',
                          borderBottom: tourActiveTab === 'standings' ? '2px solid #00f2fe' : 'none',
                          color: tourActiveTab === 'standings' ? '#00f2fe' : '#8a93c0',
                          fontSize: '0.8rem',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        {isRtl ? 'الترتيب' : 'Standings'}
                      </button>
                    </div>

                    {tourActiveTab === 'bracket' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', marginBottom: '8px', paddingBottom: '4px', flexShrink: 0 }}>
                          {selectedTournament.bracket?.map((round: any) => (
                            <button
                              key={round.roundNumber}
                              onClick={() => setTourActiveRoundTab(round.roundNumber)}
                              style={{
                                padding: '6px 12px',
                                borderRadius: '4px',
                                backgroundColor: tourActiveRoundTab === round.roundNumber ? '#00f2fe' : 'rgba(255,255,255,0.03)',
                                color: tourActiveRoundTab === round.roundNumber ? '#05060f' : '#8a93c0',
                                border: 'none',
                                fontSize: '0.75rem',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {round.name}
                            </button>
                          ))}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1, minHeight: 0, paddingRight: '4px' }}>
                          {selectedTournament.bracket?.find((r: any) => r.roundNumber === tourActiveRoundTab)?.matchups.map((matchup: any) => {
                            const isUserP1 = matchup.p1 === user?.id;
                            const isUserP2 = matchup.p2 === user?.id;
                            const isUserInMatch = isUserP1 || isUserP2;

                            return (
                              <div
                                key={matchup.id}
                                style={{
                                  padding: '10px 14px',
                                  backgroundColor: isUserInMatch ? 'rgba(0, 242, 254, 0.04)' : 'rgba(255, 255, 255, 0.02)',
                                  border: `1px solid ${isUserInMatch ? '#00f2fe' : 'rgba(255, 255, 255, 0.05)'}`,
                                  borderRadius: '8px',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '6px'
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
                                    <span style={{
                                      fontWeight: 'bold',
                                      color: matchup.winner === matchup.p1 && matchup.winner ? '#00ff87' : '#ffffff',
                                      textDecoration: matchup.winner && matchup.winner !== matchup.p1 ? 'line-through' : 'none'
                                    }}>
                                      {matchup.p1Username || 'TBD'} {isUserP1 && `(${isRtl ? 'أنت' : 'You'})`}
                                    </span>
                                    <span style={{
                                      fontWeight: 'bold',
                                      color: matchup.winner === matchup.p2 && matchup.winner ? '#00ff87' : '#ffffff',
                                      textDecoration: matchup.winner && matchup.winner !== matchup.p2 ? 'line-through' : 'none'
                                    }}>
                                      {matchup.p2Username || 'TBD'} {isUserP2 && `(${isRtl ? 'أنت' : 'You'})`}
                                    </span>
                                  </div>

                                  <span style={{
                                    fontSize: '0.65rem',
                                    backgroundColor: matchup.status === 'COMPLETED' ? 'rgba(0, 255, 135, 0.1)' : matchup.status === 'PLAYING' ? 'rgba(0, 242, 254, 0.1)' : 'rgba(255,255,255,0.05)',
                                    color: matchup.status === 'COMPLETED' ? '#00ff87' : matchup.status === 'PLAYING' ? '#00f2fe' : '#8a93c0',
                                    padding: '1px 5px',
                                    borderRadius: '3px',
                                    fontWeight: 'bold'
                                  }}>
                                    {matchup.status}
                                  </span>
                                </div>

                                {matchup.status === 'PLAYING' && (
                                  <div style={{ display: 'flex', marginTop: '4px' }}>
                                    {isUserInMatch ? (
                                      <button
                                        onClick={() => joinTournamentRoom(matchup.matchId)}
                                        style={{
                                          width: '100%',
                                          padding: '8px',
                                          backgroundColor: '#00f2fe',
                                          color: '#05060f',
                                          border: 'none',
                                          borderRadius: '4px',
                                          fontSize: '0.75rem',
                                          fontWeight: 'bold',
                                          cursor: 'pointer'
                                        }}
                                      >
                                        ⚔️ {isRtl ? 'العب مباراتك الآن' : 'PLAY MATCH NOW'}
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => joinTournamentRoom(matchup.matchId, true)}
                                        style={{
                                          width: '100%',
                                          padding: '8px',
                                          backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                          color: '#ffffff',
                                          border: '1px solid rgba(255, 255, 255, 0.1)',
                                          borderRadius: '4px',
                                          fontSize: '0.75rem',
                                          cursor: 'pointer'
                                        }}
                                      >
                                        👁️ {isRtl ? 'شاهد المباراة' : 'Spectate'}
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1, minHeight: 0, paddingRight: '4px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', color: '#ffffff' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: '#8a93c0', textAlign: 'left' }}>
                              <th style={{ padding: '6px' }}>{isRtl ? 'اللاعب' : 'Player'}</th>
                              <th style={{ padding: '6px', textAlign: 'center' }}>{isRtl ? 'فوز' : 'Wins'}</th>
                              <th style={{ padding: '6px', textAlign: 'center' }}>{isRtl ? 'خسارة' : 'Losses'}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedTournament.participants?.sort((a: any, b: any) => b.wins - a.wins).map((p: any) => (
                              <tr key={p.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.02)' }}>
                                <td style={{ padding: '8px 6px', fontWeight: 'bold' }}>{p.username}</td>
                                <td style={{ padding: '8px 6px', textAlign: 'center', color: '#00ff87', fontWeight: 'bold' }}>{p.wins}</td>
                                <td style={{ padding: '8px 6px', textAlign: 'center', color: '#ff3b5c' }}>{p.losses}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={styles.bottomNavMock}>
            <span style={{ cursor: 'pointer' }} onClick={() => { setSelectedTournament(null); setViewingTournaments(false); }}>🎒</span>
            <span>🛒</span>
            <span>⚔️</span>
            <span style={{ cursor: 'pointer', ...styles.activeNavTab }}>🏰</span>
            <span style={{ cursor: 'pointer' }} onClick={() => { setSelectedTournament(null); setViewingLeaderboard(true); loadLeaderboardData(); }}>🏆</span>
          </div>
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexShrink: 0 }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ffffff', margin: 0 }}>
              🏆 {isRtl ? 'ساحة البطولات' : 'Tournament Arena'}
            </h2>
            <button
              onClick={() => { playSFX('click'); setCreatingTournament(true); }}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                background: 'linear-gradient(135deg, #ffd700 0%, #c9a227 100%)',
                color: '#05060f',
                fontWeight: 'bold',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.75rem',
                boxShadow: '0 2px 8px rgba(255, 215, 0, 0.2)'
              }}
            >
              ➕ {isRtl ? 'إنشاء بطولة' : 'Host'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', flex: 1, minHeight: 0, paddingRight: '4px' }}>
            {loadingTournaments ? (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '40px' }}>
                <div style={{ width: '30px', height: '30px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.05)', borderTopColor: '#00f2fe', animation: 'spin 1s linear infinite' }}></div>
              </div>
            ) : tournaments.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: '#8a93c0', fontStyle: 'italic', fontSize: '0.85rem' }}>
                {isRtl ? 'لا توجد بطولات نشطة حالياً. أنشئ واحدة أولاً!' : 'No tournaments currently active. Host one now!'}
              </div>
            ) : (
              tournaments.map((t) => (
                <div
                  key={t.id}
                  onClick={() => { playSFX('click'); fetchTournamentDetails(t.id); }}
                  style={{
                    padding: '12px 14px',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    borderLeft: `3px solid ${t.status === 'REGISTRATION' ? '#00ff87' : t.status === 'IN_PROGRESS' ? '#00f2fe' : '#8a93c0'}`,
                    borderRadius: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    transition: 'all 0.2s ease'
                  }}
                  className="accordion-trigger"
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 }}>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#ffffff', margin: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {t.name}
                    </h3>
                    <span style={{ fontSize: '0.7rem', color: '#8a93c0' }}>
                      {t.format} • {t.bracket_size} {isRtl ? 'فرق' : 'teams'} ({t.participantsCount || 0} {isRtl ? 'مسجل' : 'joined'})
                    </span>
                    <span style={{ fontSize: '0.65rem', color: '#ffd700', fontWeight: 'bold' }}>
                      🏆 {t.prize_pool?.first_place_tokens || 10} Creator Tokens
                    </span>
                  </div>

                  <span style={{
                    fontSize: '0.65rem',
                    backgroundColor: t.status === 'REGISTRATION' ? 'rgba(0, 255, 135, 0.1)' : t.status === 'IN_PROGRESS' ? 'rgba(0, 242, 254, 0.1)' : 'rgba(255,255,255,0.05)',
                    color: t.status === 'REGISTRATION' ? '#00ff87' : t.status === 'IN_PROGRESS' ? '#00f2fe' : '#8a93c0',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontWeight: 'bold',
                    flexShrink: 0
                  }}>
                    {t.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div style={styles.bottomNavMock}>
          <span style={{ cursor: 'pointer' }} onClick={() => { setViewingTournaments(false); setViewingPacks(false); }}>🎒</span>
          <span style={{ cursor: 'pointer' }} onClick={() => { setViewingTournaments(false); setViewingPacks(true); fetchPacks(); }}>📦</span>
          <span>⚔️</span>
          <span style={{ cursor: 'pointer', ...styles.activeNavTab }}>🏰</span>
          <span style={{ cursor: 'pointer' }} onClick={() => { setViewingTournaments(false); setViewingLeaderboard(true); loadLeaderboardData(); }}>🏆</span>
        </div>
      </div>
    );
  };
  // ==========================================
  // Question Packs API Operations & UI
  // ==========================================
  async function fetchPacks() {
    setLoadingPacks(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${API_URL}/api/v1/packs`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setPacks(data);
      } else {
        console.error('Failed to fetch packs list');
      }
    } catch (e) {
      console.error('Error fetching packs:', e);
    } finally {
      setLoadingPacks(false);
    }
  }

  async function fetchPackDetails(id: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${API_URL}/api/v1/packs/${id}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedPack(data);
      } else {
        console.error('Failed to fetch pack details');
      }
    } catch (e) {
      console.error('Error fetching pack details:', e);
    }
  }

  const addPackQuestion = () => {
    setPackQuestions(prev => [
      ...prev,
      {
        type: 'MULTIPLE_CHOICE',
        body: '',
        options: [
          { id: 'a', text: '' },
          { id: 'b', text: '' },
          { id: 'c', text: '' },
          { id: 'd', text: '' }
        ],
        correctAnswer: 'a',
        orderingItems: [],
        matchingPairs: [],
        difficulty: 'Medium',
        explanation: ''
      }
    ]);
  };

  const removePackQuestion = (index: number) => {
    if (packQuestions.length <= 1) {
      triggerGamingAlert(isRtl ? 'يجب أن تحتوي الحزمة على سؤال واحد على الأقل.' : 'A pack must contain at least 1 question.', 'warning');
      return;
    }
    setPackQuestions(prev => prev.filter((_, idx) => idx !== index));
  };

  const updatePackQuestion = (index: number, fields: Partial<PackQuestionInput>) => {
    setPackQuestions(prev => prev.map((q, idx) => idx === index ? { ...q, ...fields } as PackQuestionInput : q));
  };

  async function handleCreatePack(e: React.FormEvent) {
    e.preventDefault();
    if (!packTitle.trim()) {
      triggerGamingAlert(isRtl ? 'الرجاء إدخال اسم حزمة الأسئلة' : 'Please enter question pack title', 'warning');
      return;
    }
    if (packQuestions.some(q => !q.body.trim())) {
      triggerGamingAlert(isRtl ? 'الرجاء ملء نصوص جميع الأسئلة' : 'Please fill in bodies for all questions', 'warning');
      return;
    }

    if (packIsPublic) {
      const balance = user?.creatorTokens || 0;
      if (balance < 5) {
        triggerGamingAlert(
          isRtl 
            ? `رصيد التوكن غير كافٍ! نشر الحزمة العامة يتطلب 5 توكن. رصيدك الحالي: ${balance}`
            : `Insufficient Creator Tokens! Public packs cost 5 Creator Tokens. Current balance: ${balance}`,
          'error'
        );
        return;
      }
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      const formattedQuestions = packQuestions.map(q => {
        const qData: any = {
          type: q.type,
          body: q.body,
          difficulty: q.difficulty,
          explanation: q.explanation,
        };

        if (q.imageUrl) qData.imageUrl = q.imageUrl;

        if (q.type === 'MULTIPLE_CHOICE') {
          qData.options = q.options.filter(o => o.text.trim() !== '');
          qData.correctAnswer = q.correctAnswer;
        } else if (q.type === 'TRUE_FALSE') {
          qData.correctAnswer = q.correctAnswer;
        } else if (q.type === 'FILL_IN_THE_BLANK') {
          qData.correctAnswer = q.correctAnswer;
        } else if (q.type === 'ORDERING_QUESTION') {
          qData.options = q.orderingItems.map((text, idx) => ({ id: String(idx + 1), text }));
          qData.orderingItems = q.orderingItems.map((_, idx) => String(idx + 1));
        } else if (q.type === 'MATCHING_QUESTION') {
          qData.matchingPairs = q.matchingPairs.filter(p => p.leftText.trim() !== '' && p.rightText.trim() !== '');
        }
        return qData;
      });

      const res = await fetch(`${API_URL}/api/v1/packs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: packTitle,
          description: packDesc,
          category: packCategory,
          isPublic: packIsPublic,
          questions: formattedQuestions
        })
      });

      if (res.ok) {
        triggerGamingAlert(
          isRtl 
            ? (packIsPublic ? 'تم نشر حزمة الأسئلة العامة بنجاح! تم خصم 5 توكن.' : 'تم حفظ الحزمة الخاصة بنجاح!')
            : (packIsPublic ? 'Public question pack published! 5 Tokens deducted.' : 'Private pack saved successfully!'),
          'success'
        );
        setCreatingPack(false);
        setPackTitle('');
        setPackDesc('');
        setPackCategory('Science');
        setPackIsPublic(false);
        setPackQuestions([
          { type: 'MULTIPLE_CHOICE', body: '', options: [{ id: 'a', text: '' }, { id: 'b', text: '' }, { id: 'c', text: '' }, { id: 'd', text: '' }], correctAnswer: 'a', orderingItems: [], matchingPairs: [], difficulty: 'Medium', explanation: '' }
        ]);
        await fetchPacks();
        await refreshProfile();
      } else {
        const err = await res.json();
        triggerGamingAlert(err.error || (isRtl ? 'فشل إنشاء الحزمة' : 'Failed to create question pack'), 'error');
      }
    } catch (err) {
      console.error('Create pack error:', err);
      triggerGamingAlert(isRtl ? 'حدث خطأ أثناء إنشاء حزمة الأسئلة' : 'Error creating question pack', 'error');
    }
  }

  async function handleDeletePack(id: string) {
    if (!confirm(isRtl ? 'هل أنت متأكد من حذف هذه الحزمة؟' : 'Are you sure you want to delete this pack?')) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${API_URL}/api/v1/packs/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (res.ok) {
        triggerGamingAlert(isRtl ? 'تم حذف الحزمة بنجاح' : 'Pack deleted successfully', 'success');
        setSelectedPack(null);
        await fetchPacks();
      } else {
        const err = await res.json();
        triggerGamingAlert(err.error || 'Failed to delete pack', 'error');
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleSubmitReview(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPack) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${API_URL}/api/v1/packs/${selectedPack.pack.id}/reviews`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          rating: packReviewRating,
          comment: packReviewComment
        })
      });
      if (res.ok) {
        triggerGamingAlert(isRtl ? 'تمت إضافة مراجعتك بنجاح!' : 'Review submitted successfully!', 'success');
        setPackReviewComment('');
        await fetchPackDetails(selectedPack.pack.id);
        await fetchPacks();
      } else {
        const err = await res.json();
        triggerGamingAlert(err.error || 'Failed to submit review', 'error');
      }
    } catch (err) {
      console.error(err);
    }
  }

  const renderPacksView = () => {
    if (creatingPack) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px', flexShrink: 0 }}>
              <button style={styles.backBtn} onClick={() => setCreatingPack(false)}>◀</button>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ffffff', margin: 0 }}>
                {isRtl ? 'إنشاء حزمة أسئلة جديدة' : 'Create Question Pack'}
              </h2>
            </div>

            <form onSubmit={handleCreatePack} style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', flex: 1, paddingRight: '4px', minHeight: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.75rem', color: '#8a93c0' }}>{isRtl ? 'عنوان الحزمة' : 'Pack Title'}</label>
                <input
                  type="text"
                  required
                  placeholder={isRtl ? 'أدخل عنوان الحزمة...' : 'Enter pack title...'}
                  value={packTitle}
                  onChange={(e) => setPackTitle(e.target.value)}
                  style={{
                    padding: '10px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#ffffff',
                    fontSize: '0.85rem'
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.75rem', color: '#8a93c0' }}>{isRtl ? 'الوصف' : 'Description'}</label>
                <textarea
                  placeholder={isRtl ? 'أدخل وصفاً للحزمة...' : 'Enter description...'}
                  value={packDesc}
                  onChange={(e) => setPackDesc(e.target.value)}
                  style={{
                    padding: '10px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#ffffff',
                    fontSize: '0.85rem',
                    minHeight: '50px',
                    resize: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.75rem', color: '#8a93c0' }}>{isRtl ? 'التصنيف' : 'Category'}</label>
                  <select
                    value={packCategory}
                    onChange={(e: any) => setPackCategory(e.target.value)}
                    style={{
                      padding: '10px',
                      borderRadius: '6px',
                      backgroundColor: '#111528',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      color: '#ffffff',
                      fontSize: '0.85rem'
                    }}
                  >
                    <option value="Science">Science</option>
                    <option value="Math">Math</option>
                    <option value="Electronics">Electronics</option>
                    <option value="Programming">Programming</option>
                    <option value="Custom">Custom</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.75rem', color: '#8a93c0' }}>{isRtl ? 'الخصوصية' : 'Privacy'}</label>
                  <select
                    value={packIsPublic ? 'true' : 'false'}
                    onChange={(e) => setPackIsPublic(e.target.value === 'true')}
                    style={{
                      padding: '10px',
                      borderRadius: '6px',
                      backgroundColor: '#111528',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      color: '#ffffff',
                      fontSize: '0.85rem'
                    }}
                  >
                    <option value="false">{isRtl ? 'خاصة (مجانًا)' : 'Private (Free)'}</option>
                    <option value="true">{isRtl ? 'عامة (5 توكن)' : 'Public (5 Tokens)'}</option>
                  </select>
                </div>
              </div>

              {packIsPublic && (
                <div style={{
                  padding: '10px',
                  backgroundColor: 'rgba(255, 179, 0, 0.06)',
                  border: '1px solid #ffb300',
                  borderRadius: '6px',
                  color: '#ffb300',
                  fontSize: '0.75rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}>
                  <span style={{ fontWeight: 'bold' }}>
                    ⚠️ {isRtl ? 'تنبيه تكلفة النشر العام:' : 'Creator Token Gating Warning:'}
                  </span>
                  <span>
                    {isRtl 
                      ? `سيتم خصم 5 توكن من رصيدك عند النشر. رصيدك الحالي: ${user?.creatorTokens || 0} توكن.`
                      : `Publishing this pack publicly will deduct 5 Creator Tokens from your profile. Current Balance: ${user?.creatorTokens || 0} Tokens.`}
                  </span>
                  {(user?.creatorTokens || 0) < 5 && (
                    <span style={{ color: '#ff3b5c', fontWeight: 'bold', marginTop: '2px' }}>
                      ❌ {isRtl ? 'ليس لديك توكن كافية!' : 'You do not have enough tokens to publish publicly!'}
                    </span>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#ffffff', margin: 0 }}>
                    {isRtl ? 'الأسئلة المضافة' : 'Questions'} ({packQuestions.length})
                  </h3>
                  <button
                    type="button"
                    onClick={addPackQuestion}
                    style={{
                      padding: '4px 10px',
                      backgroundColor: 'rgba(0, 242, 254, 0.1)',
                      border: '1px solid #00f2fe',
                      color: '#00f2fe',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      fontWeight: 'bold'
                    }}
                  >
                    ➕ {isRtl ? 'إضافة سؤال' : 'Add Question'}
                  </button>
                </div>

                {packQuestions.map((q, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '12px',
                      backgroundColor: 'rgba(255, 255, 255, 0.01)',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                      borderRadius: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#00f2fe' }}>
                        #{idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removePackQuestion(idx)}
                        style={{
                          padding: '2px 6px',
                          backgroundColor: 'rgba(255, 59, 92, 0.1)',
                          border: '1px solid #ff3b5c',
                          color: '#ff3b5c',
                          borderRadius: '4px',
                          fontSize: '0.7rem',
                          cursor: 'pointer'
                        }}
                      >
                        🗑️ {isRtl ? 'حذف' : 'Delete'}
                      </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <label style={{ fontSize: '0.7rem', color: '#8a93c0' }}>{isRtl ? 'نوع السؤال' : 'Question Type'}</label>
                        <select
                          value={q.type}
                          onChange={(e: any) => {
                            const newType = e.target.value;
                            const defaults: Partial<PackQuestionInput> = { type: newType };
                            if (newType === 'MULTIPLE_CHOICE') {
                              defaults.options = [{ id: 'a', text: '' }, { id: 'b', text: '' }, { id: 'c', text: '' }, { id: 'd', text: '' }];
                              defaults.correctAnswer = 'a';
                            } else if (newType === 'TRUE_FALSE') {
                              defaults.options = [];
                              defaults.correctAnswer = 'true';
                            } else if (newType === 'FILL_IN_THE_BLANK') {
                              defaults.options = [];
                              defaults.correctAnswer = '';
                            } else if (newType === 'ORDERING_QUESTION') {
                              defaults.orderingItems = ['', '', '', ''];
                              defaults.correctAnswer = '';
                            } else if (newType === 'MATCHING_QUESTION') {
                              defaults.matchingPairs = [
                                { leftId: 'l1', leftText: '', rightId: 'r1', rightText: '' },
                                { leftId: 'l2', leftText: '', rightId: 'r2', rightText: '' },
                                { leftId: 'l3', leftText: '', rightId: 'r3', rightText: '' }
                              ];
                              defaults.correctAnswer = '';
                            }
                            updatePackQuestion(idx, defaults);
                          }}
                          style={{
                            padding: '6px',
                            borderRadius: '4px',
                            backgroundColor: '#0b0d1a',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            color: '#ffffff',
                            fontSize: '0.75rem'
                          }}
                        >
                          <option value="MULTIPLE_CHOICE">Multiple Choice</option>
                          <option value="TRUE_FALSE">True/False</option>
                          <option value="FILL_IN_THE_BLANK">Fill in the Blank</option>
                          <option value="ORDERING_QUESTION">Ordering</option>
                          <option value="MATCHING_QUESTION">Matching</option>
                        </select>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <label style={{ fontSize: '0.7rem', color: '#8a93c0' }}>{isRtl ? 'الصعوبة' : 'Difficulty'}</label>
                        <select
                          value={q.difficulty}
                          onChange={(e: any) => updatePackQuestion(idx, { difficulty: e.target.value })}
                          style={{
                            padding: '6px',
                            borderRadius: '4px',
                            backgroundColor: '#0b0d1a',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            color: '#ffffff',
                            fontSize: '0.75rem'
                          }}
                        >
                          <option value="Easy">Easy</option>
                          <option value="Medium">Medium</option>
                          <option value="Hard">Hard</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <label style={{ fontSize: '0.7rem', color: '#8a93c0' }}>{isRtl ? 'نص السؤال' : 'Question Text'}</label>
                      <textarea
                        required
                        placeholder={isRtl ? 'أدخل نص السؤال...' : 'Enter question text...'}
                        value={q.body}
                        onChange={(e) => updatePackQuestion(idx, { body: e.target.value })}
                        style={{
                          padding: '8px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(255,255,255,0.02)',
                          border: '1px solid rgba(255,255,255,0.08)',
                          color: '#ffffff',
                          fontSize: '0.8rem',
                          minHeight: '40px',
                          resize: 'none'
                        }}
                      />
                    </div>

                    {q.type === 'MULTIPLE_CHOICE' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '0.7rem', color: '#8a93c0' }}>{isRtl ? 'الخيارات المتاحة والإجابة الصحيحة' : 'Options & Correct Answer'}</label>
                        {q.options.map((opt, oIdx) => (
                          <div key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '0.75rem', width: '15px', color: '#8a93c0' }}>{opt.id.toUpperCase()}</span>
                            <input
                              type="text"
                              required
                              placeholder={`Option ${opt.id.toUpperCase()}`}
                              value={opt.text}
                              onChange={(e) => {
                                const newOpts = [...q.options];
                                newOpts[oIdx] = { ...opt, text: e.target.value };
                                updatePackQuestion(idx, { options: newOpts });
                              }}
                              style={{
                                flex: 1,
                                padding: '6px',
                                borderRadius: '4px',
                                backgroundColor: 'rgba(255,255,255,0.01)',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                                color: '#ffffff',
                                fontSize: '0.75rem'
                              }}
                            />
                            <input
                              type="radio"
                              name={`correct-${idx}`}
                              checked={q.correctAnswer === opt.id}
                              onChange={() => updatePackQuestion(idx, { correctAnswer: opt.id })}
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {q.type === 'TRUE_FALSE' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <label style={{ fontSize: '0.7rem', color: '#8a93c0' }}>{isRtl ? 'الإجابة الصحيحة' : 'Correct Answer'}</label>
                        <select
                          value={q.correctAnswer}
                          onChange={(e) => updatePackQuestion(idx, { correctAnswer: e.target.value })}
                          style={{
                            padding: '6px',
                            borderRadius: '4px',
                            backgroundColor: '#0b0d1a',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            color: '#ffffff',
                            fontSize: '0.75rem'
                          }}
                        >
                          <option value="true">{isRtl ? 'صح' : 'True'}</option>
                          <option value="false">{isRtl ? 'خطأ' : 'False'}</option>
                        </select>
                      </div>
                    )}

                    {q.type === 'FILL_IN_THE_BLANK' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <label style={{ fontSize: '0.7rem', color: '#8a93c0' }}>{isRtl ? 'الإجابة الصحيحة' : 'Correct Answer'}</label>
                        <input
                          type="text"
                          required
                          placeholder={isRtl ? 'أدخل الإجابة الصحيحة الدقيقة...' : 'Enter the exact correct answer...'}
                          value={q.correctAnswer}
                          onChange={(e) => updatePackQuestion(idx, { correctAnswer: e.target.value })}
                          style={{
                            padding: '6px',
                            borderRadius: '4px',
                            backgroundColor: 'rgba(255,255,255,0.01)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            color: '#ffffff',
                            fontSize: '0.75rem'
                          }}
                        />
                      </div>
                    )}

                    {q.type === 'ORDERING_QUESTION' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '0.7rem', color: '#8a93c0' }}>{isRtl ? 'رتب العناصر بالترتيب الصحيح (من الأعلى للأسفل)' : 'Enter items in correct order (Top to Bottom)'}</label>
                        {[0, 1, 2, 3].map((orderIdx) => (
                          <div key={orderIdx} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '0.75rem', width: '15px', color: '#8a93c0' }}>{orderIdx + 1}</span>
                            <input
                              type="text"
                              required
                              placeholder={`Item ${orderIdx + 1}`}
                              value={q.orderingItems[orderIdx] || ''}
                              onChange={(e) => {
                                const newItems = [...q.orderingItems];
                                newItems[orderIdx] = e.target.value;
                                updatePackQuestion(idx, { orderingItems: newItems });
                              }}
                              style={{
                                flex: 1,
                                padding: '6px',
                                borderRadius: '4px',
                                backgroundColor: 'rgba(255,255,255,0.01)',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                                color: '#ffffff',
                                fontSize: '0.75rem'
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {q.type === 'MATCHING_QUESTION' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '0.7rem', color: '#8a93c0' }}>{isRtl ? 'أدخل أزواج التوصيل المتطابقة' : 'Enter matching pairs'}</label>
                        {[0, 1, 2].map((pairIdx) => {
                          const pair = q.matchingPairs[pairIdx] || { leftId: `l${pairIdx+1}`, leftText: '', rightId: `r${pairIdx+1}`, rightText: '' };
                          return (
                            <div key={pairIdx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                              <input
                                type="text"
                                required
                                placeholder={`Left Term ${pairIdx + 1}`}
                                value={pair.leftText}
                                onChange={(e) => {
                                  const newPairs = [...q.matchingPairs];
                                  newPairs[pairIdx] = { ...pair, leftText: e.target.value };
                                  updatePackQuestion(idx, { matchingPairs: newPairs });
                                }}
                                style={{
                                  padding: '6px',
                                  borderRadius: '4px',
                                  backgroundColor: 'rgba(255,255,255,0.01)',
                                  border: '1px solid rgba(255, 255, 255, 0.08)',
                                  color: '#ffffff',
                                  fontSize: '0.75rem'
                                }}
                              />
                              <input
                                type="text"
                                required
                                placeholder={`Matching Definition ${pairIdx + 1}`}
                                value={pair.rightText}
                                onChange={(e) => {
                                  const newPairs = [...q.matchingPairs];
                                  newPairs[pairIdx] = { ...pair, rightText: e.target.value };
                                  updatePackQuestion(idx, { matchingPairs: newPairs });
                                }}
                                style={{
                                  padding: '6px',
                                  borderRadius: '4px',
                                  backgroundColor: 'rgba(255,255,255,0.01)',
                                  border: '1px solid rgba(255, 255, 255, 0.08)',
                                  color: '#ffffff',
                                  fontSize: '0.75rem'
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <label style={{ fontSize: '0.7rem', color: '#8a93c0' }}>{isRtl ? 'شرح الحل' : 'Explanation'}</label>
                      <textarea
                        placeholder={isRtl ? 'أدخل شرحاً للحل الصحيح...' : 'Enter solution explanation...'}
                        value={q.explanation}
                        onChange={(e) => updatePackQuestion(idx, { explanation: e.target.value })}
                        style={{
                          padding: '6px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(255,255,255,0.02)',
                          border: '1px solid rgba(255,255,255,0.08)',
                          color: '#ffffff',
                          fontSize: '0.75rem',
                          minHeight: '35px',
                          resize: 'none'
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="submit"
                disabled={packIsPublic && (user?.creatorTokens || 0) < 5}
                style={{
                  marginTop: '10px',
                  padding: '12px',
                  borderRadius: '6px',
                  background: packIsPublic && (user?.creatorTokens || 0) < 5
                    ? 'rgba(255,255,255,0.08)'
                    : 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
                  color: packIsPublic && (user?.creatorTokens || 0) < 5 ? '#8a93c0' : '#05060f',
                  fontWeight: 'bold',
                  border: 'none',
                  cursor: packIsPublic && (user?.creatorTokens || 0) < 5 ? 'not-allowed' : 'pointer',
                  boxShadow: packIsPublic && (user?.creatorTokens || 0) < 5 ? 'none' : '0 4px 15px rgba(0, 242, 254, 0.3)'
                }}
              >
                {isRtl ? 'تأكيد إنشاء الحزمة' : 'Confirm Pack Creation'}
              </button>
            </form>
          </div>

          <div style={styles.bottomNavMock}>
            <span style={{ cursor: 'pointer' }} onClick={() => { setCreatingPack(false); setViewingPacks(false); }}>🎒</span>
            <span style={{ cursor: 'pointer', ...styles.activeNavTab }}>📦</span>
            <span>⚔️</span>
            <span style={{ cursor: 'pointer' }} onClick={() => { setCreatingPack(false); setViewingTournaments(true); fetchTournaments(); }}>🏰</span>
            <span style={{ cursor: 'pointer' }} onClick={() => { setCreatingPack(false); setViewingLeaderboard(true); loadLeaderboardData(); }}>🏆</span>
          </div>
        </div>
      );
    }

    if (selectedPack) {
      const { pack, questions, reviews } = selectedPack;
      const isCreator = pack.creatorId === user?.id;
      const hasReviewed = reviews?.some((r: any) => r.userId === user?.id);

      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexShrink: 0 }}>
              <button style={styles.backBtn} onClick={() => { playSFX('click'); setSelectedPack(null); fetchPacks(); }}>◀</button>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <h2 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#ffffff', margin: 0 }}>
                  {getLocalizedText(pack.title)}
                  <span style={{ fontSize: '0.7rem', color: '#00ff87', marginLeft: '6px', marginRight: '6px', fontWeight: 'bold' }}>v{pack.version || 1}</span>
                </h2>
                <span style={{ fontSize: '0.65rem', color: '#8a93c0' }}>
                  {pack.category} • {questions?.length || 0} {isRtl ? 'أسئلة' : 'questions'} • {isRtl ? 'اللغة الافتراضية:' : 'Default Lang:'} {pack.defaultLanguage === 'ar' ? (isRtl ? 'العربية' : 'Arabic') : 'English'}
                </span>
              </div>
              <span style={{
                marginLeft: 'auto',
                fontSize: '0.65rem',
                backgroundColor: pack.isPublic ? 'rgba(0, 255, 135, 0.1)' : 'rgba(255, 59, 92, 0.1)',
                color: pack.isPublic ? '#00ff87' : '#ff3b5c',
                padding: '2px 6px',
                borderRadius: '4px',
                fontWeight: 'bold'
              }}>
                {pack.isPublic ? (isRtl ? 'عامة' : 'Public') : (isRtl ? 'خاصة' : 'Private')}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
              <div style={{ padding: '12px', backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                <p style={{ margin: '0 0 8px 0', fontSize: '0.8rem', color: '#8a93c0' }}>{getLocalizedText(pack.description) || (isRtl ? 'لا يوجد وصف.' : 'No description available.')}</p>
                
                {pack.tags && pack.tags.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                    {pack.tags.map((t: string, idx: number) => (
                      <span key={idx} style={{
                        fontSize: '0.6rem',
                        color: '#00f2fe',
                        backgroundColor: 'rgba(0, 242, 254, 0.06)',
                        border: '1px solid rgba(0, 242, 254, 0.15)',
                        padding: '1px 5px',
                        borderRadius: '3px'
                      }}>
                        #{t}
                      </span>
                    ))}
                  </div>
                )}

                {pack.metadata && typeof pack.metadata === 'object' && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '8px',
                    padding: '8px 12px',
                    backgroundColor: 'rgba(255,255,255,0.01)',
                    border: '1px solid rgba(255,255,255,0.04)',
                    borderRadius: '6px',
                    fontSize: '0.7rem',
                    color: '#8a93c0',
                    marginBottom: '8px',
                    textAlign: 'center'
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ fontWeight: 'bold', color: '#ffffff' }}>{pack.metadata.question_count || questions?.length || 0}</span>
                      <span style={{ fontSize: '0.6rem' }}>{isRtl ? 'الأسئلة' : 'Questions'}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ fontWeight: 'bold', color: '#00ff87' }}>{pack.metadata.easy || 0}</span>
                      <span style={{ fontSize: '0.6rem' }}>{isRtl ? 'سهل' : 'Easy'}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ fontWeight: 'bold', color: '#ffb300' }}>{pack.metadata.medium || 0}</span>
                      <span style={{ fontSize: '0.6rem' }}>{isRtl ? 'متوسط' : 'Medium'}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ fontWeight: 'bold', color: '#ff3b5c' }}>{pack.metadata.hard || 0}</span>
                      <span style={{ fontSize: '0.6rem' }}>{isRtl ? 'صعب' : 'Hard'}</span>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: '#ffffff' }}>
                  <span>✍️ {isRtl ? 'المنشئ:' : 'Creator:'} <strong style={{ color: '#00f2fe' }}>{pack.creatorUsername}</strong></span>
                  <span style={{ color: '#ffb300' }}>⭐ {pack.ratingAvg?.toFixed(1) || '0.0'} ({pack.ratingCount} {isRtl ? 'تقييمات' : 'reviews'})</span>
                </div>
              </div>

              {isCreator && (
                <button
                  onClick={() => handleDeletePack(pack.id)}
                  style={{
                    padding: '8px',
                    backgroundColor: 'rgba(255, 59, 92, 0.1)',
                    border: '1px solid #ff3b5c',
                    color: '#ff3b5c',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  🗑️ {isRtl ? 'حذف حزمة الأسئلة بالكامل' : 'Delete Entire Question Pack'}
                </button>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <h4 style={{ margin: '4px 0', fontSize: '0.85rem', color: '#ffffff', fontWeight: 'bold' }}>
                  {isRtl ? 'قائمة الأسئلة' : 'Questions List'}
                </h4>
                {questions?.map((q: any, qIdx: number) => (
                  <div key={q.id || qIdx} style={{ padding: '10px', backgroundColor: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                      <span style={{ color: '#00f2fe', fontWeight: 'bold' }}>Q{qIdx + 1} ({q.type})</span>
                      <span style={{ color: '#8a93c0' }}>{q.difficulty}</span>
                    </div>
                    <p style={{ margin: '4px 0', fontSize: '0.8rem', color: '#ffffff' }}>{getLocalizedText(q.body)}</p>
                    
                    {isCreator && (
                      <div style={{ marginTop: '4px', padding: '6px', backgroundColor: 'rgba(0, 255, 135, 0.04)', border: '1px solid rgba(0, 255, 135, 0.1)', borderRadius: '4px', fontSize: '0.75rem', color: '#00ff87' }}>
                        <span>🔑 {isRtl ? 'الإجابة النموذجية:' : 'Answer Key:'} </span>
                        <strong>{String(q.correctAnswer || q.correct_answer || '')}</strong>
                      </div>
                    )}
                    {q.explanation && (
                      <span style={{ fontSize: '0.7rem', color: '#8a93c0', fontStyle: 'italic' }}>
                        💡 {getLocalizedText(q.explanation)}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {pack.isPublic && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px' }}>
                  <h4 style={{ margin: '4px 0', fontSize: '0.85rem', color: '#ffffff', fontWeight: 'bold' }}>
                    {isRtl ? 'التقييمات والمراجعات' : 'Ratings & Reviews'}
                  </h4>

                  {!isCreator && !hasReviewed && (
                    <form onSubmit={handleSubmitReview} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', backgroundColor: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '8px' }}>
                      <span style={{ fontSize: '0.75rem', color: '#ffffff', fontWeight: 'bold' }}>
                        {isRtl ? 'أضف تقييمك للحزمة:' : 'Rate this question pack:'}
                      </span>
                      
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {[1, 2, 3, 4, 5].map((star) => (
                          <span
                            key={star}
                            onClick={() => setPackReviewRating(star)}
                            style={{
                              cursor: 'pointer',
                              fontSize: '1.2rem',
                              color: star <= packReviewRating ? '#ffb300' : 'rgba(255,255,255,0.1)'
                            }}
                          >
                            ★
                          </span>
                        ))}
                      </div>

                      <input
                        type="text"
                        placeholder={isRtl ? 'اكتب تعليقك هنا (اختياري)...' : 'Write a comment (optional)...'}
                        value={packReviewComment}
                        onChange={(e) => setPackReviewComment(e.target.value)}
                        style={{
                          padding: '8px',
                          borderRadius: '4px',
                          backgroundColor: '#0b0d1a',
                          border: '1px solid rgba(255,255,255,0.08)',
                          color: '#ffffff',
                          fontSize: '0.75rem'
                        }}
                      />

                      <button
                        type="submit"
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#00f2fe',
                          color: '#05060f',
                          border: 'none',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        {isRtl ? 'إرسال التقييم' : 'Submit Review'}
                      </button>
                    </form>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {reviews && reviews.length > 0 ? (
                      reviews.map((r: any) => (
                        <div key={r.id} style={{ padding: '8px 12px', backgroundColor: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                            <span style={{ color: '#00f2fe', fontWeight: 'bold' }}>{r.username}</span>
                            <span style={{ color: '#ffb300' }}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                          </div>
                          {r.comment && <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: '#ffffff' }}>{r.comment}</p>}
                        </div>
                      ))
                    ) : (
                      <span style={{ fontSize: '0.75rem', color: '#8a93c0', fontStyle: 'italic' }}>
                        {isRtl ? 'لا توجد مراجعات بعد.' : 'No reviews posted yet.'}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={styles.bottomNavMock}>
            <span style={{ cursor: 'pointer' }} onClick={() => { setSelectedPack(null); setViewingPacks(false); }}>🎒</span>
            <span style={{ cursor: 'pointer', ...styles.activeNavTab }} onClick={() => { setSelectedPack(null); fetchPacks(); }}>📦</span>
            <span>⚔️</span>
            <span style={{ cursor: 'pointer' }} onClick={() => { setSelectedPack(null); setViewingTournaments(true); fetchTournaments(); }}>🏰</span>
            <span style={{ cursor: 'pointer' }} onClick={() => { setSelectedPack(null); setViewingLeaderboard(true); loadLeaderboardData(); }}>🏆</span>
          </div>
        </div>
      );
    }

    const publicPacks = packs.filter(p => p.isPublic);
    const privatePacks = packs.filter(p => !p.isPublic);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexShrink: 0 }}>
            <div>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ffffff', margin: 0 }}>
                {isRtl ? 'حزم الأسئلة المخصصة' : 'Question Packs'}
              </h2>
              <span style={{ fontSize: '0.65rem', color: '#8a93c0' }}>
                {isRtl ? 'إنشاء ولعب وتقييم حزم الأسئلة' : 'Create, play, and rate question pools'}
              </span>
            </div>
            <button
              onClick={() => { playSFX('click'); setCreatingPack(true); }}
              style={{
                padding: '6px 12px',
                background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
                color: '#05060f',
                fontWeight: 'bold',
                border: 'none',
                borderRadius: '6px',
                fontSize: '0.75rem',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0, 242, 254, 0.2)'
              }}
            >
              ➕ {isRtl ? 'إنشاء حزمة' : 'Create Pack'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 1, overflowY: 'auto', paddingRight: '4px', minHeight: 0 }}>
            {loadingPacks ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#00f2fe', fontSize: '0.85rem' }}>
                {isRtl ? 'جاري تحميل الحزم...' : 'Loading packs...'}
              </div>
            ) : (
              <>
                <div>
                  <h4 style={{ margin: '4px 0', fontSize: '0.8rem', color: '#ffd700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    🌎 {isRtl ? 'حزم عامة للاستكشاف' : 'Explore Public Packs'}
                  </h4>
              {publicPacks.length === 0 ? (
                <div style={{ padding: '15px', textAlign: 'center', color: '#8a93c0', fontSize: '0.75rem', backgroundColor: 'rgba(255,255,255,0.01)', border: '1px dashed rgba(255,255,255,0.05)', borderRadius: '6px' }}>
                  {isRtl ? 'لا توجد حزم عامة منشورة حاليًا.' : 'No public packs available yet.'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {publicPacks.map((pack) => (
                    <div
                      key={pack.id}
                      onClick={() => fetchPackDetails(pack.id)}
                      style={{
                        padding: '12px',
                        backgroundColor: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px'
                      }}
                      className="hover-card-neon"
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.7rem', color: '#00f2fe', fontWeight: 'bold', backgroundColor: 'rgba(0, 242, 254, 0.08)', padding: '2px 6px', borderRadius: '4px' }}>
                          {pack.category}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: '#ffb300' }}>
                          ⭐ {pack.ratingAvg?.toFixed(1) || '0.0'} ({pack.ratingCount})
                        </span>
                      </div>
                      <h3 style={{ margin: '4px 0', fontSize: '0.9rem', fontWeight: 700, color: '#ffffff' }}>{getLocalizedText(pack.title)}</h3>
                      <p style={{ margin: '0', fontSize: '0.75rem', color: '#8a93c0', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{getLocalizedText(pack.description)}</p>
                      <span style={{ fontSize: '0.65rem', color: '#8a93c0', marginTop: '2px' }}>
                        ✍️ {isRtl ? 'المنشئ:' : 'Creator:'} <strong style={{ color: '#ffffff' }}>{pack.creatorUsername}</strong>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginTop: '10px' }}>
              <h4 style={{ margin: '4px 0', fontSize: '0.8rem', color: '#00ff87', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                📦 {isRtl ? 'حزمي الخاصة' : 'My Packs'}
              </h4>
              {privatePacks.length === 0 && packs.filter(p => p.creatorId === user?.id && p.isPublic).length === 0 ? (
                <div style={{ padding: '15px', textAlign: 'center', color: '#8a93c0', fontSize: '0.75rem', backgroundColor: 'rgba(255,255,255,0.01)', border: '1px dashed rgba(255,255,255,0.05)', borderRadius: '6px' }}>
                  {isRtl ? 'لم تقم بإنشاء أي حزم مخصصة بعد.' : 'You have not created any packs yet.'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {packs.filter(p => p.creatorId === user?.id).map((pack) => (
                    <div
                       key={pack.id}
                      onClick={() => fetchPackDetails(pack.id)}
                      style={{
                        padding: '12px',
                        backgroundColor: 'rgba(255, 255, 255, 0.02)',
                        border: `1px solid ${pack.isPublic ? 'rgba(0, 255, 135, 0.15)' : 'rgba(255, 59, 92, 0.15)'}`,
                        borderRadius: '8px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px'
                      }}
                      className="hover-card-neon"
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.7rem', color: '#00f2fe', fontWeight: 'bold' }}>
                          {pack.category}
                        </span>
                        <span style={{
                          fontSize: '0.65rem',
                          backgroundColor: pack.isPublic ? 'rgba(0, 255, 135, 0.1)' : 'rgba(255, 59, 92, 0.1)',
                          color: pack.isPublic ? '#00ff87' : '#ff3b5c',
                          padding: '1px 5px',
                          borderRadius: '3px',
                          fontWeight: 'bold'
                        }}>
                          {pack.isPublic ? (isRtl ? 'عامة' : 'Public') : (isRtl ? 'خاصة' : 'Private')}
                        </span>
                      </div>
                      <h3 style={{ margin: '4px 0', fontSize: '0.9rem', fontWeight: 700, color: '#ffffff' }}>{getLocalizedText(pack.title)}</h3>
                      <p style={{ margin: '0', fontSize: '0.75rem', color: '#8a93c0' }}>{getLocalizedText(pack.description)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>

        <div style={styles.bottomNavMock}>
          <span style={{ cursor: 'pointer' }} onClick={() => { setViewingPacks(false); }}>🎒</span>
          <span style={{ cursor: 'pointer', ...styles.activeNavTab }} onClick={fetchPacks}>📦</span>
          <span>⚔️</span>
          <span style={{ cursor: 'pointer' }} onClick={() => { setViewingPacks(false); setViewingTournaments(true); fetchTournaments(); }}>🏰</span>
          <span style={{ cursor: 'pointer' }} onClick={() => { setViewingPacks(false); setViewingLeaderboard(true); loadLeaderboardData(); }}>🏆</span>
        </div>
      </div>
    );
  };
  
  // Real-time listener/display trigger for Question Packs config
  useEffect(() => {
    if (screen === 'lobby' && currentRoom) {
      fetchPacks();
    }
  }, [screen, currentRoom?.id]);

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
  const isSpectator = isAudienceSpectator || selfPart?.isSpectator || false;

  if (deviceBlockedStatus === 'BLOCKED' || deviceBlockedStatus === 'SUSPENDED' || deviceBlockedStatus === 'LOADING') {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#05060f',
        color: '#ffffff',
        fontFamily: 'var(--font-ui)',
        padding: '20px',
        boxSizing: 'border-box'
      }} dir={isRtl ? 'rtl' : 'ltr'}>
        {deviceBlockedStatus === 'LOADING' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
            <div style={{
              width: '50px',
              height: '50px',
              borderRadius: '50%',
              border: '3px solid rgba(255, 255, 255, 0.05)',
              borderTopColor: '#00f2fe',
              animation: 'spin 1s linear infinite'
            }}></div>
            <span style={{ fontSize: '1.1rem', color: '#8a93c0', fontFamily: 'monospace' }}>
              {isRtl ? 'جاري التحقق من أمان الجهاز...' : 'Verifying device security...'}
            </span>
            <style>{`
              @keyframes spin {
                to { transform: rotate(360deg); }
              }
            `}</style>
          </div>
        ) : deviceBlockedStatus === 'SUSPENDED' ? (
          <div style={{
            maxWidth: '450px',
            width: '100%',
            backgroundColor: 'rgba(11, 13, 26, 0.95)',
            border: '1px solid #ff3b5c',
            borderRadius: '16px',
            padding: '30px',
            boxShadow: '0 8px 32px rgba(255, 59, 92, 0.15)',
            textAlign: 'center',
          }}>
            <h2 style={{ color: '#ff3b5c', margin: '0 0 16px 0', fontSize: '1.5rem', fontWeight: 800 }}>
              {isRtl ? 'تم تعليق الحساب' : 'Account Suspended'}
            </h2>
            <p style={{ fontSize: '1rem', color: '#ffffff', lineHeight: 1.5, margin: '0 0 24px 0' }}>
              {isRtl 
                ? `تم تعليق حسابك من قبل الإدارة. السبب: ${suspensionReason || 'مخالفة شروط الخدمة'}`
                : `Your account has been suspended by administration. Reason: ${suspensionReason || 'Violation of terms of service'}`}
            </p>
            <button 
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#ffffff',
                padding: '10px 20px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontFamily: 'var(--font-ui)',
              }}
              onClick={() => { playSFX('click'); signOut(); }}
            >
              {isRtl ? 'تسجيل الخروج' : 'Log Out'}
            </button>
          </div>
        ) : (
          <div style={{
            maxWidth: '450px',
            width: '100%',
            backgroundColor: 'rgba(11, 13, 26, 0.95)',
            border: '1px solid rgba(0, 242, 254, 0.2)',
            borderRadius: '16px',
            padding: '30px',
            boxShadow: '0 8px 32px rgba(0, 242, 254, 0.1)',
            textAlign: 'center',
          }}>
            <h2 style={{ color: '#00f2fe', margin: '0 0 16px 0', fontSize: '1.5rem', fontWeight: 800 }}>
              {isRtl ? 'تم قفل الجهاز' : 'Device Locked'}
            </h2>
            {isAppealSubmitted ? (
              <div>
                <p style={{ fontSize: '1.05rem', color: '#ffd700', margin: '0 0 24px 0', lineHeight: 1.5 }}>
                  {isRtl 
                    ? 'طلبك لنقل ملكية هذا الجهاز قيد المراجعة حالياً من قبل الإدارة.'
                    : 'Your appeal to transfer ownership of this device is currently pending review by administrators.'}
                </p>
                <button 
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#ffffff',
                    padding: '10px 20px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontFamily: 'var(--font-ui)',
                  }}
                  onClick={() => { playSFX('click'); signOut(); }}
                >
                  {isRtl ? 'تسجيل الخروج' : 'Log Out'}
                </button>
              </div>
            ) : (
              <form onSubmit={handleAppealSubmit}>
                <p style={{ fontSize: '0.95rem', color: '#8a93c0', lineHeight: 1.5, margin: '0 0 20px 0' }}>
                  {isRtl 
                    ? 'هذا الجهاز مرتبط بالفعل بحساب مستخدم آخر. لربطه بحسابك الحالي، يرجى تقديم طلب نقل الملكية.'
                    : 'This device is already associated with another user account. To bind it to your current account, please submit a transfer appeal.'}
                </p>
                <textarea
                  style={{
                    width: '100%',
                    height: '100px',
                    backgroundColor: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    color: '#ffffff',
                    padding: '12px',
                    fontSize: '0.9rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                    resize: 'none',
                    marginBottom: '16px',
                    fontFamily: 'var(--font-ui)',
                  }}
                  placeholder={isRtl ? 'اشرح سبب رغبتك في نقل ملكية هذا الجهاز...' : 'Explain why you want to transfer ownership of this device...'}
                  value={appealReason}
                  onChange={(e) => setAppealReason(e.target.value)}
                  required
                />
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button 
                    type="button"
                    style={{
                      flex: 1,
                      backgroundColor: 'transparent',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#8a93c0',
                      padding: '10px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-ui)',
                    }}
                    onClick={() => { playSFX('click'); signOut(); }}
                  >
                    {isRtl ? 'تسجيل الخروج' : 'Log Out'}
                  </button>
                  <button 
                    type="submit"
                    style={{
                      flex: 1,
                      backgroundColor: 'rgba(0, 242, 254, 0.12)',
                      border: '1px solid #00f2fe',
                      color: '#ffffff',
                      padding: '10px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      fontFamily: 'var(--font-ui)',
                    }}
                  >
                    {isRtl ? 'تقديم الطلب' : 'Submit Appeal'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    );
  }

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
                      {leaderboardCategory === 'Global' ? (isRtl ? 'لوحة الصدارة العالمية' : 'Global Leaderboard')
                       : leaderboardCategory === 'Science' ? (isRtl ? 'لوحة صدارة العلوم' : 'Science Leaderboard')
                       : leaderboardCategory === 'History' ? (isRtl ? 'لوحة صدارة التاريخ' : 'History Leaderboard')
                       : (isRtl ? 'لوحة صدارة البقاء' : 'Survival Leaderboard')}
                    </h2>
                  </div>

                  {/* Category Leaderboard Tabs */}
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
                    {['Global', 'Science', 'History', 'Survival'].map((cat) => {
                      const isActive = leaderboardCategory === cat;
                      const getLabel = () => {
                        if (cat === 'Global') return isRtl ? 'العالمية' : 'Global';
                        if (cat === 'Science') return isRtl ? 'العلوم' : 'Science';
                        if (cat === 'History') return isRtl ? 'التاريخ' : 'History';
                        if (cat === 'Survival') return isRtl ? 'البقاء' : 'Survival';
                        return cat;
                      };
                      return (
                        <button
                          key={cat}
                          onClick={() => { playSFX('click'); loadLeaderboardData(cat); }}
                          style={{
                            flex: 1,
                            padding: '6px 10px',
                            borderRadius: '20px',
                            border: isActive ? '1px solid #00f2fe' : '1px solid rgba(255, 255, 255, 0.05)',
                            background: isActive ? 'rgba(0, 242, 254, 0.12)' : 'rgba(255,255,255,0.02)',
                            color: isActive ? '#00f2fe' : '#8a93c0',
                            fontSize: '0.75rem',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            whiteSpace: 'nowrap'
                          }}
                          id={`leaderboard-tab-${cat.toLowerCase()}`}
                        >
                          {getLabel()}
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', maxHeight: '360px', paddingRight: '4px' }}>
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <RankBadge rank={player.rank} size={28} animate={false} />
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#ffffff' }}>
                                  {player.username} {isSelf && `(${isRtl ? 'أنت' : 'You'})`}
                                </span>
                                <span style={{ fontSize: '0.7rem', color: '#8a93c0' }}>
                                  {player.rank}
                                </span>
                              </div>
                            </div>
                          </div>
                          
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                            <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#00f2fe' }} className="text-glow-accent">
                              {leaderboardCategory === 'Global' ? (
                                `${player.rank_points || player.rankPoints || 0} RP`
                              ) : leaderboardCategory === 'Science' ? (
                                `${player.stats?.correct_Science ?? 0} 🧪`
                              ) : leaderboardCategory === 'History' ? (
                                `${player.stats?.correct_History ?? 0} 📜`
                              ) : leaderboardCategory === 'Survival' ? (
                                `${isRtl ? 'المستوى' : 'Lvl'} ${player.stats?.bestSurvivalLevel ?? 0} ⛺`
                              ) : (
                                `${player.sort_value || 0}`
                              )}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={styles.bottomNavMock}>
                  <span style={{ cursor: 'pointer' }} onClick={() => { setViewingLeaderboard(false); setViewingTournaments(false); setViewingPacks(false); }}>🎒</span>
                  <span style={{ cursor: 'pointer' }} onClick={() => { setViewingLeaderboard(false); setViewingTournaments(false); setViewingPacks(true); fetchPacks(); }}>📦</span>
                  <span>⚔️</span>
                  <span style={{ cursor: 'pointer' }} onClick={() => { setViewingLeaderboard(false); setViewingTournaments(true); setViewingPacks(false); fetchTournaments(); }}>🏰</span>
                  <span style={{ cursor: 'pointer', ...styles.activeNavTab }} onClick={() => { playSFX('click'); loadLeaderboardData('Global'); }}>🏆</span>
                </div>
              </div>
            ) : viewingTournaments ? (
              renderTournamentsView()
            ) : viewingPacks ? (
              renderPacksView()
            ) : (() => {
              const todayDateStr = new Date().toISOString().split('T')[0];
              const isDailyCompleted = (user.stats as any)?.lastDailyChallengeCompleted === todayDateStr;

              return (
                <>
                  <div style={styles.topProfileBar}>
                    <div style={styles.avatarGroup}>
                      <div 
                        style={{
                          ...styles.avatarRing,
                          ...getEquippedBorderStyle(user.equipped?.border, user.rank),
                          cursor: 'pointer'
                        }}
                        onClick={() => { playSFX('click'); setIsProfileModalOpen(true); }}
                      >
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
                      <button 
                        style={styles.shopBtn} 
                        onClick={() => { playSFX('click'); setIsShopOpen(true); }}
                        id="btn-open-shop"
                        title={isRtl ? 'متجر المظاهر' : 'Cosmetics Shop'}
                      >
                        🛒
                      </button>
                      <button 
                        style={styles.shopBtn} 
                        onClick={() => { playSFX('click'); setShowOnboarding(true); }}
                        title={isRtl ? 'دليل اللعب والتعليمات' : 'Gameplay Guide & Tutorial'}
                      >
                        ❓
                      </button>
                      {user.isAdmin && (
                        <button 
                          style={styles.shopBtn} 
                          onClick={() => { playSFX('click'); setIsAdminModalOpen(true); }}
                          title={isRtl ? 'لوحة تحكم الإدارة' : 'Admin Moderation Dashboard'}
                        >
                          🛡️
                        </button>
                      )}
                      <button 
                        style={styles.shopBtn} 
                        onClick={() => { playSFX('click'); setIsSettingsOpen(true); }}
                        title={isRtl ? 'الإعدادات' : 'Settings'}
                      >
                        ⚙️
                      </button>
                      <button style={styles.langBtn} onClick={() => { playSFX('click'); setIsRtl(!isRtl); }}>
                        {isRtl ? 'EN' : 'عربي'}
                      </button>
                      <button style={styles.logoutBtn} onClick={() => { playSFX('click'); signOut(); }}>
                        🚪
                      </button>
                    </div>
                  </div>

                  <div 
                    style={{ ...styles.rankBadgeCard, cursor: 'pointer' }}
                    onClick={() => { playSFX('click'); setIsProfileModalOpen(true); }}
                  >
                    <RankBadge rank={user.rank} size={80} animate={true} style={{ marginBottom: '8px' }} />
                    <div style={{ ...styles.rankGlowText, color: `var(--color-${user.rank.toLowerCase().replace(' ', '')})` }} className="text-glow">
                      {user.rank}
                    </div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#ffffff', marginTop: '4px' }}>
                      {user.rankPoints} RP
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
                    {activeSeason && (
                      <div style={{
                        fontSize: '0.9rem',
                        fontFamily: 'var(--font-ui)',
                        color: 'var(--cyan-glow)',
                        marginTop: '8px',
                        textTransform: 'uppercase',
                        letterSpacing: '2px',
                        fontWeight: 'bold',
                        textShadow: '0 0 10px rgba(0, 245, 255, 0.4)'
                      }}>
                        ⚡ {activeSeason.name}
                      </div>
                    )}
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

                    {user && (
                      <SeasonTrackerPanel
                        user={user}
                        isRtl={isRtl}
                        refreshProfile={refreshProfile}
                        triggerAlert={triggerGamingAlert}
                        playSFX={playSFX}
                      />
                    )}

                    {user && (
                      <QuestsPanel
                        user={user}
                        isRtl={isRtl}
                        refreshProfile={refreshProfile}
                        triggerAlert={triggerGamingAlert}
                        playSFX={playSFX}
                      />
                    )}
                  </div>

                  <div style={styles.bottomNavMock}>
                    <span 
                      style={{ cursor: 'pointer', ...((!viewingLeaderboard && !viewingTournaments && !viewingPacks) ? styles.activeNavTab : {}) }} 
                      onClick={() => { playSFX('click'); setViewingLeaderboard(false); setViewingTournaments(false); setViewingPacks(false); }}
                    >
                      🎒
                    </span>
                    <span 
                      style={{ cursor: 'pointer', ...(viewingPacks ? styles.activeNavTab : {}) }} 
                      onClick={() => { playSFX('click'); setViewingLeaderboard(false); setViewingTournaments(false); setViewingPacks(true); fetchPacks(); }}
                    >
                      📦
                    </span>
                    <span>⚔️</span>
                    <span 
                      style={{ cursor: 'pointer', ...((!viewingLeaderboard && viewingTournaments) ? styles.activeNavTab : {}) }} 
                      onClick={() => { playSFX('click'); setViewingLeaderboard(false); setViewingTournaments(true); setViewingPacks(false); fetchTournaments(); }}
                    >
                      🏰
                    </span>
                    <span 
                      style={{ cursor: 'pointer', ...(viewingLeaderboard ? styles.activeNavTab : {}) }} 
                      onClick={() => { playSFX('click'); setViewingLeaderboard(true); setViewingTournaments(false); setViewingPacks(false); loadLeaderboardData(); }}
                    >
                      🏆
                    </span>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* SCREEN: LOBBY SCREEN */}
        {screen === 'lobby' && currentRoom && (() => {
          const selfPart = participants.find(p => p.userId === user?.id);
          const isSpectator = isAudienceSpectator || selfPart?.isSpectator || false;
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

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.65rem', color: '#8a93c0', fontWeight: 700 }}>
                      {isRtl ? 'حكم المباراة' : 'MATCH JUDGE'}
                    </label>
                    <select
                      value={currentRoom.config?.judgeId || ''}
                      onChange={(e) => updateRoomConfig({ judgeId: e.target.value || null })}
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
                      <option value="">{isRtl ? 'تلقائي (بدون حكم)' : 'Automatic (No Judge)'}</option>
                      {participants
                        .filter(p => !p.isSpectator && p.userId !== user?.id)
                        .map(p => (
                          <option key={p.userId} value={p.userId}>{p.username}</option>
                        ))
                      }
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', gridColumn: 'span 2' }}>
                    <label style={{ fontSize: '0.65rem', color: '#8a93c0', fontWeight: 700 }}>
                      {isRtl ? 'حزم الأسئلة النشطة' : 'ACTIVE QUESTION PACKS'}
                    </label>
                    <div style={{
                      maxHeight: '120px',
                      overflowY: 'auto',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '6px',
                      padding: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      backgroundColor: '#0b0d1a'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: '#ffffff' }}>
                        <input
                          type="checkbox"
                          checked={!currentRoom.config?.questionPackIds || currentRoom.config.questionPackIds.length === 0}
                          onChange={(e) => {
                            if (e.target.checked) {
                              updateRoomConfig({ questionPackIds: [] });
                            }
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                        <span>{isRtl ? 'بنك الأسئلة الافتراضي' : 'Default Question Pool'}</span>
                      </div>
                      {packs.map((p) => {
                        const activeIds = currentRoom.config?.questionPackIds || [];
                        const isChecked = activeIds.includes(p.id);
                        return (
                          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: '#ffffff' }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const nextIds = e.target.checked
                                  ? [...activeIds, p.id]
                                  : activeIds.filter((id: string) => id !== p.id);
                                updateRoomConfig({ questionPackIds: nextIds });
                              }}
                              style={{ cursor: 'pointer' }}
                            />
                            <span>📦 {getLocalizedText(p.title)} ({p.category})</span>
                          </div>
                        );
                      })}
                    </div>
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
                  <div style={styles.paramItem}>
                    <span style={styles.paramLabel}>{isRtl ? 'حكم المباراة:' : 'Judge:'}</span>
                    <span style={styles.paramVal}>
                      {(() => {
                        const jId = currentRoom.config?.judgeId;
                        if (!jId) return isRtl ? 'تلقائي' : 'Automatic';
                        const jUser = participants.find(p => p.userId === jId);
                        return jUser ? jUser.username : (isRtl ? 'حكم' : 'Judge');
                      })()}
                    </span>
                  </div>
                  <div style={styles.paramItem}>
                    <span style={styles.paramLabel}>{isRtl ? 'حزم الأسئلة:' : 'Question Sources:'}</span>
                    <span style={styles.paramVal}>
                      {(() => {
                        const packIds = currentRoom.config?.questionPackIds || [];
                        if (packIds.length === 0) return isRtl ? 'الافتراضي' : 'Default Pool';
                        const names = packIds.map((id: string) => {
                          const matched = packs.find(p => p.id === id);
                          return matched ? getLocalizedText(matched.title) : null;
                        }).filter(Boolean);
                        if (names.length === 0) return isRtl ? 'حزم مخصصة' : 'Custom Packs';
                        return `📦 ${names.join(', ')}`;
                      })()}
                    </span>
                  </div>
                </div>
              )}

              {/* STREAMER AUDIENCE JOIN LINK CARD */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '12px 16px',
                backgroundColor: 'rgba(255, 215, 0, 0.02)',
                border: '1px solid rgba(255, 215, 0, 0.08)',
                borderRadius: '8px',
                margin: '12px 0'
              }}>
                <span style={{ fontSize: '0.65rem', color: '#ffd700', fontWeight: 700, letterSpacing: '0.05em' }}>
                  📢 {isRtl ? 'رابط مشاركة البث المباشر للجمهور' : 'STREAMER AUDIENCE JOIN LINK'}
                </span>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    readOnly
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    value={`${window.location.origin}/?room=${currentRoom.code}&role=audience`}
                    style={{
                      flex: 1,
                      backgroundColor: '#05060f',
                      color: '#8a93c0',
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: '4px',
                      padding: '6px 10px',
                      fontSize: '0.75rem',
                      fontFamily: 'monospace',
                      outline: 'none'
                    }}
                  />
                  <button
                    onClick={copyStreamerLink}
                    style={{
                      padding: '6px 16px',
                      borderRadius: '4px',
                      background: copiedLink ? 'rgba(0, 255, 135, 0.2)' : 'linear-gradient(135deg, #ffd700 0%, #c9a227 100%)',
                      color: copiedLink ? '#00ff87' : '#05060f',
                      border: 'none',
                      fontWeight: 'bold',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      minWidth: '80px',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {copiedLink ? (isRtl ? 'تم النسخ!' : 'Copied!') : (isRtl ? 'نسخ الرابط' : 'Copy Link')}
                  </button>
                </div>
              </div>

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
                        {participants.filter(p => !p.isSpectator && p.teamId === 'team_a' && p.userId !== currentRoom.config?.judgeId).map((player) => (
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
                        {participants.filter(p => !p.isSpectator && p.teamId === 'team_b' && p.userId !== currentRoom.config?.judgeId).map((player) => (
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
                  {participants.filter(p => !p.isSpectator && p.teamId !== 'team_a' && p.teamId !== 'team_b' && p.userId !== currentRoom.config?.judgeId).length > 0 && (
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
                      {participants.filter(p => !p.isSpectator && p.teamId !== 'team_a' && p.teamId !== 'team_b' && p.userId !== currentRoom.config?.judgeId).map(p => (
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
                  {participants.filter(p => !p.isSpectator && p.userId !== currentRoom.config?.judgeId).map((player) => (
                    <div key={player.userId} style={styles.playerCard}>
                      <div style={styles.playerMetaLeft}>
                        <div style={{ marginRight: isRtl ? '0' : '8px', marginLeft: isRtl ? '8px' : '0' }}>
                          <RankBadge rank={player.rank} size={36} animate={false} />
                        </div>
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
                  
                  {participants.filter(p => !p.isSpectator && p.userId !== currentRoom.config?.judgeId).length < 2 && (
                    <div style={styles.playerCardDashed}>
                      <span style={styles.dashText}>{t.waitingPlayers}</span>
                    </div>
                  )}
                </div>
              )}

              {/* JUDGE ROW */}
              {currentRoom.config?.judgeId && (
                <div style={{
                  padding: '10px 14px',
                  backgroundColor: 'rgba(255, 215, 0, 0.02)',
                  border: '1px solid rgba(255, 215, 0, 0.08)',
                  borderRadius: '8px',
                  margin: '10px 0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.0rem' }}>⚖️</span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#ffcc00' }}>
                      {isRtl ? 'حكم المباراة:' : 'Match Judge:'}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: '#ffffff' }}>
                      {participants.find(p => p.userId === currentRoom.config?.judgeId)?.username || (isRtl ? 'جاري التعيين...' : 'Assigning...')}
                    </span>
                  </div>
                  <span style={{
                    fontSize: '0.65rem',
                    color: '#ffcc00',
                    border: '1px solid #ffcc00',
                    borderRadius: '4px',
                    padding: '2px 6px',
                    fontWeight: 700,
                    textTransform: 'uppercase'
                  }}>
                    {isRtl ? 'حكم' : 'JUDGE'}
                  </span>
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
          
          const isInputDisabled = isAudienceSpectator 
            ? spectatorAnswerSubmitted 
            : (answerSubmitted || isSpectator || 
               (isBuzzed && !isMyTeamBuzzed) || 
               (isBuzzed && buzzedUser !== user?.username && bt !== 'TEAM_CONSULTATION'));
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

          const isJudge = currentRoom?.config?.judgeId === user?.id;

          if (isJudge) {
            return (
              <div style={styles.screenContainer}>
                {/* HUD Bar */}
                <div style={styles.hudBar}>
                  <div style={styles.hudTeamPanel}>
                    <span style={styles.hudTeamName}>{leftTeamName}</span>
                    <span style={styles.hudTeamScore}>{leftTeamScore} pts</span>
                  </div>

                  <div style={styles.hudTimerPanel}>
                    <div style={{
                      ...styles.timerCircularRing,
                      borderColor: timeLeft <= 5 ? '#ff3b5c' : '#ffcc00',
                      color: '#ffcc00',
                      boxShadow: '0 0 10px rgba(255, 204, 0, 0.2)'
                    }}>
                      {timeLeft}
                    </div>
                    <span style={styles.hudRoundCounter}>{t.round} {currentQIndex + 1}/{gameQuestions.length}</span>
                  </div>

                  <div style={{ ...styles.hudTeamPanel, alignItems: 'flex-end' }}>
                    <span style={styles.hudTeamName}>{rightTeamName}</span>
                    <span style={styles.hudTeamScore}>{rightTeamScore} pts</span>
                  </div>
                </div>

                {/* Question Info */}
                <div style={{
                  ...styles.questionZone,
                  border: '1px solid rgba(255, 204, 0, 0.15)',
                  boxShadow: '0 0 15px rgba(255, 204, 0, 0.03)',
                  flex: '0 0 auto'
                }}>
                  <div style={styles.qHeaderRow}>
                    <span style={{ ...styles.categoryBadge, backgroundColor: 'rgba(255, 204, 0, 0.1)', color: '#ffcc00', border: '1px solid rgba(255, 204, 0, 0.2)' }}>
                      ⚖️ {isRtl ? 'حكم' : 'JUDGE'} · {gameQuestions[currentQIndex].category}
                    </span>
                    <span style={styles.difficultyBadge}>{gameQuestions[currentQIndex].difficulty}</span>
                  </div>
                  
                  <div style={styles.qTextBody}>
                    {getLocalizedText(gameQuestions[currentQIndex].body)}
                  </div>
                  
                  {gameQuestions[currentQIndex].correctAnswer && (
                    <div style={{
                      marginTop: '10px',
                      fontSize: '0.75rem',
                      color: '#00ff87',
                      backgroundColor: 'rgba(0, 255, 135, 0.04)',
                      padding: '6px 10px',
                      borderRadius: '4px',
                      border: '1px dashed rgba(0, 255, 135, 0.2)'
                    }}>
                      💡 {isRtl ? 'الإجابة المرجعية: ' : 'Reference Answer: '} 
                      <strong>{String(gameQuestions[currentQIndex].correctAnswer)}</strong>
                    </div>
                  )}
                </div>

                {/* Submissions Section */}
                <div style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  overflowY: 'auto',
                  padding: '10px 0',
                  scrollbarWidth: 'none'
                }}>
                  <h3 style={{ fontSize: '0.8rem', color: '#ffcc00', margin: '0 0 4px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    👥 {isRtl ? 'إجابات اللاعبين' : 'Player Submissions'}
                  </h3>

                  {participants
                    .filter(p => !p.isSpectator && p.userId !== currentRoom.config?.judgeId)
                    .map((player) => {
                      const submission = submittedAnswers[player.userId];
                      const isSubmitted = !!submission;
                      
                      return (
                        <div key={player.userId} style={{
                          padding: '10px 14px',
                          backgroundColor: 'rgba(11, 13, 26, 0.6)',
                          border: `1px solid ${isSubmitted ? 'rgba(0, 245, 255, 0.15)' : 'rgba(255,255,255,0.05)'}`,
                          borderRadius: '8px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#ffffff' }}>
                              {player.username} {player.teamId === 'team_a' ? '💙 (A)' : player.teamId === 'team_b' ? '💖 (B)' : ''}
                            </span>
                            <span style={{
                              fontSize: '0.65rem',
                              color: isSubmitted ? '#00ff87' : '#ffb300',
                              backgroundColor: isSubmitted ? 'rgba(0, 255, 135, 0.05)' : 'rgba(255, 179, 0, 0.05)',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontWeight: 700
                            }}>
                              {isSubmitted ? (isRtl ? 'أرسل الإجابة' : 'SUBMITTED') : (isRtl ? 'يفكر...' : 'THINKING...')}
                            </span>
                          </div>

                          {isSubmitted ? (
                            <div style={{
                              padding: '8px',
                              backgroundColor: 'rgba(255,255,255,0.02)',
                              borderRadius: '4px',
                              fontSize: '0.8rem',
                              color: '#f0f4ff',
                              borderLeft: `2px solid ${submission.is_correct ? '#00ff87' : '#ff3b5c'}`
                            }}>
                              {isRtl ? 'الإجابة المكتوبة: ' : 'Submitted Answer: '}
                              <strong style={{ color: '#00f5ff' }}>{String(submission.answer)}</strong>
                              <span style={{ fontSize: '0.7rem', color: '#8a93c0', display: 'block', marginTop: '4px' }}>
                                ⏱ {isRtl ? 'الوقت المستغرق: ' : 'Time spent: '} {(submission.time_spent_ms / 1000).toFixed(1)}s
                              </span>
                            </div>
                          ) : (
                            <div style={{ fontSize: '0.75rem', color: '#3d4470', fontStyle: 'italic', padding: '4px 0' }}>
                              {isRtl ? 'في انتظار الإرسال...' : 'Waiting for answer submission...'}
                            </div>
                          )}

                          {/* Grading & Adjustments (Only active when player has submitted) */}
                          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                            <button
                              disabled={!isSubmitted}
                              onClick={async () => {
                                playSFX('correct');
                                if (submission && gameSyncRef.current) {
                                  await gameSyncRef.current.judgeAnswer(submission.id, true, 100);
                                }
                              }}
                              style={{
                                flex: 1,
                                padding: '6px 12px',
                                backgroundColor: (isSubmitted && submission.is_correct) ? '#00ff87' : 'rgba(0, 255, 135, 0.1)',
                                border: `1px solid ${isSubmitted ? '#00ff87' : 'rgba(0, 255, 135, 0.2)'}`,
                                borderRadius: '4px',
                                color: (isSubmitted && submission.is_correct) ? '#05060f' : '#00ff87',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                cursor: isSubmitted ? 'pointer' : 'not-allowed',
                                opacity: isSubmitted ? 1 : 0.4
                              }}
                            >
                              ✓ {isRtl ? 'موافقة (+100)' : 'Approve (+100)'}
                            </button>
                            <button
                              disabled={!isSubmitted}
                              onClick={async () => {
                                playSFX('wrong');
                                if (submission && gameSyncRef.current) {
                                  await gameSyncRef.current.judgeAnswer(submission.id, false, -30);
                                }
                              }}
                              style={{
                                flex: 1,
                                padding: '6px 12px',
                                backgroundColor: (isSubmitted && !submission.is_correct && submission.points_earned !== 0) ? '#ff3b5c' : 'rgba(255, 59, 92, 0.1)',
                                border: `1px solid ${isSubmitted ? '#ff3b5c' : 'rgba(255, 59, 92, 0.2)'}`,
                                borderRadius: '4px',
                                color: (isSubmitted && !submission.is_correct && submission.points_earned !== 0) ? '#ffffff' : '#ff3b5c',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                cursor: isSubmitted ? 'pointer' : 'not-allowed',
                                opacity: isSubmitted ? 1 : 0.4
                              }}
                            >
                              ✗ {isRtl ? 'رفض (-30)' : 'Reject (-30)'}
                            </button>
                          </div>

                          {/* Score Adjustment Input */}
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '2px' }}>
                            <input
                              type="number"
                              id={`adjust-${player.userId}`}
                              placeholder={isRtl ? 'تعديل النقاط...' : 'Adjust score (e.g. +50)...'}
                              style={{
                                flex: 1,
                                padding: '4px 8px',
                                backgroundColor: '#0b0d1a',
                                border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                color: '#ffffff',
                                outline: 'none'
                              }}
                            />
                            <button
                              onClick={async () => {
                                const input = document.getElementById(`adjust-${player.userId}`) as HTMLInputElement;
                                const val = parseInt(input?.value || '0');
                                if (val !== 0 && gameSyncRef.current) {
                                  playSFX('click');
                                  const ok = await gameSyncRef.current.adjustScore(player.userId, val);
                                  if (ok) {
                                    triggerGamingAlert(isRtl ? `تم تعديل النقاط بمقدار ${val}` : `Adjusted score by ${val}`, 'success');
                                    if (input) input.value = '';
                                  }
                                }
                              }}
                              style={{
                                padding: '4px 10px',
                                backgroundColor: 'rgba(255, 215, 0, 0.15)',
                                border: '1px solid #ffcc00',
                                borderRadius: '4px',
                                color: '#ffcc00',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                cursor: 'pointer'
                              }}
                            >
                              {isRtl ? 'تطبيق' : 'Apply'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>

                {/* Judge Controls Footer */}
                <div style={{
                  padding: '10px 0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <button
                    onClick={async () => {
                      playSFX('slam');
                      if (gameSyncRef.current && activeRoundRef.current) {
                        const ok = await gameSyncRef.current.endRoundManually(activeRoundRef.current.id);
                        if (ok) {
                          triggerGamingAlert(isRtl ? 'تم إنهاء الجولة بنجاح!' : 'Round ended successfully!', 'success');
                        }
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '14px',
                      backgroundColor: '#ffcc00',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#111528',
                      fontSize: '0.9rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      boxShadow: '0 0 15px rgba(255, 204, 0, 0.3)',
                      textAlign: 'center'
                    }}
                  >
                    ⏹ {isRtl ? 'إنهاء الجولة يدوياً' : 'END ROUND MANUALLY'}
                  </button>
                </div>
              </div>
            );
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
                  {getLocalizedText(gameQuestions[currentQIndex].body)}
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
                    <img src={getAssetUrl(gameQuestions[currentQIndex].imageUrl)} alt="Question Graphic" style={styles.questionImage} />
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
                        disabled={isInputDisabled || hiddenOptions.includes(opt.id)}
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
                          opacity: hiddenOptions.includes(opt.id) ? 0.25 : 1,
                          cursor: hiddenOptions.includes(opt.id) ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          width: '100%'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={styles.optLetterBadge}>{opt.id.toUpperCase()}</span>
                          <span style={styles.optText}>{getLocalizedText(opt.text)}</span>
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
                      disabled={isInputDisabled || hiddenOptions.includes('true')}
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
                        opacity: hiddenOptions.includes('true') ? 0.25 : 1,
                        cursor: hiddenOptions.includes('true') ? 'not-allowed' : 'pointer',
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
                      disabled={isInputDisabled || hiddenOptions.includes('false')}
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
                        opacity: hiddenOptions.includes('false') ? 0.25 : 1,
                        cursor: hiddenOptions.includes('false') ? 'not-allowed' : 'pointer',
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
                  gameQuestions[currentQIndex].type === 'CALCULATION_QUESTION' ||
                  gameQuestions[currentQIndex].type === 'SHORT_ANSWER') && (
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
                          <span style={styles.orderingText}>{getLocalizedText(opt?.text)}</span>
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
                            {getLocalizedText(pair.leftText)}
                          </button>
                        ))}
                      </div>

                      <div style={styles.matchingCol}>
                        {gameQuestions[currentQIndex].matchingPairs?.map(pair => {
                          const isConnected = Object.values(matchingSelections).includes(pair.rightId);
                          const leftConnectedId = Object.keys(matchingSelections).find(key => matchingSelections[key] === pair.rightId);
                          const leftTextObj = leftConnectedId ? gameQuestions[currentQIndex].matchingPairs?.find(p => p.leftId === leftConnectedId)?.leftText : null;
                          const leftText = leftTextObj ? getLocalizedText(leftTextObj).split('/')[0] : '';
                          
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
                              <div>{getLocalizedText(pair.rightText)}</div>
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
                          <span style={styles.optText}>{getLocalizedText(opt.text)}</span>
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

              {answerSubmitted && isAnswerCorrect && (
                <AnswerEffectCelebration effectKey={user?.equipped?.effect} />
              )}

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
                    <strong>{t.explanation}:</strong> {getLocalizedText(gameQuestions[currentQIndex].explanation)}
                  </div>
                </div>
              )}

              {isAudienceSpectator && spectatorAnswerSubmitted && (
                <div style={{
                  ...styles.feedbackPanel,
                  borderColor: spectatorIsAnswerCorrect ? '#ffd700' : '#ff3b5c',
                  backgroundColor: spectatorIsAnswerCorrect ? 'rgba(255, 215, 0, 0.05)' : 'rgba(255, 59, 92, 0.05)',
                  marginTop: '12px'
                }}>
                  <div style={{
                    ...styles.feedbackTitle,
                    color: spectatorIsAnswerCorrect ? '#ffd700' : '#ff3b5c'
                  }}>
                    {spectatorIsAnswerCorrect === null 
                      ? (isRtl ? 'بانتظار تصحيح الإجابة...' : 'Awaiting Grading...')
                      : spectatorIsAnswerCorrect 
                        ? `${t.correctText} (+${spectatorPointsEarned} pts)` 
                        : t.wrongText}
                  </div>
                  {spectatorCorrectAnswer !== null && spectatorCorrectAnswer !== undefined && (
                    <div style={{ fontSize: '0.8rem', color: '#ffffff', margin: '4px 0' }}>
                      <strong>{isRtl ? 'الإجابة الصحيحة:' : 'Correct Answer:'}</strong> {JSON.stringify(spectatorCorrectAnswer)}
                    </div>
                  )}
                  {spectatorExplanation && (
                    <div style={styles.explanationText}>
                      <strong>{t.explanation}:</strong> {getLocalizedText(spectatorExplanation)}
                    </div>
                  )}
                  <div style={{ fontSize: '0.75rem', color: '#ffd700', marginTop: '8px', fontWeight: 'bold' }}>
                    🏆 {isRtl ? `مجموع نقاطك: ${audienceScore}` : `Your Audience Score: ${audienceScore}`}
                  </div>
                </div>
              )}

              {/* Audience Leaderboard Side-Panel */}
              {audienceLeaderboard && audienceLeaderboard.length > 0 && (
                <div style={{
                  marginTop: '12px',
                  padding: '12px',
                  backgroundColor: 'rgba(255, 215, 0, 0.02)',
                  border: '1px solid rgba(255, 215, 0, 0.1)',
                  borderRadius: '8px',
                  backdropFilter: 'blur(10px)'
                }}>
                  <div style={{
                    fontSize: '0.75rem',
                    color: '#ffd700',
                    fontWeight: 700,
                    letterSpacing: '1px',
                    marginBottom: '8px',
                    textTransform: 'uppercase',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span>📊 {isRtl ? 'متصدري الجمهور (أفضل 5)' : 'Audience Top 5'}</span>
                    <span style={{ fontSize: '0.6rem', color: '#8a93c0', fontWeight: 'normal' }}>
                      {isRtl ? `${audienceLeaderboard.length} متفرجاً` : `${audienceLeaderboard.length} Viewers`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {audienceLeaderboard.slice(0, 5).map((entry, idx) => {
                      const isLocalGuest = entry.username === audienceNickname || (user && entry.username === user.username);
                      return (
                        <div key={idx} style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '6px 10px',
                          backgroundColor: isLocalGuest ? 'rgba(255, 215, 0, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                          border: isLocalGuest ? '1px solid rgba(255, 215, 0, 0.2)' : '1px solid rgba(255, 255, 255, 0.04)',
                          borderRadius: '6px'
                        }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: isLocalGuest ? '#ffd700' : '#ffffff' }}>
                            #{idx + 1} {entry.username} {isLocalGuest && (isRtl ? '(أنت)' : '(You)')}
                          </span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#00f5ff' }}>
                            {entry.score} pts
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={styles.gameActionBar}>
                {isAudienceSpectator ? (
                  !spectatorAnswerSubmitted ? (
                    <button
                      onClick={() => {
                        const q = gameQuestions[currentQIndex];
                        let userAns: any = null;
                        if (q.type === 'MULTIPLE_CHOICE' || q.type === 'TRUE_FALSE' || q.type === 'IMAGE_QUESTION' || q.type === 'CIRCUIT_QUESTION') {
                          userAns = selectedOption;
                        } else if (q.type === 'FILL_IN_THE_BLANK' || q.type === 'CALCULATION_QUESTION' || q.type === 'CODING_QUESTION' || q.type === 'SHORT_ANSWER') {
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

                        submitSpectatorAnswer(userAns);
                      }}
                      style={styles.submitAnsBtn}
                    >
                      📢 {isRtl ? 'إرسال إجابة الجمهور' : 'SUBMIT AUDIENCE ANSWER'}
                    </button>
                  ) : (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                      padding: '10px',
                      backgroundColor: 'rgba(0, 242, 254, 0.05)',
                      border: '1px solid rgba(0, 242, 254, 0.15)',
                      borderRadius: '8px',
                      color: '#00f2fe',
                      fontSize: '0.95rem',
                      fontWeight: 700,
                      letterSpacing: '1px',
                      textAlign: 'center',
                      width: '100%'
                    }}>
                      ⚡ {isRtl ? 'تم إرسال إجابة الجمهور · بانتظار النتائج' : 'AUDIENCE ANSWER SUBMITTED · AWAITING RESULTS'}
                    </div>
                  )
                ) : isSpectator ? (
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
                        {inventoryPowerUps.map((p, idx) => (
                          <button
                            key={p + '-' + idx}
                            disabled={answerSubmitted || powerUpBlockActive}
                            onClick={() => activatePowerUp(p)}
                            style={{
                              ...styles.powerUpChipBtn,
                              backgroundColor: activePowerUps.includes(p) ? '#00f2fe' : 'rgba(255, 255, 255, 0.04)',
                              color: activePowerUps.includes(p) ? '#05060f' : '#f0f4ff',
                              borderColor: activePowerUps.includes(p) ? '#00f2fe' : 'rgba(255, 255, 255, 0.08)',
                              opacity: powerUpBlockActive ? 0.3 : 1
                            }}
                          >
                            {p === 'JOKER' && '⚡ Joker'}
                            {p === 'FREEZE' && '❄ Freeze'}
                            {p === 'SHIELD' && '🛡 Shield'}
                            {p === 'REVEAL_HINT' && '💡 Hint'}
                            {p === 'DOUBLE_CHANCE' && '🎯 Double'}
                            {p === 'STEAL' && '🪝 Steal'}
                            {p === 'TIME_BOOST' && '⏱ Boost'}
                            {p === 'POINT_MULTIPLIER' && '✨ Multiplier'}
                            {p === 'CATEGORY_SWAP' && '🔄 Swap'}
                            {p === 'SKIP_QUESTION' && '⏭ Skip'}
                            {p === 'BLOCK_POWER_UP' && '🚫 Block'}
                          </button>
                        ))}
                        {inventoryPowerUps.length < 4 && gameMode !== 'PRACTICE' && (
                          <button
                            disabled={answerSubmitted || powerUpBlockActive}
                            onClick={() => { playSFX('click'); setShowStoreModal(true); }}
                            style={{
                              ...styles.powerUpChipBtn,
                              backgroundColor: 'rgba(0, 242, 254, 0.1)',
                              color: '#00f2fe',
                              borderColor: 'rgba(0, 242, 254, 0.3)',
                              fontWeight: 'bold'
                            }}
                          >
                            🛒 {isRtl ? '+ متجر' : '+ Store'}
                          </button>
                        )}
                      </div>
                    </div>

                    {buzzerActive && !isBuzzed && !answerSubmitted && (
                      <button style={styles.buzzerCircBtn} onClick={() => handleBuzz(0)}>
                        {t.buzzBtn}
                      </button>
                    )}

                    {/* Answering State */}
                    {(!buzzerActive || (isBuzzed && buzzedUser === user?.username)) && !answerSubmitted && (
                      <button style={styles.submitAnsBtn} onClick={handleSubmitAnswer}>
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

              const getPercentageForCandidate = (category: string, candidateId: string) => {
                const votesForCategory = liveVotes[category] || {};
                const totalVotes = Object.values(votesForCategory).reduce((sum, count) => sum + count, 0);
                if (totalVotes === 0) return 0;
                const candCount = votesForCategory[candidateId] || 0;
                return Math.round((candCount / totalVotes) * 100);
              };

              const getTierInfo = (rp: number) => {
                const tiers = [
                  { name: 'Bronze', min: 0, max: 999 },
                  { name: 'Silver', min: 1000, max: 1999 },
                  { name: 'Gold', min: 2000, max: 2999 },
                  { name: 'Platinum', min: 3000, max: 3999 },
                  { name: 'Diamond', min: 4000, max: 4999 },
                  { name: 'Master', min: 5000, max: 5999 },
                  { name: 'Grand Master', min: 6000, max: 6999 },
                  { name: 'Legend', min: 7000, max: 7999 },
                  { name: 'Mythic', min: 8000, max: 8999 },
                  { name: 'Titan', min: 9000, max: 999999 }
                ];
                const tier = tiers.find(t => rp >= t.min && rp <= t.max) || tiers[0];
                const range = tier.name === 'Titan' ? 1000 : (tier.max - tier.min + 1);
                const progress = Math.min(100, Math.max(0, ((rp - tier.min) / range) * 100));
                return { ...tier, progress };
              };

              const myUserId = user?.id || 'solo_player';
              
              // Get all my answers in order of round numbers
              const getPlayerAnswers = (pId: string) => {
                return rounds
                  .map(r => {
                    const ans = r.answers.find(a => a.userId === pId);
                    return ans ? { ...ans, roundNumber: r.roundNumber } : null;
                  })
                  .filter((a): a is NonNullable<typeof a> => a !== null);
              };

              const myAnswers = getPlayerAnswers(myUserId);

              // 1. Average Speed
              const avgSpeedVal = myAnswers.length > 0
                ? (myAnswers.reduce((sum, a) => sum + a.timeSpentMs, 0) / myAnswers.length) / 1000
                : 0;

              // 2. Fastest Correct Answer
              const correctSpeeds = myAnswers.filter(a => a.isCorrect).map(a => a.timeSpentMs);
              const fastestSpeedVal = correctSpeeds.length > 0
                ? Math.min(...correctSpeeds) / 1000
                : (myParticipant?.fastestAnswerMs ? myParticipant.fastestAnswerMs / 1000 : 0);

              // 3. Power-ups used count
              const powerupCountVal = myAnswers.reduce((sum, a) => sum + (a.powerUpsUsed?.length || 0), 0);

              // 4. Coins, Tokens and XP Gained
              const coinsEarnedVal = myParticipant 
                ? (myParticipant.coinsEarned ?? 0) 
                : (gameMode === 'DAILY_CHALLENGE' ? Math.floor(score / 10) + 50 : Math.floor(score / 10));
              const tokensEarnedVal = myParticipant ? (myParticipant.tokensEarned ?? 0) : 0;
              const xpEarnedVal = 250;

              // 5. Highlights (Top Moments)
              const generateHighlights = () => {
                const list: { icon: string; title: { en: string; ar: string }; desc: { en: string; ar: string } }[] = [];
                if (myAnswers.length === 0) return list;

                // Accuracy checks
                const myCorrectCount = myAnswers.filter(a => a.isCorrect).length;
                const myAccuracy = Math.round((myCorrectCount / myAnswers.length) * 100);
                if (myAccuracy === 100 && myAnswers.length >= 3) {
                  list.push({
                    icon: '🎯',
                    title: { en: 'Perfectionist', ar: 'الباحث عن المثالية' },
                    desc: { en: 'Answered all questions correctly!', ar: 'أجاب على جميع الأسئلة بشكل صحيح!' }
                  });
                }

                // Speed checks
                if (correctSpeeds.length > 0) {
                  const minSpeed = Math.min(...correctSpeeds) / 1000;
                  if (minSpeed < 3) {
                    list.push({
                      icon: '⚡',
                      title: { en: 'Speed Demon', ar: 'شيطان السرعة' },
                      desc: { 
                        en: `Answered correctly in only ${minSpeed.toFixed(1)}s!`, 
                        ar: `أجاب إجابة صحيحة في غضون ${minSpeed.toFixed(1)} ثانية فقط!` 
                      }
                    });
                  }
                }

                // Streak checks
                let maxStreak = 0;
                let currentStreak = 0;
                myAnswers.forEach(a => {
                  if (a.isCorrect) {
                    currentStreak++;
                    if (currentStreak > maxStreak) maxStreak = currentStreak;
                  } else {
                    currentStreak = 0;
                  }
                });
                if (maxStreak >= 3) {
                  list.push({
                    icon: '🔥',
                    title: { en: 'Streak Master', ar: 'سيد المتتاليات' },
                    desc: { 
                      en: `Got ${maxStreak} correct answers in a row!`, 
                      ar: `حصل على ${maxStreak} إجابات صحيحة متتالية!` 
                    }
                  });
                }

                // Power-ups checks
                if (powerupCountVal >= 2) {
                  list.push({
                    icon: '🛡️',
                    title: { en: 'Tactician', ar: 'المخطط البارع' },
                    desc: { 
                      en: `Used ${powerupCountVal} power-ups strategically!`, 
                      ar: `استخدم ${powerupCountVal} من المعززات بشكل استراتيجي!` 
                    }
                  });
                }

                // Clutch checks
                const lastRoundAnswer = myAnswers[myAnswers.length - 1];
                if (lastRoundAnswer && lastRoundAnswer.isCorrect && myAnswers.length >= 3) {
                  list.push({
                    icon: '👑',
                    title: { en: 'Clutch Player', ar: 'اللاعب الحاسم' },
                    desc: { 
                      en: 'Aced the high-pressure final round!', 
                      ar: 'تألق وأجاب بشكل صحيح في الجولة الأخيرة الحاسمة!' 
                    }
                  });
                }

                // Fallback
                if (list.length === 0) {
                  list.push({
                    icon: '💪',
                    title: { en: 'Gladiator', ar: 'المقاتل' },
                    desc: { 
                      en: 'Fought hard and finished the match!', 
                      ar: 'قاتل بجدية وأكمل التحدي للنهاية!' 
                    }
                  });
                }
                return list;
              };

              const matchHighlights = generateHighlights();

              // 6. Newly Unlocked Badges
              const newlyUnlockedBadges = (user?.badges || []).filter(b => !matchStartBadges.includes(b));
              
              // 7. MVP determination
              const mvpPlayer = players.find(p => p.isMvp) || (players.length > 0 ? players[0] : null);

              // 8. RP Difference
              const rpDiff = (user?.rankPoints || 0) - matchStartRP;

              // 9. MVP Fastest Time Helper
              const getPlayerFastestTime = (pId: string) => {
                const pAns = getPlayerAnswers(pId);
                const correctPAns = pAns.filter(a => a.isCorrect);
                if (correctPAns.length > 0) {
                  return `${(Math.min(...correctPAns.map(a => a.timeSpentMs)) / 1000).toFixed(2)}s`;
                }
                const matchedPlayer = players.find(p => p.userId === pId);
                if (matchedPlayer?.fastestAnswerMs) {
                  return `${(matchedPlayer.fastestAnswerMs / 1000).toFixed(2)}s`;
                }
                return '-';
              };

              const getShareText = () => {
                const matchType = matchReportDetails.isMultiplayer 
                  ? (isRtl ? 'مواجهة جماعية في سباق العقول' : 'multiplayer match in MindRace') 
                  : (isRtl ? 'تحدي فردي في سباق العقول' : 'solo run in MindRace');
                
                const myAccuracy = myParticipant?.accuracy || (myAnswers.length > 0 ? Math.round((myAnswers.filter(a => a.isCorrect).length / myAnswers.length) * 100) : 0);
                
                if (isRtl) {
                  return `لقد أكملت للتو ${matchType}! 
النتيجة: ${score} نقطة 🎯
الدقة: ${myAccuracy}% 📊
الرتبة الحالية: ${user?.rank || 'Bronze'} (${user?.rankPoints || 0} RP) 🏆
العب سباق العقول واختبر معلوماتك الآن! 🧠⚡`;
                } else {
                  return `I just finished a ${matchType}! 
Score: ${score} pts 🎯
Accuracy: ${myAccuracy}% 📊
Current Rank: ${user?.rank || 'Bronze'} (${user?.rankPoints || 0} RP) 🏆
Play MindRace and test your knowledge now! 🧠⚡`;
                }
              };

              const shareToTwitter = () => {
                const text = encodeURIComponent(getShareText());
                window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
              };

              const shareToWhatsApp = () => {
                const text = encodeURIComponent(getShareText());
                window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
              };

              const copyToClipboard = () => {
                const text = getShareText();
                navigator.clipboard.writeText(text).then(() => {
                  setCopiedToastVisible(true);
                  setTimeout(() => setCopiedToastVisible(false), 2000);
                });
              };

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', height: '100%', minHeight: 0 }}>
                  
                  {/* Voting Card Panel */}
                  {votingActive && (
                    <div style={{
                      backgroundColor: 'rgba(11, 13, 26, 0.95)',
                      border: '2px solid rgba(0, 245, 255, 0.2)',
                      borderRadius: '16px',
                      padding: '24px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '20px',
                      width: '100%',
                      boxShadow: '0 0 30px rgba(0, 245, 255, 0.1)',
                      boxSizing: 'border-box',
                      backdropFilter: 'blur(10px)',
                      zIndex: 10,
                      position: 'relative'
                    }}>
                      {/* Header and Countdown */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '12px' }}>
                        <div>
                          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#ffffff', margin: 0, fontFamily: 'var(--font-display)' }}>
                            🏆 {t.votingTitle}
                          </h2>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {t.votingSub}
                          </span>
                        </div>
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          background: votingTimeLeft <= 5 ? 'rgba(255, 59, 92, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                          border: `1px solid ${votingTimeLeft <= 5 ? '#ff3b5c' : 'rgba(255, 255, 255, 0.1)'}`,
                          padding: '6px 12px',
                          borderRadius: '8px'
                        }}>
                          <span style={{ fontSize: '0.65rem', color: votingTimeLeft <= 5 ? '#ff3b5c' : 'var(--text-secondary)', fontWeight: 'bold', textTransform: 'uppercase' }}>
                            {t.timeLeft}
                          </span>
                          <span style={{ fontSize: '1.4rem', fontWeight: 900, color: votingTimeLeft <= 5 ? '#ff3b5c' : '#00f2fe', fontFamily: 'var(--font-ui)' }}>
                            {votingTimeLeft}s
                          </span>
                        </div>
                      </div>

                      {/* Voting Categories */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        
                        {/* Category: MVP */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#ffd700', margin: 0 }}>
                            🌟 {t.mvpLabel}
                          </h3>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {votingCandidates?.bestPlayer.map((cand) => {
                              const candId = cand.id;
                              const candName = cand.username;
                              const isSelf = candId === user?.id;
                              const isVoted = myVotes['best_player'] === candId;
                              const hasVotedThisCat = myVotes['best_player'] !== undefined;
                              const pct = getPercentageForCandidate('best_player', candId);
                              const votesCount = (liveVotes['best_player'] || {})[candId] || 0;

                              return (
                                <button
                                  key={candId}
                                  disabled={isSelf || hasVotedThisCat}
                                  onClick={() => submitVote('best_player', candId)}
                                  style={{
                                    position: 'relative',
                                    width: '100%',
                                    padding: '12px 16px',
                                    backgroundColor: isVoted ? 'rgba(0, 245, 255, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                                    border: isVoted ? '1px solid #00f2fe' : '1px solid rgba(255, 255, 255, 0.05)',
                                    borderRadius: '8px',
                                    color: isSelf ? 'var(--text-muted)' : '#ffffff',
                                    cursor: (isSelf || hasVotedThisCat) ? 'default' : 'pointer',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    overflow: 'hidden',
                                    transition: 'all 0.2s ease',
                                    textAlign: isRtl ? 'right' : 'left'
                                  }}
                                >
                                  {/* Background Progress Bar */}
                                  {hasVotedThisCat && (
                                    <div style={{
                                      position: 'absolute',
                                      top: 0,
                                      [isRtl ? 'right' : 'left']: 0,
                                      height: '100%',
                                      width: `${pct}%`,
                                      background: isVoted ? 'linear-gradient(90deg, rgba(0, 242, 254, 0.15), rgba(0, 242, 254, 0.05))' : 'rgba(255, 255, 255, 0.03)',
                                      transition: 'width 0.5s ease-out',
                                      zIndex: 1
                                    }} />
                                  )}
                                  
                                  <span style={{ zIndex: 2, fontWeight: isVoted ? 800 : 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {candName}
                                    {isSelf && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>({isRtl ? 'أنت' : 'Self'})</span>}
                                    {isVoted && <span style={{ fontSize: '0.75rem', color: '#00f2fe' }}>✔ {t.voteCast}</span>}
                                  </span>
                                  {hasVotedThisCat && (
                                    <span style={{ zIndex: 2, fontSize: '0.85rem', fontWeight: 'bold', color: isVoted ? '#00f2fe' : 'var(--text-secondary)' }}>
                                      {pct}% ({votesCount})
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Category: Best Team (if team battle) */}
                        {votingCandidates?.bestTeam && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#ff4d6d', margin: 0 }}>
                              🔥 {t.bestTeamLabel}
                            </h3>
                            <div style={{ display: 'flex', gap: '10px' }}>
                              {votingCandidates.bestTeam.map((teamId) => {
                                const teamName = teamId === 'team_a' ? (isRtl ? 'الفريق أ (الأزرق)' : 'Team A (Blue)') : (isRtl ? 'الفريق ب (الأحمر)' : 'Team B (Red)');
                                const isVoted = myVotes['best_team'] === teamId;
                                const hasVotedThisCat = myVotes['best_team'] !== undefined;
                                const pct = getPercentageForCandidate('best_team', teamId);
                                const votesCount = (liveVotes['best_team'] || {})[teamId] || 0;
                                const teamColor = teamId === 'team_a' ? '#00f2fe' : '#ff3b5c';

                                return (
                                  <button
                                    key={teamId}
                                    disabled={hasVotedThisCat}
                                    onClick={() => submitVote('best_team', teamId)}
                                    style={{
                                      position: 'relative',
                                      flex: 1,
                                      padding: '16px 12px',
                                      backgroundColor: isVoted ? `rgba(${teamId === 'team_a' ? '0, 242, 254' : '255, 59, 92'}, 0.1)` : 'rgba(255, 255, 255, 0.02)',
                                      border: `1px solid ${isVoted ? teamColor : 'rgba(255, 255, 255, 0.05)'}`,
                                      borderRadius: '8px',
                                      color: '#ffffff',
                                      cursor: hasVotedThisCat ? 'default' : 'pointer',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      gap: '6px',
                                      overflow: 'hidden',
                                      transition: 'all 0.2s ease',
                                    }}
                                  >
                                    {/* Background Progress Fill */}
                                    {hasVotedThisCat && (
                                      <div style={{
                                        position: 'absolute',
                                        bottom: 0,
                                        left: 0,
                                        width: '100%',
                                        height: `${pct}%`,
                                        background: `rgba(${teamId === 'team_a' ? '0, 242, 254' : '255, 59, 92'}, 0.08)`,
                                        transition: 'height 0.5s ease-out',
                                        zIndex: 1
                                      }} />
                                    )}
                                    
                                    <span style={{ zIndex: 2, fontWeight: isVoted ? 800 : 600, color: teamColor, fontSize: '0.9rem' }}>
                                      {teamName}
                                    </span>
                                    {isVoted && <span style={{ zIndex: 2, fontSize: '0.7rem', color: teamColor }}>✔ {t.voteCast}</span>}
                                    {hasVotedThisCat && (
                                      <span style={{ zIndex: 2, fontSize: '1rem', fontWeight: 'bold', color: '#ffffff', marginTop: '4px' }}>
                                        {pct}% ({votesCount})
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Category: Best Answer (if team battle) */}
                        {votingCandidates?.bestAnswer && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#00f5ff', margin: 0 }}>
                              💡 {t.bestAnswerLabel}
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              {votingCandidates.bestAnswer.map((cand) => {
                                const candId = cand.id;
                                const candName = cand.username;
                                const isSelf = candId === user?.id;
                                const isVoted = myVotes['best_answer'] === candId;
                                const hasVotedThisCat = myVotes['best_answer'] !== undefined;
                                const pct = getPercentageForCandidate('best_answer', candId);
                                const votesCount = (liveVotes['best_answer'] || {})[candId] || 0;

                                return (
                                  <button
                                    key={candId}
                                    disabled={isSelf || hasVotedThisCat}
                                    onClick={() => submitVote('best_answer', candId)}
                                    style={{
                                      position: 'relative',
                                      width: '100%',
                                      padding: '12px 16px',
                                      backgroundColor: isVoted ? 'rgba(0, 245, 255, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                                      border: isVoted ? '1px solid #00f2fe' : '1px solid rgba(255, 255, 255, 0.05)',
                                      borderRadius: '8px',
                                      color: isSelf ? 'var(--text-muted)' : '#ffffff',
                                      cursor: (isSelf || hasVotedThisCat) ? 'default' : 'pointer',
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      overflow: 'hidden',
                                      transition: 'all 0.2s ease',
                                      textAlign: isRtl ? 'right' : 'left'
                                    }}
                                  >
                                    {/* Background Progress Bar */}
                                    {hasVotedThisCat && (
                                      <div style={{
                                        position: 'absolute',
                                        top: 0,
                                        [isRtl ? 'right' : 'left']: 0,
                                        height: '100%',
                                        width: `${pct}%`,
                                        background: isVoted ? 'linear-gradient(90deg, rgba(0, 242, 254, 0.15), rgba(0, 242, 254, 0.05))' : 'rgba(255, 255, 255, 0.03)',
                                        transition: 'width 0.5s ease-out',
                                        zIndex: 1
                                      }} />
                                    )}
                                    
                                    <span style={{ zIndex: 2, fontWeight: isVoted ? 800 : 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      {candName}
                                      {isSelf && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>({isRtl ? 'أنت' : 'Self'})</span>}
                                      {isVoted && <span style={{ fontSize: '0.75rem', color: '#00f2fe' }}>✔ {t.voteCast}</span>}
                                    </span>
                                    {hasVotedThisCat && (
                                      <span style={{ zIndex: 2, fontSize: '0.85rem', fontWeight: 'bold', color: isVoted ? '#00f2fe' : 'var(--text-secondary)' }}>
                                        {pct}% ({votesCount})
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                      </div>
                    </div>
                  )}

                  {!votingActive && (
                    <>
                      {/* Scrollable Content Area */}
                      <div 
                        style={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: '20px', 
                          overflowY: 'auto', 
                          flex: 1, 
                          paddingRight: '4px',
                          paddingBottom: '16px' 
                        }} 
                        className="custom-scrollbar"
                      >
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
                            transition: 'var(--transition-smooth)',
                            flexShrink: 0
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
                              color: '#ffffff',
                              margin: 0
                            }}
                          >
                            {isVictory ? t.victoryTitle : t.defeatTitle}
                          </h1>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', maxWidth: '320px', lineHeight: 1.5, margin: 0 }}>
                            {isVictory 
                              ? (currentRoom ? (isRtl ? 'لقد سيطرت على ساحة المعركة المعرفية وتفوقت على الجميع!' : 'You dominated the cognitive arena and outsmarted everyone!') : (isRtl ? 'أداء رائع! لقد أكملت التحدي بدقة عالية!' : 'Fantastic job! You completed the challenge successfully!'))
                              : (currentRoom ? (isRtl ? 'الهزيمة ليست النهاية، بل بداية طريق التميز والتعلم!' : 'Defeat is not the end, but the beginning of mastery!') : (isRtl ? 'استمر في التحدي! الممارسة تصنع الفارق دائماً!' : 'Keep practicing! Repetition is the key to mastery!'))
                            }
                          </p>
                        </div>

                        {/* MVP Spotlight Card */}
                        {mvpPlayer && (
                          <div style={{
                            background: 'linear-gradient(135deg, rgba(255, 215, 0, 0.08) 0%, rgba(11, 13, 26, 0.95) 100%)',
                            border: '2px solid rgba(255, 215, 0, 0.6)',
                            borderRadius: '16px',
                            padding: '20px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '12px',
                            boxShadow: '0 0 25px rgba(255, 215, 0, 0.25)',
                            boxSizing: 'border-box',
                            position: 'relative',
                            overflow: 'hidden',
                            marginTop: '4px',
                            flexShrink: 0
                          }} className="animate-float">
                            {/* Ambient Glowing Spotlights */}
                            <div style={{
                              position: 'absolute',
                              top: '-20%',
                              left: '-20%',
                              width: '140%',
                              height: '140%',
                              background: 'radial-gradient(circle, rgba(255, 215, 0, 0.06) 0%, transparent 60%)',
                              pointerEvents: 'none'
                            }} />

                            <span style={{ fontSize: '2.5rem', filter: 'drop-shadow(0 0 10px rgba(255,215,0,0.5))', zIndex: 2 }}>👑</span>
                            
                            <h2 style={{
                              fontSize: '1.3rem',
                              fontWeight: 900,
                              color: '#ffd700',
                              margin: 0,
                              fontFamily: 'var(--font-display)',
                              letterSpacing: '1px',
                              textShadow: '0 0 12px rgba(255, 215, 0, 0.4)',
                              zIndex: 2
                            }}>
                              {isRtl ? 'بطل المواجهة (MVP)' : 'MATCH MVP'}
                            </h2>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', zIndex: 2 }}>
                              {mvpPlayer.avatarUrl ? (
                                <img 
                                  src={getAssetUrl(mvpPlayer.avatarUrl)} 
                                  alt={mvpPlayer.username} 
                                  style={{ width: '48px', height: '48px', borderRadius: '50%', border: '2px solid #ffd700', objectFit: 'cover' }} 
                                />
                              ) : (
                                <div style={{ 
                                  width: '48px', 
                                  height: '48px', 
                                  borderRadius: '50%', 
                                  border: '2px solid #ffd700', 
                                  backgroundColor: 'rgba(255,215,0,0.1)', 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  justifyContent: 'center',
                                  fontSize: '1.5rem',
                                  color: '#ffd700'
                                }}>
                                  👤
                                </div>
                              )}
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: isRtl ? 'flex-end' : 'flex-start' }}>
                                <span style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ffffff' }}>
                                  {mvpPlayer.username}
                                </span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <RankBadge rank={mvpPlayer.rank} size={20} animate={false} />
                                  <span style={{ fontSize: '0.75rem', color: '#ffd700', fontWeight: 600 }}>
                                    {mvpPlayer.rank}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* MVP Stats Block */}
                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr 1fr',
                              gap: '8px',
                              width: '100%',
                              backgroundColor: 'rgba(0, 0, 0, 0.25)',
                              borderRadius: '8px',
                              padding: '10px',
                              zIndex: 2,
                              border: '1px solid rgba(255, 215, 0, 0.15)'
                            }}>
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{t.scoreHeader}</span>
                                <span style={{ fontSize: '1.1rem', fontWeight: 800, color: '#ffd700' }}>{mvpPlayer.score}</span>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{t.accuracyHeader}</span>
                                <span style={{ fontSize: '1.1rem', fontWeight: 800, color: '#ffffff' }}>{mvpPlayer.accuracy}%</span>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{isRtl ? 'أسرع زمن' : 'Fastest Time'}</span>
                                <span style={{ fontSize: '1.1rem', fontWeight: 800, color: '#00f2fe' }}>
                                  {getPlayerFastestTime(mvpPlayer.userId)}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Awards Winners Banner */}
                        {votingWinners && (
                          <div style={{
                            background: 'linear-gradient(135deg, rgba(11, 13, 26, 0.9) 0%, rgba(17, 19, 31, 0.95) 100%)',
                            border: '2px solid #ffd700',
                            borderRadius: '16px',
                            padding: '20px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '14px',
                            boxShadow: '0 0 25px rgba(255, 215, 0, 0.15)',
                            boxSizing: 'border-box',
                            textAlign: 'center',
                            position: 'relative',
                            overflow: 'hidden',
                            flexShrink: 0
                          }}>
                            <div style={{
                              position: 'absolute',
                              top: '-50%',
                              left: '-50%',
                              width: '200%',
                              height: '200%',
                              background: 'radial-gradient(circle, rgba(255, 215, 0, 0.05) 0%, transparent 70%)',
                              pointerEvents: 'none'
                            }} />

                            <h2 style={{
                              fontSize: '1.25rem',
                              fontWeight: 800,
                              color: '#ffd700',
                              margin: 0,
                              fontFamily: 'var(--font-display)',
                              textTransform: 'uppercase',
                              letterSpacing: '1px',
                              textShadow: '0 0 10px rgba(255, 215, 0, 0.3)',
                              zIndex: 2
                            }}>
                              {t.awardsWinnersTitle}
                            </h2>

                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: votingWinners.bestTeam ? '1fr 1fr 1fr' : '1fr',
                              gap: '12px',
                              zIndex: 2,
                              alignItems: 'stretch'
                            }}>
                              <div style={{
                                background: 'rgba(255, 215, 0, 0.03)',
                                border: '1px solid rgba(255, 215, 0, 0.15)',
                                borderRadius: '10px',
                                padding: '12px 8px',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '6px',
                                justifyContent: 'center'
                              }}>
                                <span style={{ fontSize: '0.75rem', color: '#ffd700', fontWeight: 'bold', textTransform: 'uppercase' }}>
                                  {t.mvpWinner}
                                </span>
                                <span style={{ fontSize: '1.1rem', fontWeight: 900, color: '#ffffff', fontFamily: 'var(--font-display)' }}>
                                  {votingWinners.bestPlayer || (isRtl ? 'لا يوجد' : 'No votes')}
                                </span>
                              </div>

                              {votingWinners.bestTeam && (
                                <div style={{
                                  background: 'rgba(255, 59, 92, 0.03)',
                                  border: '1px solid rgba(255, 59, 92, 0.15)',
                                  borderRadius: '10px',
                                  padding: '12px 8px',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  gap: '6px',
                                  justifyContent: 'center'
                                }}>
                                  <span style={{ fontSize: '0.75rem', color: '#ff4d6d', fontWeight: 'bold', textTransform: 'uppercase' }}>
                                    {t.bestTeamWinner}
                                  </span>
                                  <span style={{
                                    fontSize: '1.1rem',
                                    fontWeight: 900,
                                    color: votingWinners.bestTeam.includes('A') ? '#00f2fe' : '#ff3b5c',
                                    fontFamily: 'var(--font-display)'
                                  }}>
                                    {votingWinners.bestTeam}
                                  </span>
                                </div>
                              )}

                              {votingWinners.bestAnswer && (
                                <div style={{
                                  background: 'rgba(0, 245, 255, 0.03)',
                                  border: '1px solid rgba(0, 245, 255, 0.15)',
                                  borderRadius: '10px',
                                  padding: '12px 8px',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  gap: '6px',
                                  justifyContent: 'center'
                                }}>
                                  <span style={{ fontSize: '0.75rem', color: '#00f5ff', fontWeight: 'bold', textTransform: 'uppercase' }}>
                                    {t.bestAnswerWinner}
                                  </span>
                                  <span style={{ fontSize: '1.1rem', fontWeight: 900, color: '#ffffff', fontFamily: 'var(--font-display)' }}>
                                    {votingWinners.bestAnswer || (isRtl ? 'لا يوجد' : 'No votes')}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Rank Progression Bar */}
                        {user && myParticipant && (
                          <div style={{ ...styles.rewardsPanelCard, gap: '12px', margin: 0, flexShrink: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>
                                {t.rankProgression}
                              </span>
                              <span style={{
                                fontSize: '0.8rem',
                                fontWeight: 800,
                                color: rpDiff >= 0 ? '#00e676' : '#ff1744'
                              }}>
                                {rpDiff >= 0 ? `+${rpDiff}` : rpDiff} RP
                              </span>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                              <RankBadge rank={user.rank} size={40} animate={false} />
                              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '4px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                                  <span style={{ fontWeight: 'bold', color: '#ffffff' }}>{user.rank}</span>
                                  <span style={{ color: 'var(--text-secondary)' }}>{user.rankPoints} RP</span>
                                </div>
                                
                                {/* Animated Progress Bar Container */}
                                <div style={{
                                  background: 'rgba(255, 255, 255, 0.05)',
                                  borderRadius: '10px',
                                  height: '10px',
                                  width: '100%',
                                  overflow: 'hidden',
                                  position: 'relative',
                                  border: '1px solid rgba(255, 255, 255, 0.03)'
                                }}>
                                  <div style={{
                                    background: 'linear-gradient(90deg, #00f2fe 0%, #4facfe 100%)',
                                    height: '100%',
                                    width: `${progressWidth}%`,
                                    transition: 'width 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                    boxShadow: '0 0 10px rgba(0, 242, 254, 0.5)',
                                    borderRadius: '10px'
                                  }} />
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Enhanced Match Statistics Grid */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: '12px',
                          margin: 0,
                          flexShrink: 0
                        }}>
                          {/* Score */}
                          <div style={styles.statCard}>
                            <span style={styles.statHeading}>{t.score}</span>
                            <span style={styles.statNum} className="text-glow">{score}</span>
                          </div>

                          {/* Accuracy */}
                          <div style={styles.statCard}>
                            <span style={styles.statHeading}>{t.accuracy}</span>
                            <span style={styles.statNum} className="text-glow-accent">
                              {myParticipant?.accuracy || (myAnswers.length > 0 ? Math.round((myAnswers.filter(a => a.isCorrect).length / myAnswers.length) * 100) : 0)}%
                            </span>
                          </div>

                          {/* Avg Speed */}
                          <div style={styles.statCard}>
                            <span style={styles.statHeading}>{t.avgSpeed}</span>
                            <span style={{ ...styles.statNum, color: '#ffd066' }}>
                              {avgSpeedVal > 0 ? `${avgSpeedVal.toFixed(1)}s` : '-'}
                            </span>
                          </div>

                          {/* Fastest Speed */}
                          <div style={styles.statCard}>
                            <span style={styles.statHeading}>{t.fastestSpeed}</span>
                            <span style={{ ...styles.statNum, color: '#00e676' }}>
                              {fastestSpeedVal > 0 ? `${fastestSpeedVal.toFixed(1)}s` : '-'}
                            </span>
                          </div>

                          {/* Powerups Used */}
                          <div style={{ ...styles.statCard, gridColumn: 'span 2' }}>
                            <span style={styles.statHeading}>{t.powerupsUsed}</span>
                            <span style={{ ...styles.statNum, color: '#a0aec0' }}>
                              {powerupCountVal}
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
                            margin: 0,
                            flexShrink: 0
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

                        {/* Highlights (Top Moments) */}
                        <div style={{ ...styles.rewardsPanelCard, gap: '14px', margin: 0, flexShrink: 0 }}>
                          <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--primary)', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px', margin: 0 }}>
                            {t.highlightsTitle}
                          </h2>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {matchHighlights.map((hl, idx) => (
                              <div 
                                key={idx} 
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '12px',
                                  padding: '12px',
                                  backgroundColor: 'rgba(255, 255, 255, 0.015)',
                                  border: '1px solid rgba(255, 255, 255, 0.04)',
                                  borderRadius: '10px',
                                  transition: 'transform 0.2s ease, border-color 0.2s ease',
                                  cursor: 'default'
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = 'rgba(0, 242, 254, 0.2)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.04)'; }}
                              >
                                <span style={{ fontSize: '2rem' }}>{hl.icon}</span>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: isRtl ? 'right' : 'left' }}>
                                  <span style={{ fontWeight: 'bold', fontSize: '0.95rem', color: '#ffffff' }}>
                                    {isRtl ? hl.title.ar : hl.title.en}
                                  </span>
                                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                    {isRtl ? hl.desc.ar : hl.desc.en}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Achievements Unlocked */}
                        {user && myParticipant && newlyUnlockedBadges.length > 0 && (
                          <div style={{ 
                            ...styles.rewardsPanelCard, 
                            gap: '14px', 
                            border: '1px solid rgba(255, 215, 0, 0.25)', 
                            background: 'linear-gradient(135deg, rgba(255, 215, 0, 0.02) 0%, rgba(17, 19, 31, 0.8) 100%)',
                            margin: 0,
                            flexShrink: 0
                          }}>
                            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#ffd700', borderBottom: '1px solid rgba(255,215,0,0.15)', paddingBottom: '8px', margin: 0 }}>
                              🏆 {isRtl ? 'تم فتح إنجازات جديدة!' : 'Achievements Unlocked!'}
                            </h2>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                              {newlyUnlockedBadges.map((badgeKey) => {
                                const badge = BADGES_METADATA.find(b => b.key === badgeKey);
                                if (!badge) return null;
                                return (
                                  <div 
                                    key={badgeKey} 
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '12px',
                                      padding: '12px',
                                      backgroundColor: 'rgba(255, 215, 0, 0.03)',
                                      border: '1px solid rgba(255, 215, 0, 0.15)',
                                      borderRadius: '10px'
                                    }}
                                  >
                                    <span style={{ fontSize: '2rem' }}>{badge.icon || '🏅'}</span>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: isRtl ? 'right' : 'left' }}>
                                      <span style={{ fontWeight: 'bold', fontSize: '0.95rem', color: '#ffd700' }}>
                                        {isRtl ? badge.name.ar : badge.name.en}
                                      </span>
                                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                        {isRtl ? badge.desc.ar : badge.desc.en}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Rewards Panel */}
                        {user && myParticipant && (
                          <div style={{ ...styles.rewardsPanelCard, margin: 0, flexShrink: 0 }}>
                            <div style={styles.rewardDetailRow}>
                              <span style={{ color: 'var(--text-secondary)' }}>{t.coinsEarned}</span>
                              <span style={{ color: '#ffb300', fontWeight: 800 }}>+ {coinsEarnedVal} 🪙</span>
                            </div>
                            {tokensEarnedVal > 0 && (
                              <div style={styles.rewardDetailRow}>
                                <span style={{ color: 'var(--text-secondary)' }}>{isRtl ? 'الرموز المكتسبة' : 'Tokens Earned'}</span>
                                <span style={{ color: '#00f2fe', fontWeight: 800 }}>+ {tokensEarnedVal} 💎</span>
                              </div>
                            )}
                            <div style={styles.rewardDetailRow}>
                              <span style={{ color: 'var(--text-secondary)' }}>{t.xpGained}</span>
                              <span style={{ color: '#00e676', fontWeight: 800 }}>+ {xpEarnedVal} XP</span>
                            </div>
                          </div>
                        )}

                        {/* Standings Table / Scoreboard */}
                        {players.length > 0 && (
                          <div style={{ ...styles.rewardsPanelCard, gap: '16px', margin: 0, flexShrink: 0 }}>
                            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--primary)', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '10px', margin: 0 }}>
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
                                            <RankBadge rank={p.rank} size={32} animate={false} />
                                            <span style={{ fontWeight: isSelf ? 800 : 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                              {p.username}
                                              {p.isMvp && <span title="MVP" style={{ cursor: 'help' }}>👑</span>}
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
                        )}

                        {/* Final Audience Standings (If any spectator scores exist) */}
                        {audienceLeaderboard && audienceLeaderboard.length > 0 && (
                          <div style={{ ...styles.rewardsPanelCard, gap: '16px', margin: 0, flexShrink: 0 }}>
                            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ffd700', borderBottom: '1px solid rgba(255,215,0,0.15)', paddingBottom: '10px', margin: 0 }}>
                              🏆 {isRtl ? 'النتائج النهائية للجمهور' : 'Final Audience Standings'}
                            </h2>
                            <div style={{ overflowX: 'auto', width: '100%' }}>
                              <table className="glass-table" style={{ borderColor: 'rgba(255, 215, 0, 0.15)' }}>
                                <thead>
                                  <tr>
                                    <th>{t.rankHeader}</th>
                                    <th>{isRtl ? 'المتفرج' : 'Spectator'}</th>
                                    <th>{t.scoreHeader}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {audienceLeaderboard.map((entry, idx) => {
                                    const isLocalGuest = entry.username === audienceNickname || (user && entry.username === user.username);
                                    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
                                    return (
                                      <tr key={idx} className={isLocalGuest ? "glass-table-row self" : "glass-table-row"} style={{
                                        backgroundColor: isLocalGuest ? 'rgba(255, 215, 0, 0.05)' : 'transparent'
                                      }}>
                                        <td style={{ fontWeight: 800, fontSize: idx < 3 ? '1.2rem' : '0.9rem', color: isLocalGuest ? '#ffd700' : '#ffffff' }}>{medal}</td>
                                        <td>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: isRtl ? 'flex-end' : 'flex-start' }}>
                                            <span style={{ fontWeight: isLocalGuest ? 800 : 500, color: isLocalGuest ? '#ffd700' : '#ffffff' }}>
                                              {entry.username}
                                            </span>
                                            {isLocalGuest && (
                                              <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: 'rgba(255, 215, 0, 0.2)', border: '1px solid #ffd700', borderRadius: '4px', color: '#ffd700', fontWeight: 800 }}>
                                                {isRtl ? 'أنت' : 'YOU'}
                                              </span>
                                            )}
                                          </div>
                                        </td>
                                        <td style={{ fontWeight: 700, color: isLocalGuest ? '#ffd700' : '#00f5ff' }}>{entry.score}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {/* Round-by-Round Breakdown Matrix */}
                        <div style={{ ...styles.rewardsPanelCard, gap: '16px', margin: 0, flexShrink: 0 }}>
                          <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--primary)', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '10px', margin: 0 }}>
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
                                        {getLocalizedText(r.questionBody)}
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
                                        {getLocalizedText(r.questionBody)}
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

                        {/* Social Share Buttons */}
                        <div style={{ ...styles.rewardsPanelCard, gap: '12px', margin: 0, flexShrink: 0 }}>
                          <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>
                            {t.shareResult}
                          </span>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button 
                              onClick={shareToTwitter}
                              style={{
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px',
                                padding: '10px',
                                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                borderRadius: '8px',
                                color: '#ffffff',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: 'bold',
                                transition: 'all 0.2s ease'
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; e.currentTarget.style.borderColor = '#00f2fe'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)'; e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'; }}
                            >
                              𝕏 Twitter
                            </button>
                            <button 
                              onClick={shareToWhatsApp}
                              style={{
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px',
                                padding: '10px',
                                backgroundColor: 'rgba(37, 211, 102, 0.08)',
                                border: '1px solid rgba(37, 211, 102, 0.2)',
                                borderRadius: '8px',
                                color: '#25D366',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: 'bold',
                                transition: 'all 0.2s ease'
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(37, 211, 102, 0.15)'; e.currentTarget.style.borderColor = '#25D366'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(37, 211, 102, 0.08)'; e.currentTarget.style.borderColor = 'rgba(37, 211, 102, 0.2)'; }}
                            >
                              💬 WhatsApp
                            </button>
                            <button 
                              onClick={copyToClipboard}
                              style={{
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px',
                                padding: '10px',
                                backgroundColor: 'rgba(0, 242, 254, 0.08)',
                                border: '1px solid rgba(0, 242, 254, 0.2)',
                                borderRadius: '8px',
                                color: '#00f2fe',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: 'bold',
                                transition: 'all 0.2s ease'
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0, 242, 254, 0.15)'; e.currentTarget.style.borderColor = '#00f2fe'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0, 242, 254, 0.08)'; e.currentTarget.style.borderColor = 'rgba(0, 242, 254, 0.2)'; }}
                            >
                              🔗 {isRtl ? 'نسخ' : 'Copy'}
                            </button>
                          </div>
                        </div>

                      </div>

                      {/* Fixed Footer */}
                      <div style={{ ...styles.summaryFooter, flexShrink: 0 }}>
                        <button style={styles.returnHubBtn} onClick={() => { playSFX('click'); setScreen('dashboard'); setVotingActive(false); setVotingWinners(null); setMyVotes({}); setLiveVotes({}); }}>
                          {t.dashboardBtn}
                        </button>
                      </div>

                      {/* Copied Clipboard Toast */}
                      {copiedToastVisible && (
                        <div style={{
                          position: 'absolute',
                          bottom: '80px',
                          left: '50%',
                          transform: 'translateX(-50%)',
                          backgroundColor: '#00f2fe',
                          color: '#05060f',
                          padding: '10px 20px',
                          borderRadius: '20px',
                          fontSize: '0.9rem',
                          fontWeight: 'bold',
                          boxShadow: '0 4px 15px rgba(0, 242, 254, 0.4)',
                          zIndex: 10000,
                          pointerEvents: 'none',
                          transition: 'opacity 0.2s ease'
                        }}>
                          {t.copiedToast}
                        </div>
                      )}
                    </>
                  )}

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

        {/* POWER-UP STORE MODAL */}
        {showStoreModal && (
          <div style={customStyles.alertOverlay}>
            <div style={{ ...customStyles.alertBox, border: `2px solid #00f2fe`, boxShadow: `0 0 20px #00f2fe40, inset 0 0 10px #00f2fe15`, maxWidth: '450px' }}>
              <div style={customStyles.alertHeader}>
                <span style={{ ...customStyles.alertTitle, color: '#00f2fe' }}>
                  🛒 {isRtl ? 'متجر المساعدات' : 'POWER-UP SHOP'}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: '0.85rem', color: '#ffd700', fontWeight: 'bold' }}>
                  🪙 {user?.coins || 0}
                </span>
              </div>
              <div style={{ ...customStyles.alertBody, maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', padding: '16px' }}>
                {ALL_POWER_UPS.map((pu) => {
                  const isSoloMode = gameMode === 'TIMED_CHALLENGE' || gameMode === 'SURVIVAL';
                  const isDisabledInSolo = isSoloMode && (pu.type === 'FREEZE' || pu.type === 'STEAL' || pu.type === 'BLOCK_POWER_UP');
                  
                  return (
                    <div
                      key={pu.type}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px',
                        backgroundColor: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '8px',
                        opacity: isDisabledInSolo ? 0.4 : 1
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
                        <span style={{ fontWeight: 'bold', color: '#f0f4ff', fontSize: '0.85rem' }}>{pu.label}</span>
                        <span style={{ color: 'rgba(240, 244, 255, 0.6)', fontSize: '0.75rem' }}>
                          {pu.desc} {isDisabledInSolo && `(${isRtl ? 'غير متاح فردي' : 'Solo Disabled'})`}
                        </span>
                      </div>
                      <button
                        disabled={isDisabledInSolo || (user?.coins || 0) < pu.cost}
                        onClick={() => { playSFX('click'); purchasePowerUp(pu.type); }}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '6px',
                          backgroundColor: isDisabledInSolo ? 'rgba(255,255,255,0.05)' : (user?.coins || 0) >= pu.cost ? '#00f2fe' : 'rgba(255,255,255,0.05)',
                          color: isDisabledInSolo ? 'rgba(255,255,255,0.3)' : (user?.coins || 0) >= pu.cost ? '#05060f' : 'rgba(255,255,255,0.3)',
                          border: 'none',
                          cursor: (isDisabledInSolo || (user?.coins || 0) < pu.cost) ? 'not-allowed' : 'pointer',
                          fontSize: '0.8rem',
                          fontWeight: 'bold',
                          minWidth: '80px'
                        }}
                      >
                        {pu.cost} 🪙
                      </button>
                    </div>
                  );
                })}
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
                    fontSize: '0.85rem',
                    textAlign: 'center'
                  }}
                  onClick={() => { playSFX('click'); setShowStoreModal(false); }}
                >
                  {isRtl ? 'إغلاق' : 'Close'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* NICKNAME ONBOARDING MODAL */}
        {showNicknameModal && (
          <div style={customStyles.alertOverlay}>
            <div style={{ ...customStyles.alertBox, border: `2px solid #ffd700`, boxShadow: `0 0 20px #ffd70040, inset 0 0 10px #ffd70015` }}>
              <div style={customStyles.alertHeader}>
                <span style={{ ...customStyles.alertTitle, color: '#ffd700' }}>
                  📢 {isRtl ? 'الانضمام كمتفرج من الجمهور' : 'JOIN AS AUDIENCE SPECTATOR'}
                </span>
              </div>
              <div style={{ ...customStyles.alertBody, display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
                <p style={{ ...customStyles.alertMessage, textAlign: 'center', margin: 0, fontSize: '0.85rem', color: '#a0a7cc' }}>
                  {isRtl ? 'يرجى إدخال اسم مستعار للمشاركة في توقعات البث والحصول على مركز في لوحة الصدارة!' : 'Please enter a nickname to participate in stream trivia and secure a spot on the leaderboard!'}
                </p>
                <input
                  type="text"
                  placeholder={isRtl ? 'الاسم المستعار...' : 'Enter nickname...'}
                  value={audienceNickname}
                  onChange={(e) => setAudienceNickname(e.target.value)}
                  style={{
                    width: '100%',
                    backgroundColor: '#05060f',
                    color: '#ffffff',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '8px',
                    padding: '10px 14px',
                    fontSize: '0.9rem',
                    textAlign: 'center',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleJoinAsAudienceGuest(audienceNickname);
                    }
                  }}
                />
              </div>
              <div style={{ display: 'flex', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <button
                  style={{
                    flex: 1,
                    padding: '12px',
                    backgroundColor: '#ffd700',
                    color: '#05060f',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    fontWeight: 'bold',
                    transition: 'all 0.15s ease'
                  }}
                  onClick={() => handleJoinAsAudienceGuest(audienceNickname)}
                >
                  {isRtl ? 'انضمام الآن' : 'Join Now'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PLAYER PROFILE DASHBOARD MODAL */}
        {user && (
          <PlayerProfileModal 
            user={user as any}
            isOpen={isProfileModalOpen}
            onClose={() => setIsProfileModalOpen(false)}
            isRtl={isRtl}
          />
        )}

        {/* COSMETIC SHOP MODAL */}
        {user && (
          <CosmeticShopModal
            user={user}
            isOpen={isShopOpen}
            onClose={() => setIsShopOpen(false)}
            isRtl={isRtl}
            refreshProfile={refreshProfile}
            triggerAlert={triggerGamingAlert}
            playSFX={playSFX}
          />
        )}

        {/* SETTINGS MODAL */}
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          sfxEnabled={sfxEnabled}
          setSfxEnabled={setSfxEnabled}
          sfxVolume={sfxVolume}
          setSfxVolume={setSfxVolume}
          isRtl={isRtl}
          setIsRtl={setIsRtl}
          playSFX={playSFX}
        />

        {/* ONBOARDING TUTORIAL */}
        <OnboardingTutorial
          isOpen={showOnboarding}
          onClose={() => setShowOnboarding(false)}
          isRtl={isRtl}
        />

        {/* ADMIN MODERATION MODAL */}
        <AdminModerationModal
          isOpen={isAdminModalOpen}
          onClose={() => setIsAdminModalOpen(false)}
          isRtl={isRtl}
          playSFX={playSFX}
        />

        {/* RANK UP CELEBRATION OVERLAY */}
        {rankUpCelebration?.show && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(5, 6, 10, 0.95)',
            backdropFilter: 'blur(15px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1001,
            animation: 'fadeIn 0.5s ease-out'
          }}>
            {/* Pulsing golden/solar background rays */}
            <div style={{
              position: 'absolute',
              width: '400px',
              height: '400px',
              background: 'radial-gradient(circle, rgba(255, 215, 0, 0.15) 0%, transparent 70%)',
              filter: 'blur(30px)',
              pointerEvents: 'none',
              animation: 'pulse-glow 3s infinite ease-in-out',
              zIndex: 1
            }} />

            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '24px',
              zIndex: 2,
              textAlign: 'center',
              padding: '40px',
              backgroundColor: 'rgba(15, 18, 30, 0.65)',
              border: '2px solid rgba(255, 215, 0, 0.25)',
              borderRadius: '24px',
              boxShadow: '0 0 50px rgba(255, 215, 0, 0.15)',
              maxWidth: '450px',
              boxSizing: 'border-box'
            }} className="glass-panel">
              <span style={{ fontSize: '4.5rem', filter: 'drop-shadow(0 0 10px rgba(255,215,0,0.4))' }} className="animate-float">✨🏆✨</span>
              <h1 style={{
                fontSize: '3rem',
                fontWeight: 900,
                color: '#ffffff',
                textShadow: '0 0 15px rgba(255, 215, 0, 0.6)',
                margin: '0',
                letterSpacing: '2px'
              }} className="text-glow">
                {isRtl ? 'ترقية الرتبة!' : 'RANK UP!'}
              </h1>
              
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '16px',
                margin: '12px 0'
              }}>
                <div style={{ opacity: 0.65, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <RankBadge rank={rankUpCelebration.oldRank} size={70} animate={false} />
                  <span style={{ fontSize: '0.8rem', color: '#a0aec0', marginTop: '4px' }}>{rankUpCelebration.oldRank}</span>
                </div>
                
                <span style={{
                  fontSize: '2.5rem',
                  fontWeight: 'bold',
                  color: '#ffd700',
                  textShadow: '0 0 10px rgba(255,215,0,0.5)',
                  animation: 'float 2s ease-in-out infinite'
                }}>
                  ➔
                </span>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <RankBadge rank={rankUpCelebration.newRank} size={150} animate={true} />
                  <span style={{ 
                    fontSize: '1.2rem', 
                    fontWeight: 900, 
                    color: '#ffffff',
                    textShadow: '0 0 12px rgba(255,215,0,0.5)',
                    marginTop: '6px'
                  }}>{rankUpCelebration.newRank}</span>
                </div>
              </div>

              <p style={{ color: '#8a93c0', fontSize: '0.95rem', lineHeight: 1.5, margin: '0 0 10px 0' }}>
                {isRtl 
                  ? `تهانينا! لقد ارتفعت رتبتك من ${rankUpCelebration.oldRank} إلى ${rankUpCelebration.newRank}! استمر في التقدم والسيطرة على لوحة الصدارة.` 
                  : `Incredible skill! You have promoted from ${rankUpCelebration.oldRank} to ${rankUpCelebration.newRank}! Keep climbing and dominate the leaderboards.`}
              </p>

              <button 
                className="btn-cyber" 
                style={{
                  background: 'linear-gradient(135deg, #ffd700 0%, #d97706 100%)',
                  boxShadow: '0 0 15px rgba(255, 215, 0, 0.4)',
                  border: 'none',
                  color: '#05060f',
                  fontWeight: 800,
                  fontSize: '1rem',
                  padding: '12px 36px',
                  borderRadius: '12px',
                  cursor: 'pointer'
                }}
                onClick={() => { playSFX('click'); setRankUpCelebration(null); }}
              >
                {isRtl ? 'ادعاء النصر' : 'CLAIM GLORY'}
              </button>
            </div>
          </div>
        )}

        {/* BADGE UNLOCK CELEBRATION OVERLAY */}
        {unlockedBadge?.show && (() => {
          const badge = BADGES_METADATA.find(b => b.key === unlockedBadge.key);
          if (!badge) return null;
          return (
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              backgroundColor: 'rgba(5, 6, 10, 0.95)',
              backdropFilter: 'blur(15px)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1002,
              animation: 'fadeIn 0.5s ease-out'
            }}>
              {/* Pulsing cyan background rays */}
              <div style={{
                position: 'absolute',
                width: '450px',
                height: '450px',
                background: 'radial-gradient(circle, rgba(0, 242, 254, 0.15) 0%, transparent 70%)',
                filter: 'blur(30px)',
                pointerEvents: 'none',
                animation: 'pulse-glow 3s infinite ease-in-out',
                zIndex: 1
              }} />

              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '24px',
                zIndex: 2,
                textAlign: 'center',
                padding: '40px',
                backgroundColor: 'rgba(15, 18, 30, 0.65)',
                border: '2px solid rgba(0, 242, 254, 0.25)',
                borderRadius: '24px',
                boxShadow: '0 0 50px rgba(0, 242, 254, 0.15)',
                maxWidth: '450px',
                boxSizing: 'border-box'
              }} className="glass-panel">
                <span style={{ 
                  fontSize: '5rem', 
                  filter: 'drop-shadow(0 0 15px rgba(0,242,254,0.4))',
                  animation: 'float 3s ease-in-out infinite',
                  display: 'inline-block'
                }}>
                  {badge.icon}
                </span>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{
                    fontSize: '0.9rem',
                    fontWeight: 'bold',
                    color: '#00f2fe',
                    letterSpacing: '1.5px',
                    textTransform: 'uppercase'
                  }}>
                    {isRtl ? 'تم فتح إنجاز جديد!' : 'NEW ACHIEVEMENT UNLOCKED!'}
                  </span>
                  
                  <h1 style={{
                    fontSize: '2.5rem',
                    fontWeight: 900,
                    color: '#ffffff',
                    textShadow: '0 0 15px rgba(0, 242, 254, 0.6)',
                    margin: '0'
                  }} className="text-glow">
                    {isRtl ? badge.name.ar : badge.name.en}
                  </h1>
                </div>

                <p style={{
                  fontSize: '1rem',
                  color: '#a0aec0',
                  margin: '0',
                  lineHeight: 1.5,
                  maxWidth: '320px'
                }}>
                  {isRtl ? badge.desc.ar : badge.desc.en}
                </p>

                <button 
                  style={{
                    marginTop: '12px',
                    padding: '12px 32px',
                    background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
                    border: 'none',
                    borderRadius: '12px',
                    color: '#ffffff',
                    fontWeight: 'bold',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    boxShadow: '0 4px 15px rgba(0, 242, 254, 0.3)'
                  }}
                  onClick={() => {
                    playSFX('click');
                    setUnlockedBadge(null);
                  }}
                >
                  {isRtl ? 'رائع!' : 'Awesome!'}
                </button>
              </div>
            </div>
          );
        })()}

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
  shopBtn: {
    background: 'none',
    border: 'none',
    fontSize: '1.2rem',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
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
