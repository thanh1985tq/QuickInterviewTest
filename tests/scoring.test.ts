import { describe, expect, it } from 'vitest';
import { calculateObjectiveScore } from '../src/results/scoring.js';

describe('objective scoring', () => {
  it('scores single-choice exact matches on the server', () => {
    const key = { correctChoiceIds: ['b'] };
    expect(calculateObjectiveScore('SINGLE_CHOICE', 'b', key, 10)).toBe(10);
    expect(calculateObjectiveScore('SINGLE_CHOICE', 'a', key, 10)).toBe(0);
  });

  it('scores multiple choice as an order-independent exact set', () => {
    const key = { correctChoiceIds: ['a', 'c'] };
    expect(calculateObjectiveScore('MULTIPLE_CHOICE', ['c', 'a'], key, 8)).toBe(8);
    expect(calculateObjectiveScore('MULTIPLE_CHOICE', ['a'], key, 8)).toBe(0);
    expect(calculateObjectiveScore('LONG_ANSWER', 'text', key, 8)).toBeUndefined();
  });
});
