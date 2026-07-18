import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { nowIso, toJson } from '../domain/types.js';

export async function writeAudit(
  database: Knex,
  entry: {
    actorUserId?: string | undefined;
    action: string;
    targetType: string;
    targetId?: string | undefined;
    requestId?: string | undefined;
    details?: Record<string, unknown> | undefined;
  },
): Promise<void> {
  await database('admin_audit_log').insert({
    id: randomUUID(),
    actor_user_id: entry.actorUserId ?? null,
    action: entry.action,
    target_type: entry.targetType,
    target_id: entry.targetId ?? null,
    request_id: entry.requestId ?? null,
    details_json: toJson(entry.details ?? {}),
    created_at: nowIso(),
  });
}
