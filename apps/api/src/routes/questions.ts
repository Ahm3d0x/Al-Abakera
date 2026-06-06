import { Router, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { gradeAnswer } from '../lib/grading';
import { Question } from '@mind-race/shared';
import { getCachedData, setCachedData, invalidateCachePattern } from '../lib/cache';


const STATIC_FALLBACK_QUESTIONS: any[] = [
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
    correct_answer: 'c',
    rating: 4.8
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
    correct_answer: 'true',
    rating: 4.5
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
    correct_answer: '3.14',
    rating: 4.2
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
    ordering_items: ['2', '1', '4', '3'],
    explanation: {
      en: 'Mercury is closest, followed by Venus, Earth, and Mars.',
      ar: 'عطارد هو الأقرب، يليه الزهرة، ثم الأرض، وأخيراً المريخ.'
    },
    rating: 4.6
  },
  {
    id: 'q5',
    type: 'MATCHING_QUESTION',
    category: 'Technology / التقنية',
    body: {
      en: 'Match the programming terms with their definitions.',
      ar: 'صل المصطلحات البرمجية بالتعريفات المناسبة لها.'
    },
    matching_pairs: [
      { leftId: 'v', leftText: { en: 'Variable', ar: 'المتغير' }, rightId: '1', rightText: { en: 'Stores data', ar: 'يخزن البيانات' } },
      { leftId: 'f', leftText: { en: 'Function', ar: 'الدالة' }, rightId: '2', rightText: { en: 'Reusable block', ar: 'كتلة برمجية يعاد استخدامها' } },
      { leftId: 'l', leftText: { en: 'Loop', ar: 'التكرار' }, rightId: '3', rightText: { en: 'Repeats instructions', ar: 'يكرر التعليمات البرمجية' } }
    ],
    difficulty: 'Medium',
    explanation: {
      en: 'Variables store data, functions are reusable blocks, and loops repeat instructions.',
      ar: 'المتغيرات تخزن البيانات، الدوال كتل يعاد استخدامها، والتكرار يكرر الأوامر.'
    },
    rating: 4.7
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
    correct_answer: ['a', 'b', 'd'],
    explanation: {
      en: '2, 3, and 11 have no divisors other than 1 and themselves. 9 is divisible by 3.',
      ar: 'الأعداد 2 و 3 و 11 لا تقبل القسمة إلا على نفسها وعلى 1. العدد 9 يقبل القسمة على 3.'
    },
    rating: 4.4
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
      en: "Using Ohm's law (I = V / R), Current = 12V / 4 Ohms = 3 Amperes.",
      ar: 'باستخدام قانون أوم (ت = جـ / م)، التيار = 12 / 4 = 3 أمبير.'
    },
    correct_answer: '3',
    rating: 4.3
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
      { id: 'a', text: { en: '20 Ohms', ar: '20 أوم' } },
      { id: 'b', text: { en: '5 Ohms', ar: '5 أوم' } },
      { id: 'c', text: { en: '10 Ohms', ar: '10 أوم' } }
    ],
    difficulty: 'Medium',
    correct_answer: 'b',
    explanation: {
      en: 'For parallel resistors: R_eq = (R1 * R2) / (R1 + R2) = 100 / 20 = 5 Ohms.',
      ar: 'للمقاومات على التوازي: م المكافئة = (م1 * م2) / (م1 + م2) = 100 / 20 = 5 أوم.'
    },
    rating: 4.5
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
    correct_answer: 'b',
    explanation: {
      en: 'Benzene (C6H6) is represented by a hexagonal ring with a circle or alternating double bonds.',
      ar: 'البنزين العطري (C6H6) يمثل بحلقة سداسية تحتوي على روابط ثنائية متبادلة.'
    },
    rating: 4.8
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
    coding_test_cases: [
      { input: 'sum(2, 3)', output: '5' }
    ],
    explanation: {
      en: 'A simple return statement: function sum(a, b) { return a + b; }',
      ar: 'دالة بسيطة تعيد الناتج مباشرة: function sum(a, b) { return a + b; }'
    },
    correct_answer: 'function sum(a, b) {\n  return a + b;\n}',
    rating: 4.9
  }
];

