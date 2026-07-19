import { Router } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { questionTypes } from '../domain/types.js';
import { domainSlugSchema } from '../domains/schemas.js';
import { HttpError } from '../http/errors.js';
import { questionInputSchema } from '../questions/schemas.js';

const generateSchema = z.object({
  domain: domainSlugSchema,
  count: z.number().int().min(1).max(20).default(5),
  topic: z.string().trim().max(300).default(''),
  difficulty: z.enum(['JUNIOR', 'MID', 'SENIOR', 'EXPERT']).default('MID'),
  type: z.enum(questionTypes).optional(),
  types: z.array(z.enum(questionTypes)).min(1).max(questionTypes.length).optional(),
}).strict();

const looseChoiceSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  value: z.string().optional(),
}).passthrough();

const looseQuestionSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  prompt: z.string().optional(),
  question: z.string().optional(),
  domain: z.string().optional(),
  type: z.string().optional(),
  difficulty: z.string().optional(),
  expectedDurationMinutes: z.number().optional(),
  expected_duration_minutes: z.number().optional(),
  maximumScore: z.number().optional(),
  maximum_score: z.number().optional(),
  choices: z.array(looseChoiceSchema).optional(),
  answerKey: z.unknown().optional(),
  correctChoiceIds: z.array(z.string()).optional(),
  scoringRubric: z.unknown().optional(),
  rubric: z.unknown().optional(),
  tags: z.array(z.string()).optional(),
}).passthrough();

const looseGeneratedQuestionsSchema = z.object({
  questions: z.array(looseQuestionSchema).min(1).max(20),
}).strict();

const completionSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string() }).passthrough(),
  }).passthrough()).min(1),
}).passthrough();

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return JSON.parse(fenced[1]);
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new HttpError(502, 'AI_RESPONSE_INVALID', 'AI provider did not return JSON');
}

function normalizeType(value: string | undefined, fallback: string): string {
  const normalized = String(value || '').trim().toLocaleUpperCase('en-US').replace(/[-\s]+/g, '_');
  const aliases: Record<string, string> = {
    SINGLE: 'SINGLE_CHOICE',
    SINGLE_CHOICE: 'SINGLE_CHOICE',
    MULTIPLE: 'MULTIPLE_CHOICE',
    MULTIPLE_CHOICE: 'MULTIPLE_CHOICE',
    MCQ: 'MULTIPLE_CHOICE',
    WRITTEN: 'SHORT_ANSWER',
    TEXT: 'SHORT_ANSWER',
    SHORT: 'SHORT_ANSWER',
    SHORT_ANSWER: 'SHORT_ANSWER',
    LONG: 'LONG_ANSWER',
    LONG_ANSWER: 'LONG_ANSWER',
    CODE: 'CODE_ANSWER',
    CODE_ANSWER: 'CODE_ANSWER',
    SCENARIO: 'SCENARIO',
  };
  return aliases[normalized] ?? fallback;
}

function rubricToText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (typeof entry === 'string') return `${index + 1}. ${entry}`;
      if (entry && typeof entry === 'object') {
        const object = entry as Record<string, unknown>;
        const criterion = typeof object.criterion === 'string' ? object.criterion : JSON.stringify(object);
        const points = typeof object.points === 'number' || typeof object.points === 'string' ? ` (${object.points} pts)` : '';
        return `${index + 1}. ${criterion}${points}`;
      }
      return `${index + 1}. ${String(entry)}`;
    }).join('\n');
  }
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
  return '';
}

function correctChoiceIdsFrom(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (Array.isArray(object.correctChoiceIds)) return object.correctChoiceIds.map((entry) => String(entry));
    if (Array.isArray(object.correct)) return object.correct.map((entry) => String(entry));
    if (typeof object.correctChoiceId === 'string') return [object.correctChoiceId];
    if (typeof object.correct === 'string') return [object.correct];
  }
  return [];
}

function titleFromPrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  return compact.length > 90 ? `${compact.slice(0, 87)}...` : compact;
}

