import { gradeAnswer } from './grading';
import { Question } from '@mind-race/shared';

describe('automated grading engine (grading.ts)', () => {
  
  test('should fail if question config is missing correct answer', async () => {
    const question: Partial<Question> = {
      id: 'q1',
      type: 'MULTIPLE_CHOICE',
      correctAnswer: undefined
    };
    const res = await gradeAnswer(question as Question, 'a');
    expect(res.isCorrect).toBe(false);
    expect(res.score).toBe(0);
    expect(res.explanation).toContain('No correct answer configuration');
  });

  test('MULTIPLE_CHOICE / IMAGE_QUESTION grading', async () => {
    const question: Partial<Question> = {
      id: 'q_mcq',
      type: 'MULTIPLE_CHOICE',
      correctAnswer: 'c',
      explanation: { en: 'Diamond is the hardest.', ar: 'الماس هو الأقسى.' } as any
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

  test('TRUE_FALSE grading', async () => {
    const question: Partial<Question> = {
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

  test('FILL_IN_THE_BLANK grading (single & multiple correct answers)', async () => {
    const questionSingle: Partial<Question> = {
      id: 'q_fitb_1',
      type: 'FILL_IN_THE_BLANK',
      correctAnswer: 'Oxygen'
    };

    const res1 = await gradeAnswer(questionSingle as Question, 'oxygen');
    expect(res1.isCorrect).toBe(true);

    const res2 = await gradeAnswer(questionSingle as Question, ' hydrogen');
    expect(res2.isCorrect).toBe(false);

    const questionMulti: Partial<Question> = {
      id: 'q_fitb_2',
      type: 'FILL_IN_THE_BLANK',
      correctAnswer: ['carbon dioxide', 'co2'] as any
    };

    const res3 = await gradeAnswer(questionMulti as Question, 'co2');
    expect(res3.isCorrect).toBe(true);

    const res4 = await gradeAnswer(questionMulti as Question, 'Carbon Dioxide');
    expect(res4.isCorrect).toBe(true);

    const res5 = await gradeAnswer(questionMulti as Question, 'oxygen');
    expect(res5.isCorrect).toBe(false);
  });

  test('MULTI_SELECT grading', async () => {
    const question: Partial<Question> = {
      id: 'q_ms',
      type: 'MULTI_SELECT',
      correctAnswer: ['a', 'c'] as any
    };

    const res1 = await gradeAnswer(question as Question, ['a', 'c']);
    expect(res1.isCorrect).toBe(true);

    const res2 = await gradeAnswer(question as Question, ['c', 'a']);
    expect(res2.isCorrect).toBe(true); // Order-independent

    const res3 = await gradeAnswer(question as Question, ['a']);
    expect(res3.isCorrect).toBe(false);

    const res4 = await gradeAnswer(question as Question, ['a', 'b', 'c']);
    expect(res4.isCorrect).toBe(false);
  });

  test('ORDERING_QUESTION grading', async () => {
    const question: Partial<Question> = {
      id: 'q_ord',
      type: 'ORDERING_QUESTION',
      correctAnswer: ['2', '1', '3'] as any
    };

    const res1 = await gradeAnswer(question as Question, ['2', '1', '3']);
    expect(res1.isCorrect).toBe(true);

    const res2 = await gradeAnswer(question as Question, ['1', '2', '3']);
    expect(res2.isCorrect).toBe(false); // Order-dependent
  });

  test('MATCHING_QUESTION grading', async () => {
    const question: Partial<Question> = {
      id: 'q_match',
      type: 'MATCHING_QUESTION',
      matchingPairs: [
        { leftId: 'v', rightId: '1' },
        { leftId: 'f', rightId: '2' }
      ] as any
    };

    // Submitting as array of objects
    const res1 = await gradeAnswer(question as Question, [
      { leftId: 'v', rightId: '1' },
      { leftId: 'f', rightId: '2' }
    ]);
    expect(res1.isCorrect).toBe(true);

    // Submitting with wrong matching pair
    const res2 = await gradeAnswer(question as Question, [
      { leftId: 'v', rightId: '2' },
      { leftId: 'f', rightId: '1' }
    ]);
    expect(res2.isCorrect).toBe(false);

    // Submitting as key-value map object
    const res3 = await gradeAnswer(question as Question, { v: '1', f: '2' });
    expect(res3.isCorrect).toBe(true);

    const res4 = await gradeAnswer(question as Question, { v: '2', f: '2' });
    expect(res4.isCorrect).toBe(false);
  });

  test('CALCULATION_QUESTION grading with epsilon tolerance', async () => {
    const question: Partial<Question> = {
      id: 'q_calc',
      type: 'CALCULATION_QUESTION',
      correctAnswer: '3.14159'
    };

    const res1 = await gradeAnswer(question as Question, 3.14159);
    expect(res1.isCorrect).toBe(true);

    // Minor float precision tolerance
    const res2 = await gradeAnswer(question as Question, '3.1415901');
    expect(res2.isCorrect).toBe(true);

    const res3 = await gradeAnswer(question as Question, '3.14');
    expect(res3.isCorrect).toBe(false);
  });

  test('CODING_QUESTION grading with node VM sandbox execution', async () => {
    const question: Partial<Question> = {
      id: 'q_code',
      type: 'CODING_QUESTION',
      codingTestCases: [
        { input: '[2, 3]', output: '5' },
        { input: '[-1, 10]', output: '9' }
      ] as any
    };

    // Correct user function
    const correctCode = `
      function add(a, b) {
        return a + b;
      }
    `;
    const res1 = await gradeAnswer(question as Question, correctCode);
    expect(res1.isCorrect).toBe(true);

    // Incorrect function
    const wrongCode = `
      function add(a, b) {
        return a - b;
      }
    `;
    const res2 = await gradeAnswer(question as Question, wrongCode);
    expect(res2.isCorrect).toBe(false);

    // Sandbox isolation check (infinite loop protection)
    const timeoutCode = `
      function add(a, b) {
        while(true) {}
        return a + b;
      }
    `;
    const res3 = await gradeAnswer(question as Question, timeoutCode);
    expect(res3.isCorrect).toBe(false);
  });

});
