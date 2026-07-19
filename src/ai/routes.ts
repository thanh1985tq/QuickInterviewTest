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
}).strict();

const generatedQuestionsSchema = z.object({
  questions: z.array(questionInputSchema).min(1).max(20),
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

export function createAiRouter(config: AppConfig): Router {
  const router = Router();

  router.post('/questions', async (request, response, next) => {
    try {
      if (!config.ai.apiUrl || !config.ai.apiKey || !config.ai.model) {
        throw new HttpError(503, 'AI_NOT_CONFIGURED', 'AI Assistant is not configured');
      }
      const input = generateSchema.parse(request.body);
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
                'Use choice ids choice_1, choice_2, etc. For choice questions include correctChoiceIds.',
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
                type: input.type || undefined,
              }),
            },
          ],
        }),
      });
      const body: unknown = await providerResponse.json().catch(() => ({}));
      if (!providerResponse.ok) {
        throw new HttpError(502, 'AI_PROVIDER_ERROR', 'AI provider request failed', body);
      }
      const completion = completionSchema.parse(body);
      const content = completion.choices[0]?.message.content ?? '';
      const parsed = generatedQuestionsSchema.parse(extractJson(content));
      response.json(parsed);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
