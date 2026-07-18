import { z } from 'zod';
import { domainSlugSchema } from '../domains/schemas.js';

const sectionSchema = z.object({
  key: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/),
  title: z.string().trim().min(1).max(300),
  maximumScore: z.number().positive().max(100_000).optional(),
}).strict();

const templateQuestionSchema = z.object({
  questionVersionId: z.string().uuid(),
  sectionKey: z.string().min(1).max(100),
  position: z.number().int().min(1).max(10_000),
  scoreWeight: z.number().positive().max(1000).default(1),
  required: z.boolean().default(true),
}).strict();

export const templateInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(10_000).default(''),
  domain: domainSlugSchema,
  targetSeniority: z.enum(['JUNIOR', 'MID', 'SENIOR', 'EXPERT', 'MIXED']),
  durationMinutes: z.number().int().min(1).max(480),
  randomizeQuestions: z.boolean().default(false),
  selectionMode: z.enum(['FIXED', 'WEIGHTED']).default('FIXED'),
  sections: z.array(sectionSchema).min(1).max(50),
  navigation: z.object({
    allowBack: z.boolean().default(true),
    requireSequential: z.boolean().default(false),
  }).strict().default({ allowBack: true, requireSequential: false }),
  questions: z.array(templateQuestionSchema).min(1).max(500),
}).strict().superRefine((input, context) => {
  const sectionKeys = input.sections.map((section) => section.key);
  if (new Set(sectionKeys).size !== sectionKeys.length) {
    context.addIssue({ code: 'custom', path: ['sections'], message: 'Section keys must be unique' });
  }
  const positions = input.questions.map((question) => question.position);
  if (new Set(positions).size !== positions.length) {
    context.addIssue({ code: 'custom', path: ['questions'], message: 'Question positions must be unique' });
  }
  const versionIds = input.questions.map((question) => question.questionVersionId);
  if (new Set(versionIds).size !== versionIds.length) {
    context.addIssue({ code: 'custom', path: ['questions'], message: 'A question version can appear only once' });
  }
  input.questions.forEach((question, index) => {
    if (!sectionKeys.includes(question.sectionKey)) {
      context.addIssue({ code: 'custom', path: ['questions', index, 'sectionKey'], message: 'Question references an unknown section' });
    }
  });
});

export type TemplateInput = z.infer<typeof templateInputSchema>;
