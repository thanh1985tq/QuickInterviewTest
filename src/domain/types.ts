export const userRoles = ['ADMIN', 'INTERVIEWER', 'REVIEWER'] as const;
export type UserRole = typeof userRoles[number];

export const questionTypes = [
  'SINGLE_CHOICE',
  'MULTIPLE_CHOICE',
  'SHORT_ANSWER',
  'LONG_ANSWER',
  'CODE_ANSWER',
  'SCENARIO',
] as const;
export type QuestionType = typeof questionTypes[number];

export const defaultDomainSlugs = ['AUTOMATION_TESTING', 'PERFORMANCE_TESTING'] as const;
export type QuestionDomain = string;

export const lifecycleStatuses = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type LifecycleStatus = typeof lifecycleStatuses[number];

export const deliveryModes = ['STANDARD_WEB', 'COLAB_GRADIO'] as const;
export type DeliveryMode = typeof deliveryModes[number];

export const attemptStates = [
  'CREATED',
  'INVITED',
  'STARTED',
  'IN_PROGRESS',
  'SUBMITTED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type AttemptState = typeof attemptStates[number];

export const deploymentStates = ['CREATED', 'STARTING', 'READY', 'OFFLINE', 'CLOSED', 'FAILED'] as const;
export type DeploymentState = typeof deploymentStates[number];

export function nowIso(): string {
  return new Date().toISOString();
}

export function toJson(value: unknown): string {
  return JSON.stringify(value);
}

export function fromJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value as T;
}