const router = Router();

/**
 * Sanitizes the question payload to remove answer keys if the user is a player.
 */
function sanitizeQuestion(q: any, isStaff: boolean) {
  if (!q) return q;
  if (!isStaff) {
    const { correct_answer, correctAnswer, coding_test_cases, codingTestCases, ...rest } = q;
    return rest;
  }
  return q;
}

// 1. List questions (filtered by category, difficulty, type)
router.get('/', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const { category, difficulty, type } = req.query;
  const isStaff = !!(req.profile?.isAdmin || req.profile?.isTeacher);
  const cacheKey = `questions:list:cat_${category || 'all'}:diff_${difficulty || 'all'}:type_${type || 'all'}:staff_${isStaff}`;

  try {
    const cached = await getCachedData(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    let dbQuery = supabaseAdmin.from('questions').select('*');

    if (category) {
      dbQuery = dbQuery.eq('category', String(category));
    }
    if (difficulty) {
      dbQuery = dbQuery.eq('difficulty', String(difficulty));
    }
    if (type) {
      dbQuery = dbQuery.eq('type', String(type));
    }

    const { data: questions, error } = await dbQuery;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const sanitized = (questions || []).map((q: any) => sanitizeQuestion(q, isStaff));
    
    await setCachedData(cacheKey, sanitized, 300); // 5 minutes cache

    return res.json(sanitized);
  } catch (err) {
    console.error('List questions endpoint error:', err);
    return res.status(500).json({ error: 'Internal server error listing questions' });
  }
});

// 1.5. Get Daily Challenge questions (deterministic calendar seed)
router.get('/daily', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const isStaff = !!(req.profile?.isAdmin || req.profile?.isTeacher);
  const todayStr = new Date().toISOString().split('T')[0];
  const cacheKey = `questions:daily:${todayStr}:staff_${isStaff}`;

  try {
    const cached = await getCachedData(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const { data: questions, error } = await supabaseAdmin
      .from('questions')
      .select('*');

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!questions || questions.length === 0) {
      // Fallback sample questions
      const fallbackQs = [
        {
          id: 'q1_daily',
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
          correct_answer: 'c',
          rating: 4.8
        },
        {
          id: 'q2_daily',
          type: 'TRUE_FALSE',
          category: 'Physics / الفيزياء',
          body: 'Sound waves travel faster in water than in air.\nتنتقل الموجات الصوتية في الماء بسرعة أكبر من انتقالها في الهواء.',
          difficulty: 'Easy',
          explanation: 'Because water is denser than air, sound travels about 4.3 times faster in it.\nلأن الماء أكثر كثافة من الهواء، ينتقل الصوت فيه بسرعة أكبر بنحو 4.3 أضعاف.',
          correct_answer: 'true',
          rating: 4.5
        },
        {
          id: 'q3_daily',
          type: 'FILL_IN_THE_BLANK',
          category: 'Math / الرياضيات',
          body: 'What is the value of Pi rounded to two decimal places?\nما هي قيمة ثابت بّاي (Pi) مقربة لعددين عشريين؟',
          difficulty: 'Easy',
          explanation: 'Pi is approximately 3.14159..., which rounds to 3.14.\nثابت باي هو تقريباً 3.14159... والذي يقرب إلى 3.14.',
          correct_answer: '3.14',
          rating: 4.2
        }
      ];
      return res.json(fallbackQs);
    }

    // Determine deterministic seed based on current date string YYYY-MM-DD
    let seed = 0;
    for (let i = 0; i < todayStr.length; i++) {
      seed += todayStr.charCodeAt(i);
    }

    const dailyQuestions = [];
    const count = questions.length;
    for (let i = 0; i < Math.min(5, count); i++) {
      const index = (seed + i * 7) % count;
      dailyQuestions.push(questions[index]);
    }

    const sanitized = dailyQuestions.map((q) => sanitizeQuestion(q, isStaff));

    await setCachedData(cacheKey, sanitized, 3600); // 1 hour cache

    return res.json(sanitized);
  } catch (err) {
    console.error('Daily challenge endpoint error:', err);
    return res.status(500).json({ error: 'Internal server error getting daily challenge' });
  }
});

