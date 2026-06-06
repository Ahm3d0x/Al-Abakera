import { gradeAnswer } from '../lib/grading';
import { Question } from '@mind-race/shared';
import { spawn, ChildProcess } from 'child_process';
import { io as Client } from 'socket.io-client';

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
  
  await test('Integration: Server socket connection and guest login', async () => {
    let serverProc: ChildProcess | null = null;
    try {
      console.log('🔄 Launching API Gateway in test mode...');
      serverProc = spawn('npx', ['ts-node', 'src/index.ts'], {
        env: { ...process.env, PORT: '5999', REDIS_URL: '' },
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

      // Connect a mock guest socket client
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

      console.log('✅ Guest client connected successfully.');
    } finally {
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
