import { gradeAnswer } from './grading';
import { Question } from '@mind-race/shared';

const testQuestions: { question: any; correctSubmission: any; incorrectSubmission: any }[] = [
  {
    question: {
      id: 'q1',
      type: 'MULTIPLE_CHOICE',
      category: 'Science',
      body: 'Select option A',
      correctAnswer: 'opt-a',
      difficulty: 'Easy',
      rating: 0,
      createdAt: new Date(),
    },
    correctSubmission: 'opt-a',
    incorrectSubmission: 'opt-b',
  },
  {
    question: {
      id: 'q2',
      type: 'TRUE_FALSE',
      category: 'Science',
      body: 'Is water wet?',
      correctAnswer: 'true',
      difficulty: 'Easy',
      rating: 0,
      createdAt: new Date(),
    },
    correctSubmission: true,
    incorrectSubmission: 'false',
  },
  {
    question: {
      id: 'q3',
      type: 'IMAGE_QUESTION',
      category: 'Geography',
      body: 'What is this country?',
      correctAnswer: 'eg',
      difficulty: 'Medium',
      rating: 0,
      createdAt: new Date(),
    },
    correctSubmission: 'eg ',
    incorrectSubmission: 'us',
  },
  {
    question: {
      id: 'q4',
      type: 'ORDERING_QUESTION',
      category: 'History',
      body: 'Order the events',
      correctAnswer: ['first', 'second', 'third'],
      difficulty: 'Hard',
      rating: 0,
      createdAt: new Date(),
    },
    correctSubmission: ['first', 'second', 'third'],
    incorrectSubmission: ['first', 'third', 'second'],
  },
  {
    question: {
      id: 'q5',
      type: 'MATCHING_QUESTION',
      category: 'Math',
      body: 'Match left to right',
      matchingPairs: [
        { leftId: 'l1', leftText: 'One', rightId: 'r1', rightText: '1' },
        { leftId: 'l2', leftText: 'Two', rightId: 'r2', rightText: '2' },
      ],
      correctAnswer: null, // matchingPairs is primary in our matching engine
      difficulty: 'Medium',
      rating: 0,
      createdAt: new Date(),
    } as any,
    correctSubmission: { l1: 'r1', l2: 'r2' },
    incorrectSubmission: { l1: 'r2', l2: 'r1' },
  },
  {
    question: {
      id: 'q6',
      type: 'FILL_IN_THE_BLANK',
      category: 'Language',
      body: 'Fill in: Hello _____',
      correctAnswer: ['world', 'there'],
      difficulty: 'Easy',
      rating: 0,
      createdAt: new Date(),
    },
    correctSubmission: ' WORLD  ',
    incorrectSubmission: 'everyone',
  },
  {
    question: {
      id: 'q7',
      type: 'MULTI_SELECT',
      category: 'Science',
      body: 'Select multiple correct options',
      correctAnswer: ['opt-a', 'opt-c'],
      difficulty: 'Medium',
      rating: 0,
      createdAt: new Date(),
    },
    correctSubmission: ['opt-c', 'opt-a'],
    incorrectSubmission: ['opt-a', 'opt-b'],
  },
  {
    question: {
      id: 'q8',
      type: 'CALCULATION_QUESTION',
      category: 'Math',
      body: 'Compute 5 + 3',
      correctAnswer: 8.0,
      difficulty: 'Easy',
      rating: 0,
      createdAt: new Date(),
    } as any,
    correctSubmission: '8.000001',
    incorrectSubmission: 9,
  },
  {
    question: {
      id: 'q9',
      type: 'CIRCUIT_QUESTION',
      category: 'Electronics',
      body: 'Check circuit outputs',
      correctAnswer: { vOut: '5V', current: '2A' },
      difficulty: 'Hard',
      rating: 0,
      createdAt: new Date(),
    } as any,
    correctSubmission: { vOut: '5V', current: '2A' },
    incorrectSubmission: { vOut: '5V', current: '1A' },
  },
  {
    question: {
      id: 'q10',
      type: 'CODING_QUESTION',
      category: 'Programming',
      body: 'Write a function sum(a, b) that returns a + b',
      codingTestCases: [
        { input: '[2, 3]', output: '5' },
        { input: '[-1, 1]', output: '0' },
      ],
      correctAnswer: null,
      difficulty: 'Hard',
      rating: 0,
      createdAt: new Date(),
    } as any,
    correctSubmission: 'function sum(a, b) { return a + b; }',
    incorrectSubmission: 'function sum(a, b) { return a - b; }',
  },
];

async function runTests() {
  console.log('🧪 Starting automatic grading engine tests...');
  let failed = 0;

  for (const tc of testQuestions) {
    const type = tc.question.type;
    console.log(`\nTesting type: ${type}`);

    // 1. Correct submission test
    const correctRes = await gradeAnswer(tc.question, tc.correctSubmission);
    if (correctRes.isCorrect) {
      console.log(`   ✅ Correct answer pass`);
    } else {
      console.log(`   ❌ Correct answer fail: ${correctRes.explanation}`);
      failed++;
    }

    // 2. Incorrect submission test
    const incorrectRes = await gradeAnswer(tc.question, tc.incorrectSubmission);
    if (!incorrectRes.isCorrect) {
      console.log(`   ✅ Incorrect answer successfully rejected`);
    } else {
      console.log(`   ❌ Incorrect answer incorrectly marked as correct!`);
      failed++;
    }
  }

  console.log('\n=======================================');
  if (failed === 0) {
    console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
  } else {
    console.log(`❌ ${failed} TESTS FAILED.`);
    process.exit(1);
  }
  console.log('=======================================');
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