// 2. Get single question
router.get('/:id', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const isStaff = !!(req.profile?.isAdmin || req.profile?.isTeacher);

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (!isUuid) {
    const staticQ = STATIC_FALLBACK_QUESTIONS.find(q => q.id === id);
    if (!staticQ) {
      return res.status(404).json({ error: 'Question not found' });
    }
    return res.json(sanitizeQuestion(staticQ, isStaff));
  }

  const cacheKey = `questions:single:${id}:staff_${isStaff}`;

  try {
    const cached = await getCachedData(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const { data: question, error } = await supabaseAdmin
      .from('questions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Question not found' });
      }
      return res.status(500).json({ error: error.message });
    }

    const sanitized = sanitizeQuestion(question, isStaff);
    await setCachedData(cacheKey, sanitized, 300); // 5 minutes cache

    return res.json(sanitized);
  } catch (err) {
    console.error('Get question endpoint error:', err);
    return res.status(500).json({ error: 'Internal server error getting question' });
  }
});

// 3. Create question (Staff only)
router.post('/', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const isStaff = !!(req.profile?.isAdmin || req.profile?.isTeacher);
  if (!isStaff) {
    return res.status(403).json({ error: 'Forbidden: Only admins or teachers can create questions' });
  }

  const {
    type,
    category,
    body,
    image_url,
    options,
    correct_answer,
    ordering_items,
    matching_pairs,
    coding_test_cases,
    difficulty,
    explanation,
  } = req.body;

  if (!type || !category || !body) {
    return res.status(400).json({ error: 'Missing required fields: type, category, body' });
  }

  try {
    const { data: question, error } = await supabaseAdmin
      .from('questions')
      .insert({
        type,
        category,
        body,
        image_url,
        options,
        correct_answer,
        ordering_items,
        matching_pairs,
        coding_test_cases,
        difficulty: difficulty || 'Medium',
        explanation,
        created_by: req.profile?.id,
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Invalidate questions cache
    await invalidateCachePattern('questions:');

    return res.status(201).json(question);
  } catch (err) {
    console.error('Create question endpoint error:', err);
    return res.status(500).json({ error: 'Internal server error creating question' });
  }
});

// 4. Update question (Staff only)
router.put('/:id', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const isStaff = !!(req.profile?.isAdmin || req.profile?.isTeacher);
  if (!isStaff) {
    return res.status(403).json({ error: 'Forbidden: Only admins or teachers can update questions' });
  }

  const { id } = req.params;
  const updatePayload = req.body;

  try {
    const { data: question, error } = await supabaseAdmin
      .from('questions')
      .update({
        ...updatePayload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Invalidate questions cache
    await invalidateCachePattern('questions:');

    return res.json(question);
  } catch (err) {
    console.error('Update question endpoint error:', err);
    return res.status(500).json({ error: 'Internal server error updating question' });
  }
});

// 5. Delete question (Staff only)
router.delete('/:id', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const isStaff = !!(req.profile?.isAdmin || req.profile?.isTeacher);
  if (!isStaff) {
    return res.status(403).json({ error: 'Forbidden: Only admins or teachers can delete questions' });
  }

  const { id } = req.params;

  try {
    const { error } = await supabaseAdmin.from('questions').delete().eq('id', id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Invalidate questions cache
    await invalidateCachePattern('questions:');

    return res.json({ status: 'success', message: 'Question deleted successfully' });
  } catch (err) {
    console.error('Delete question endpoint error:', err);
    return res.status(500).json({ error: 'Internal server error deleting question' });
  }
});

// 6. Rate a question (5-star system, 1–5 integer, authenticated players)
router.post('/:id/rate', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { rating: userRating } = req.body;

  const ratingNum = Number(userRating);
  if (!userRating || isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5 || !Number.isInteger(ratingNum)) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (!isUuid) {
    return res.status(404).json({ error: 'Question not found or is a static question' });
  }

  try {
    // Fetch current rating values
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('questions')
      .select('rating, rating_count')
      .eq('id', id)
      .single();

    if (fetchErr || !existing) {
      return res.status(404).json({ error: 'Question not found' });
    }

    // Compute rolling average: newAvg = (oldAvg * oldCount + newRating) / (oldCount + 1)
    const oldCount = Number(existing.rating_count) || 0;
    const oldAvg = Number(existing.rating) || 0;
    const newCount = oldCount + 1;
    const newAvg = Number(((oldAvg * oldCount + ratingNum) / newCount).toFixed(2));

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('questions')
      .update({ rating: newAvg, rating_count: newCount })
      .eq('id', id)
      .select('id, rating, rating_count')
      .single();

    if (updateErr) {
      return res.status(500).json({ error: updateErr.message });
    }

    // Invalidate questions cache
    await invalidateCachePattern('questions:');

    return res.json({ status: 'success', id: updated.id, rating: updated.rating, ratingCount: updated.rating_count });
  } catch (err) {
    console.error('Rate question endpoint error:', err);
    return res.status(500).json({ error: 'Internal server error rating question' });
  }
});

// 7. Get all available question categories (for UI category pickers & weighting config)
router.get('/meta/categories', requireAuth as any, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('questions')
      .select('category');

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const categories = [...new Set((data || []).map((q: any) => q.category))].sort();
    return res.json({ categories });
  } catch (err) {
    console.error('Categories endpoint error:', err);
    return res.status(500).json({ error: 'Internal server error getting categories' });
  }
});

