import { z } from 'zod';

export const domainSlugSchema = z.string().trim().min(2).max(40).regex(
  /^[A-Z][A-Z0-9_]*$/,
  'Use uppercase letters, numbers, and underscores; start with a letter',
);

export const createDomainSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: domainSlugSchema.optional(),
  description: z.string().trim().max(2000).default(''),
}).strict();

export const updateDomainSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Provide a name or description');

export type CreateDomainInput = z.infer<typeof createDomainSchema>;
export type UpdateDomainInput = z.infer<typeof updateDomainSchema>;

