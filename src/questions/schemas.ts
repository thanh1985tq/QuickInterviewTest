import { z } from 'zod';
import { questionTypes } from '../domain/types.js';
import { domainSlugSchema } from '../domains/schemas.js';

const choiceSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/),
  label: z.string().trim().min(1).max(2000),
}).strict();

export const questionInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).default(''),
  prompt: z.string().trim().min(1).max(50_000),
  domain: domainSlugSchema,
  type: z.enum(questionTypes),
  difficulty: z.enum(['JUNIOR', 'MID', 'SENIOR', 'EXPERT']),
  expectedDurationMinutes: z.number().int().min(1).max(240),
  maximumScore: z.number().positive().max(10_000),
  choices: z.array(choiceSchema).max(100).default([]),
  answerKey: z.object({ correctChoiceIds: z.array(z.string()).max(100).default([]) }).passthrough().default({ correctChoiceIds: [] }),
  scoringRubric: z.string().trim().max(20_000).default(''),
  tags: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
}).strict().superRefine((input, context) => {
  const choiceType = input.type === 'SINGLE_CHOICE' || input.type === 'MULTIPLE_CHOICE';
  const choiceIds = input.choices.map((choice) => choice.id);
  if (new Set(choiceIds).size !== choiceIds.length) {
    context.addIssue({ code: 'custom', path: ['choices'], message: 'Choice IDs must be unique' });
  }
  if (choiceType && input.choices.length < 2) {
    context.addIssue({ code: 'custom', path: ['choices'], message: 'Choice questions require at least two choices' });
  }
  if (!choiceType && input.choices.length > 0) {
    context.addIssue({ code: 'custom', path: ['choices'], message: 'Text questions cannot define choices' });
  }
  const correct = input.answerKey.correctChoiceIds;
  if (input.type === 'SINGLE_CHOICE' && correct.length !== 1) {
    context.addIssue({ code: 'custom', path: ['answerKey', 'correctChoiceIds'], message: 'Single-choice questions require exactly one correct choice' });
  }
  if (input.type === 'MULTIPLE_CHOICE' && correct.length < 1) {
    context.addIssue({ code: 'custom', path: ['answerKey', 'correctChoiceIds'], message: 'Multiple-choice questions require at least one correct choice' });
  }
  if (new Set(correct).size !== correct.length || correct.some((id) => !choiceIds.includes(id))) {
    context.addIssue({ code: 'custom', path: ['answerKey', 'correctChoiceIds'], message: 'Correct choices must be unique IDs defined in choices' });
  }
  if (!choiceType && input.scoringRubric.length === 0) {
    context.addIssue({ code: 'custom', path: ['scoringRubric'], message: 'Text questions require a manual scoring rubric' });
  }
});

export type QuestionInput = z.infer<typeof questionInputSchema>;
