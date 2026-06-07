import { gradeAnswer } from '../lib/grading';
import { Question } from '@mind-race/shared';
import { spawn, ChildProcess } from 'child_process';
import { io as Client } from 'socket.io-client';
import { supabaseAdmin } from '../lib/supabase';

let totalTests = 0;
let passedTests = 0;

async function test(name: string, fn: () => Promise<void>) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`✅ [PASS] ${name}`);
  } catch (err: any) {
    console.error(`❌ [FAIL] ${name}`);
    console.error(err);
  }
}

function expect(actual: any) {
  return {
    toBe(expected: any) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
    toContain(expected: string) {
      if (typeof actual !== 'string' || !actual.includes(expected)) {
        throw new Error(`Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`);
      }
    }
  };
}

async function runAll() {
  console.log(`\n=================================================`);
  console.log(`🧪 MindRace Automated Test Runner`);
  console.log(`=================================================\n`);

  // ==========================================
  // Unit Tests: Grading Engine
  // ==========================================
  
  await test('Unit: Missing correct answer fallback', async () => {
    const question = {
      id: 'q1',
      type: 'MULTIPLE_CHOICE',
    };
    const res = await gradeAnswer(question as Question, 'a');
    expect(res.isCorrect).toBe(false);
    expect(res.score).toBe(0);
    expect(res.explanation).toContain('No correct answer configuration');
  });

  await test('Unit: MULTIPLE_CHOICE / IMAGE_QUESTION grading', async () => {
    const question = {
      id: 'q_mcq',
      type: 'MULTIPLE_CHOICE',
      correctAnswer: 'c',
      explanation: { en: 'Diamond is the hardest.', ar: 'الماس هو الأقسى.' }
    };

    const correctRes = await gradeAnswer(question as Question, 'c');
    expect(correctRes.isCorrect).toBe(true);
    expect(correctRes.score).toBe(100);
    expect((correctRes.explanation as any).en).toBe('Diamond is the hardest.');

    const correctCaseRes = await gradeAnswer(question as Question, 'C');
    expect(correctCaseRes.isCorrect).toBe(true);

    const wrongRes = await gradeAnswer(question as Question, 'b');
    expect(wrongRes.isCorrect).toBe(false);
    expect(wrongRes.score).toBe(0);
  });

  await test('Unit: TRUE_FALSE grading', async () => {
    const question = {
      id: 'q_tf',
      type: 'TRUE_FALSE',
      correctAnswer: 'true'
    };

    const res1 = await gradeAnswer(question as Question, 'true');
    expect(res1.isCorrect).toBe(true);

    const res2 = await gradeAnswer(question as Question, 'TRUE ');
    expect(res2.isCorrect).toBe(true);

    const res3 = await gradeAnswer(question as Question, 'false');
    expect(res3.isCorrect).toBe(false);
  });

  await test('Unit: FILL_IN_THE_BLANK grading', async () => {
    const questionSingle = {
      id: 'q_fitb_1',
      type: 'FILL_IN_THE_BLANK',
      correctAnswer: 'Oxygen'
    };

    const res1 = await gradeAnswer(questionSingle as Question, 'oxygen');
    expect(res1.isCorrect).toBe(true);

    const res2 = await gradeAnswer(questionSingle as Question, ' hydrogen');
    expect(res2.isCorrect).toBe(false);

    const questionMulti = {
      id: 'q_fitb_2',
      type: 'FILL_IN_THE_BLANK',
      correctAnswer: ['carbon dioxide', 'co2']
    };

    const res3 = await gradeAnswer(questionMulti as Question, 'co2');
    expect(res3.isCorrect).toBe(true);

    const res4 = await gradeAnswer(questionMulti as Question, 'Carbon Dioxide');
    expect(res4.isCorrect).toBe(true);
  });

  await test('Unit: MULTI_SELECT grading', async () => {
    const question = {
      id: 'q_ms',
      type: 'MULTI_SELECT',
      correctAnswer: ['a', 'c']
    };

    const res1 = await gradeAnswer(question as Question, ['a', 'c']);
    expect(res1.isCorrect).toBe(true);

    const res2 = await gradeAnswer(question as Question, ['c', 'a']);
    expect(res2.isCorrect).toBe(true);

    const res3 = await gradeAnswer(question as Question, ['a']);
    expect(res3.isCorrect).toBe(false);
  });

  await test('Unit: CALCULATION_QUESTION grading with epsilon tolerance', async () => {
    const question = {
      id: 'q_calc',
      type: 'CALCULATION_QUESTION',
      correctAnswer: '3.14159'
    };

    const res1 = await gradeAnswer(question as Question, 3.14159);
    expect(res1.isCorrect).toBe(true);

    const res2 = await gradeAnswer(question as Question, '3.1415901');
    expect(res2.isCorrect).toBe(true);
  });

  await test('Unit: CODING_QUESTION sandbox validation', async () => {
    const question = {
      id: 'q_code',
      type: 'CODING_QUESTION',
      codingTestCases: [
        { input: '[2, 3]', output: '5' }
      ]
    };

    const correctCode = `function add(a, b) { return a + b; }`;
    const res1 = await gradeAnswer(question as Question, correctCode);
    expect(res1.isCorrect).toBe(true);

    const wrongCode = `function add(a, b) { return a - b; }`;
    const res2 = await gradeAnswer(question as Question, wrongCode);
    expect(res2.isCorrect).toBe(false);
  });

  // ==========================================
  // Integration Tests: WebSockets Game Flow
  // ==========================================
  
  await test('Integration: Gateway Socket Connection & Creator Question Pack CRUD', async () => {
    let serverProc: ChildProcess | null = null;
    let createdPackId: string | null = null;
    const createdQuestionIds: string[] = [];
    
    try {
      console.log('🔄 Launching API Gateway in test mode...');
      serverProc = spawn('npx', ['ts-node', 'src/index.ts'], {
        env: { ...process.env, PORT: '5999', REDIS_URL: '', NODE_ENV: 'test' },
        shell: true
      });

      // Wait for server to start listening
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Gateway startup timed out.'));
        }, 15000);

        serverProc?.stdout?.on('data', (data) => {
          const output = data.toString();
          if (output.includes('Core API is running!')) {
            clearTimeout(timeout);
            resolve();
          }
        });

        serverProc?.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      console.log('🌐 Connected to test API Gateway. Verifying connection...');

      // 1. Connect a mock guest socket client
      const socket = Client('http://localhost:5999', {
        transports: ['websocket'],
        forceNew: true,
        auth: {
          isAudience: true,
          username: 'tester-spectator'
        }
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.close();
          reject(new Error('Socket connection timed out.'));
        }, 5000);

        socket.on('connect', () => {
          clearTimeout(timeout);
          socket.close();
          resolve();
        });

        socket.on('connect_error', (err) => {
          clearTimeout(timeout);
          socket.close();
          reject(err);
        });
      });

      console.log('✅ Guest client connected successfully. Testing Creator Pack CRUD...');

      // 2. Get current user profile ID from API using test token bypass
      const meRes = await fetch('http://localhost:5999/api/v1/users/me', {
        headers: { Authorization: 'Bearer mock-test-token' }
      });
      expect(meRes.status).toBe(200);
      const meData: any = await meRes.json();
      const userId = meData.user.id;
      expect(typeof userId).toBe('string');

      console.log(`👤 Running pack tests as user: ${userId}. Creating test pack...`);

      // 3. Direct DB insert: Create a test pack
      const { data: testPack, error: packErr } = await supabaseAdmin
        .from('question_packs')
        .insert({
          creator_id: userId,
          title: 'Test Integration Pack',
          description: 'Used for endpoint integration testing',
          category: 'Science',
          is_public: false
        })
        .select()
        .single();

      if (packErr || !testPack) {
        throw new Error('Failed to seed test pack: ' + packErr?.message);
      }
      createdPackId = testPack.id;

      // 4. Test API POST /api/v1/packs/:id/questions (Add single question)
      console.log('🧪 Testing POST /api/v1/packs/:id/questions...');
      const addRes = await fetch(`http://localhost:5999/api/v1/packs/${createdPackId}/questions`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer mock-test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'MULTIPLE_CHOICE',
          body: { en: 'What is 2+2?', ar: 'ما هو 2+2؟' },
          options: [
            { id: 'a', text: { en: '3', ar: '3' } },
            { id: 'b', text: { en: '4', ar: '4' } }
          ],
          correctAnswer: 'b',
          difficulty: 'Easy',
          explanation: { en: 'Because 2+2 is 4.', ar: 'لأن 2+2 تساوي 4.' }
        })
      });
      expect(addRes.status).toBe(201);
      const addedQuestion: any = await addRes.json();
      expect(addedQuestion.type).toBe('MULTIPLE_CHOICE');
      expect(addedQuestion.body.en).toBe('What is 2+2?');
      const addedQId = addedQuestion.id;
      createdQuestionIds.push(addedQId);

      // Verify linking table
      const { data: linkData } = await supabaseAdmin
        .from('question_pack_items')
        .select('*')
        .eq('pack_id', createdPackId)
        .eq('question_id', addedQId)
        .maybeSingle();
      expect(!!linkData).toBe(true);

      // 5. Test API PUT /api/v1/packs/:id/questions/:questionId (Update question)
      console.log('🧪 Testing PUT /api/v1/packs/:id/questions/:questionId...');
      const updateRes = await fetch(`http://localhost:5999/api/v1/packs/${createdPackId}/questions/${addedQId}`, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer mock-test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          body: { en: 'What is 2+2 updated?', ar: 'ما هو 2+2 معدل؟' }
        })
      });
      expect(updateRes.status).toBe(200);
      const updatedQ: any = await updateRes.json();
      expect(updatedQ.body.en).toBe('What is 2+2 updated?');

      // 6. Test API POST /api/v1/packs/:id/questions/batch (Batch add questions)
      console.log('🧪 Testing POST /api/v1/packs/:id/questions/batch...');
      const batchRes = await fetch(`http://localhost:5999/api/v1/packs/${createdPackId}/questions/batch`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer mock-test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          questions: [
            {
              type: 'TRUE_FALSE',
              body: { en: 'The sky is blue', ar: 'السماء زرقاء' },
              correctAnswer: 'true',
              difficulty: 'Easy'
            },
            {
              type: 'FILL_IN_THE_BLANK',
              body: { en: 'Water formula is [blank]', ar: 'صيغة الماء هي [blank]' },
              correctAnswer: { en: 'h2o', ar: 'h2o' },
              difficulty: 'Medium'
            }
          ]
        })
      });
      expect(batchRes.status).toBe(201);
      const batchData: any = await batchRes.json();
      expect(Array.isArray(batchData)).toBe(true);
      expect(batchData.length).toBe(2);
      batchData.forEach((bq: any) => {
        createdQuestionIds.push(bq.id);
      });

      // 7. Test API DELETE /api/v1/packs/:id/questions/:questionId (Delete question)
      console.log('🧪 Testing DELETE /api/v1/packs/:id/questions/:questionId...');
      const deleteRes = await fetch(`http://localhost:5999/api/v1/packs/${createdPackId}/questions/${addedQId}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer mock-test-token' }
      });
      expect(deleteRes.status).toBe(200);

      // Verify deleted from DB
      const { data: deletedLink } = await supabaseAdmin
        .from('question_pack_items')
        .select('*')
        .eq('pack_id', createdPackId)
        .eq('question_id', addedQId)
        .maybeSingle();
      expect(deletedLink).toBe(null);

      console.log('✅ Pack CRUD & batch import endpoints tested successfully.');

    } finally {
      // Cleanup
      console.log('🧹 Cleaning up integration test resources...');
      if (createdPackId) {
        await supabaseAdmin.from('question_packs').delete().eq('id', createdPackId);
      }
      if (createdQuestionIds.length > 0) {
        await supabaseAdmin.from('questions').delete().in('id', createdQuestionIds);
      }
      if (serverProc) {
        console.log('🧹 Shutting down test API Gateway...');
        serverProc.kill('SIGINT');
      }
    }
  });

  console.log(`\n=================================================`);
  console.log(`📋 Test Execution Report: ${passedTests} / ${totalTests} Passed.`);
  console.log(`=================================================\n`);
  
  process.exit(passedTests === totalTests ? 0 : 1);
}

runAll().catch((err) => {
  console.error('Fatal testing exception:', err);
  process.exit(1);
});