function normalizeGeneratedQuestion(
  draft: z.infer<typeof looseQuestionSchema>,
  context: { domain: string; difficulty: string; fallbackType: string },
) {
  const type = normalizeType(draft.type, context.fallbackType);
  const prompt = (draft.prompt ?? draft.question ?? draft.title ?? '').trim();
  const choiceType = type === 'SINGLE_CHOICE' || type === 'MULTIPLE_CHOICE';
  const choices = choiceType ? (draft.choices ?? []).map((choice, index) => ({
    id: String(choice.id ?? `choice_${index + 1}`).trim().replace(/[^A-Za-z0-9_-]/g, '_') || `choice_${index + 1}`,
    label: (choice.label ?? choice.text ?? choice.value ?? `Choice ${index + 1}`).trim(),
  })).filter((choice) => choice.label.length > 0) : [];
  const correctChoiceIds = choiceType
    ? (draft.correctChoiceIds ?? correctChoiceIdsFrom(draft.answerKey)).map((id) => String(id))
    : [];
  const scoringRubric = choiceType ? '' : rubricToText(draft.scoringRubric ?? draft.rubric) || 'Score for correctness, clarity, and practical testing judgment.';

  return questionInputSchema.parse({
    title: (draft.title ?? titleFromPrompt(prompt)).trim(),
    description: (draft.description ?? `AI-generated ${context.difficulty.toLocaleLowerCase('en-US')} question.`).trim(),
    prompt,
    domain: context.domain,
    type,
    difficulty: normalizeDifficulty(draft.difficulty, context.difficulty),
    expectedDurationMinutes: draft.expectedDurationMinutes ?? draft.expected_duration_minutes ?? 5,
    maximumScore: draft.maximumScore ?? draft.maximum_score ?? 10,
    choices,
    answerKey: { correctChoiceIds },
    scoringRubric,
    tags: draft.tags ?? ['ai-generated'],
  });
}

function normalizeDifficulty(value: string | undefined, fallback: string): string {
  const normalized = String(value || '').trim().toLocaleUpperCase('en-US');
  return ['JUNIOR', 'MID', 'SENIOR', 'EXPERT'].includes(normalized) ? normalized : fallback;
}

export function createAiRouter(config: AppConfig): Router {
  const router = Router();

  router.post('/questions', async (request, response, next) => {
    let validatingProviderResponse = false;
    try {
      if (!config.ai.apiUrl || !config.ai.apiKey || !config.ai.model) {
        throw new HttpError(503, 'AI_NOT_CONFIGURED', 'AI Assistant is not configured');
      }
      const input = generateSchema.parse(request.body);
      const selectedTypes = input.types ?? (input.type ? [input.type] : ['SINGLE_CHOICE', 'MULTIPLE_CHOICE']);
      const providerResponse = await fetch(`${config.ai.apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.ai.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.ai.model,
          temperature: 0.3,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: [
                'Generate interview assessment questions for QuickInterviewTest.',
                'Return only JSON matching this shape: {"questions":[questionInput,...]}.',
                `Generate exactly ${input.count} question(s), using only these type values: ${selectedTypes.join(', ')}.`,
                'Use choice ids choice_1, choice_2, etc. For choice questions include correctChoiceIds.',
                'Each question must include title, description, prompt, domain, type, difficulty, expectedDurationMinutes, maximumScore, choices, answerKey, scoringRubric, and tags.',
                'Choice objects must use label, not text.',
                'For written, scenario, or code answers, omit choices and include a clear scoringRubric.',
                'Do not ask candidates to execute submitted code.',
              ].join(' '),
            },
            {
              role: 'user',
              content: JSON.stringify({
                domain: input.domain,
                count: input.count,
                topic: input.topic || undefined,
                difficulty: input.difficulty,
                types: selectedTypes,
              }),
            },
          ],
        }),
      });
      const body: unknown = await providerResponse.json().catch(() => ({}));
      if (!providerResponse.ok) {
        throw new HttpError(502, 'AI_PROVIDER_ERROR', 'AI provider request failed', body);
      }
      validatingProviderResponse = true;
      const completion = completionSchema.parse(body);
      const content = completion.choices[0]?.message.content ?? '';
      const parsed = looseGeneratedQuestionsSchema.parse(extractJson(content));
      const questions = parsed.questions.slice(0, input.count).map((draft, index) => normalizeGeneratedQuestion(
        draft,
        { domain: input.domain, difficulty: input.difficulty, fallbackType: selectedTypes[index % selectedTypes.length] as string },
      ));
      response.json({ questions });
    } catch (error) {
      if (validatingProviderResponse && error instanceof z.ZodError) {
        next(new HttpError(502, 'AI_RESPONSE_INVALID', 'AI provider returned question drafts that could not be imported', error.issues));
        return;
      }
      next(error);
    }
  });

  return router;
}
