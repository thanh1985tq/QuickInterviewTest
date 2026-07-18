import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import type { AuthContext } from '../auth/service.js';
import { writeAudit } from '../audit/service.js';
import { nowIso } from '../domain/types.js';
import { HttpError } from '../http/errors.js';
import { domainSlugSchema, type CreateDomainInput, type UpdateDomainInput } from './schemas.js';

interface DomainRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  is_active: boolean | number;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface DomainCountRow {
  domain: string;
  count: number | string;
}

export function slugFromDomainName(name: string): string {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleUpperCase('en-US').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

function mapDomain(row: DomainRow, questionCount = 0, templateCount = 0) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    isActive: Boolean(row.is_active),
    questionCount,
    templateCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listDomains(database: Knex, status: 'ACTIVE' | 'ARCHIVED' | 'ALL' = 'ACTIVE') {
  let query = database<DomainRow>('domains').select('*');
  if (status === 'ACTIVE') query = query.where({ is_active: true });
  if (status === 'ARCHIVED') query = query.where({ is_active: false });
  const [rows, questionCounts, templateCounts] = await Promise.all([
    query.orderBy('name'),
    database('questions as entities')
      .join('question_versions as versions', function joinCurrent() {
        this.on('versions.question_id', 'entities.id').andOn('versions.version', 'entities.current_version');
      })
      .select('versions.domain').count<DomainCountRow[]>({ count: '*' }).groupBy('versions.domain'),
    database('test_templates as entities')
      .join('test_template_versions as versions', function joinCurrent() {
        this.on('versions.template_id', 'entities.id').andOn('versions.version', 'entities.current_version');
      })
      .select('versions.domain').count<DomainCountRow[]>({ count: '*' }).groupBy('versions.domain'),
  ]);
  const questions = new Map(questionCounts.map((row) => [row.domain, Number(row.count)]));
  const templates = new Map(templateCounts.map((row) => [row.domain, Number(row.count)]));
  return rows.map((row) => mapDomain(row, questions.get(row.slug) ?? 0, templates.get(row.slug) ?? 0));
}

export async function assertActiveDomain(database: Knex, slug: string): Promise<DomainRow> {
  const normalized = domainSlugSchema.parse(slug);
  const domain = await database<DomainRow>('domains').where({ slug: normalized }).first();
  if (!domain) throw new HttpError(400, 'DOMAIN_NOT_FOUND', 'Select an existing interview domain');
  if (!domain.is_active) throw new HttpError(409, 'DOMAIN_ARCHIVED', 'The selected interview domain is archived');
  return domain;
}

export async function createDomain(
  database: Knex, input: CreateDomainInput, auth: AuthContext, requestId?: string,
): Promise<string> {
  const slug = domainSlugSchema.parse(input.slug ?? slugFromDomainName(input.name));
  const duplicate = await database<DomainRow>('domains').where({ slug }).first();
  if (duplicate) throw new HttpError(409, 'DOMAIN_EXISTS', 'A domain with this identifier already exists');
  const id = randomUUID();
  const timestamp = nowIso();
  await database.transaction(async (transaction) => {
    await transaction('domains').insert({
      id, slug, name: input.name, description: input.description, is_active: true,
      created_by_user_id: auth.user.id, created_at: timestamp, updated_at: timestamp,
    });
    await writeAudit(transaction, {
      actorUserId: auth.user.id, action: 'DOMAIN_CREATED', targetType: 'DOMAIN', targetId: id,
      requestId, details: { slug },
    });
  });
  return id;
}

export async function updateDomain(
  database: Knex, id: string, input: UpdateDomainInput, auth: AuthContext, requestId?: string,
): Promise<void> {
  const timestamp = nowIso();
  await database.transaction(async (transaction) => {
    const domain = await transaction<DomainRow>('domains').where({ id }).first();
    if (!domain) throw new HttpError(404, 'DOMAIN_NOT_FOUND', 'Domain was not found');
    await transaction('domains').where({ id }).update({ ...input, updated_at: timestamp });
    await writeAudit(transaction, {
      actorUserId: auth.user.id, action: 'DOMAIN_UPDATED', targetType: 'DOMAIN', targetId: id,
      requestId, details: { slug: domain.slug },
    });
  });
}

export async function setDomainActive(
  database: Knex, id: string, isActive: boolean, auth: AuthContext, requestId?: string,
): Promise<void> {
  const timestamp = nowIso();
  await database.transaction(async (transaction) => {
    const domain = await transaction<DomainRow>('domains').where({ id }).first();
    if (!domain) throw new HttpError(404, 'DOMAIN_NOT_FOUND', 'Domain was not found');
    await transaction('domains').where({ id }).update({ is_active: isActive, updated_at: timestamp });
    await writeAudit(transaction, {
      actorUserId: auth.user.id, action: isActive ? 'DOMAIN_REACTIVATED' : 'DOMAIN_ARCHIVED',
      targetType: 'DOMAIN', targetId: id, requestId, details: { slug: domain.slug },
    });
  });
}

