import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { fromJson, nowIso } from '../domain/types.js';

export function calculateObjectiveScore(
  type: string,
  answer: unknown,
  answerKey: Record<string, unknown>,
  maximumScore: number,
): number | undefined {
  const correct = answerKey.correctChoiceIds;
  if (!Array.isArray(correct) || correct.some((value) => typeof value !== 'string')) return undefined;
  if (type === 'SINGLE_CHOICE') return typeof answer === 'string' && correct.length === 1 && answer === correct[0] ? maximumScore : 0;
  if (type === 'MULTIPLE_CHOICE') {
    if (!Array.isArray(answer) || answer.some((value) => typeof value !== 'string')) return 0;
    const actual = new Set(answer);
    const expected = new Set(correct);
    return actual.size === expected.size && [...actual].every((value) => expected.has(value)) ? maximumScore : 0;
  }
  return undefined;
}

interface ObjectiveRow {
  answer_id: string;
  answer_json: string;
  type: string;
  answer_key_json: string;
  maximum_score: number | string;
  score_weight: number | string;
}

export async function scoreObjectiveAnswers(database: Knex | Knex.Transaction, attemptId: string): Promise<void> {
  const rows = await database('answers as answers')
    .join('test_instance_questions as questions', 'questions.id', 'answers.instance_question_id')
    .where('answers.attempt_id', attemptId)
    .whereIn('questions.type', ['SINGLE_CHOICE', 'MULTIPLE_CHOICE'])
    .select<ObjectiveRow[]>(
      'answers.id as answer_id', 'answers.answer_json', 'questions.type', 'questions.answer_key_json',
      'questions.maximum_score', 'questions.score_weight',
    );
  for (const row of rows) {
    const maximum = Number(row.maximum_score) * Number(row.score_weight);
    const score = calculateObjectiveScore(
      row.type, fromJson<unknown>(row.answer_json, null), fromJson<Record<string, unknown>>(row.answer_key_json, {}), maximum,
    );
    if (score === undefined) continue;
    const existing = await database<{ id: string; answer_id: string }>('scores').where({ answer_id: row.answer_id }).first('id');
    if (!existing) await database('scores').insert({
      id: randomUUID(), attempt_id: attemptId, answer_id: row.answer_id, kind: 'AUTOMATIC', score,
      maximum_score: maximum, revision: 1, reviewer_user_id: null, reason: 'Objective score at submission', created_at: nowIso(),
    });
  }
}