// 8. Grade submission for a question
router.post('/:id/grade', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { answer } = req.body;

  if (answer === undefined) {
    return res.status(400).json({ error: 'Missing answer parameter in request body' });
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (!isUuid) {
    const staticQ = STATIC_FALLBACK_QUESTIONS.find(q => q.id === id);
    if (!staticQ) {
      return res.status(404).json({ error: 'Question not found' });
    }

    const mappedQ: Question = {
      id: staticQ.id,
      type: staticQ.type,
      category: staticQ.category,
      body: staticQ.body,
      imageUrl: staticQ.imageUrl,
      options: staticQ.options,
      correctAnswer: staticQ.correct_answer,
      orderingItems: staticQ.ordering_items,
      matchingPairs: staticQ.matching_pairs,
      codingTestCases: staticQ.coding_test_cases,
      difficulty: staticQ.difficulty,
      rating: staticQ.rating,
      explanation: staticQ.explanation,
      createdAt: new Date()
    };

    try {
      const gradingResult = await gradeAnswer(mappedQ, answer);
      const isStaff = !!(req.profile?.isAdmin || req.profile?.isTeacher);
      if (!isStaff) {
        delete gradingResult.correctAnswer;
      }
      return res.json(gradingResult);
    } catch (e) {
      console.error('Static grading exception:', e);
      return res.status(500).json({ error: 'Internal server error grading fallback question' });
    }
  }

  try {
    const { data: question, error } = await supabaseAdmin
      .from('questions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Question not found' });
      }
      return res.status(500).json({ error: error.message });
    }

    const gradingResult = await gradeAnswer(question as Question, answer);
    
    // Clean correct answers from result if not staff (standard match rules)
    const isStaff = !!(req.profile?.isAdmin || req.profile?.isTeacher);
    if (!isStaff) {
      delete gradingResult.correctAnswer;
    }

    return res.json(gradingResult);
  } catch (err) {
    console.error('Grade question endpoint error:', err);
    return res.status(500).json({ error: 'Internal server error grading question' });
  }
});

export default router;
