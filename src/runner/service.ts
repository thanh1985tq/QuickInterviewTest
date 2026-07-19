import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import type { AppConfig } from '../config.js';
import { getCandidateContextByAttemptId, type CandidateContext } from '../attempts/service.js';
import { nowIso } from '../domain/types.js';
import { HttpError } from '../http/errors.js';
import { hashToken, randomToken } from '../security/crypto.js';

interface RunnerTokenRow {
  id: string;
  attempt_id: string;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
}

export interface DeploymentRow {
  id: string;
  attempt_id: string;
  generation: number;
  state: string;
  runner_credential_hash: string;
  credential_expires_at: string;
  gradio_url: string | null;
  gradio_username: string | null;
  gradio_password_hash: string | null;
  last_heartbeat_at: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface RunnerContext {
  deployment: DeploymentRow;
  candidate: CandidateContext;
}

export async function issueRunnerToken(database: Knex, config: AppConfig, attemptId: string): Promise<{ token: string; expiresAt: string }> {
  const context = await getCandidateContextByAttemptId(database, attemptId);
  if (context.instance.delivery_mode !== 'COLAB_GRADIO') {
    throw new HttpError(409, 'DELIVERY_MODE_MISMATCH', 'Runner tokens are available only for Colab + Gradio attempts');
  }
  if (['SUBMITTED', 'EXPIRED', 'CANCELLED'].includes(context.attempt.state)) {
    throw new HttpError(409, 'ATTEMPT_CLOSED', 'A closed attempt cannot launch a runner');
  }
  const token = randomToken();
  const expiresAt = new Date(Date.now() + config.runnerTokenTtlMinutes * 60_000).toISOString();
  const timestamp = nowIso();
  await database.transaction(async (transaction) => {
    await transaction('runner_tokens').where({ attempt_id: attemptId, consumed_at: null }).update({ consumed_at: timestamp });
    await transaction('runner_tokens').insert({
      id: randomUUID(), attempt_id: attemptId, token_hash: hashToken(token), expires_at: expiresAt,
      consumed_at: null, created_at: timestamp,
    });
  });
  return { token, expiresAt };
}

export async function exchangeRunnerToken(
  database: Knex,
  config: AppConfig,
  rawToken: string,
): Promise<{
  deploymentId: string;
  runnerCredential: string;
  credentialExpiresAt: string;
  gradioUsername: string;
  gradioPassword: string;
  generation: number;
}> {
  return database.transaction(async (transaction) => {
    const token = await transaction<RunnerTokenRow>('runner_tokens').where({ token_hash: hashToken(rawToken) }).first();
    if (!token) throw new HttpError(404, 'RUNNER_TOKEN_INVALID', 'Runner token is invalid');
    if (token.consumed_at) throw new HttpError(409, 'RUNNER_TOKEN_USED', 'Runner token has already been used');
    if (new Date(token.expires_at).getTime() <= Date.now()) throw new HttpError(410, 'RUNNER_TOKEN_EXPIRED', 'Runner token has expired');
    const context = await getCandidateContextByAttemptId(transaction, token.attempt_id);
    if (context.instance.delivery_mode !== 'COLAB_GRADIO') throw new HttpError(409, 'DELIVERY_MODE_MISMATCH', 'Attempt does not use Lab Mode');
    const timestamp = nowIso();
    const latest = await transaction<DeploymentRow>('deployments').where({ attempt_id: token.attempt_id }).orderBy('generation', 'desc').first();
    const generation = (latest?.generation ?? 0) + 1;
    await transaction('deployments').where({ attempt_id: token.attempt_id }).whereNotIn('state', ['CLOSED', 'FAILED'])
      .update({ state: 'CLOSED', closed_at: timestamp });
    await transaction('runner_tokens').where({ id: token.id, consumed_at: null }).update({ consumed_at: timestamp });
    const runnerCredential = randomToken();
    const gradioUsername = `candidate-${token.attempt_id.slice(0, 8)}`;
    const gradioPassword = randomToken(18);
    const credentialExpiresAt = new Date(Date.now() + config.runnerCredentialTtlMinutes * 60_000).toISOString();
    const deploymentId = randomUUID();
    await transaction('deployments').insert({
      id: deploymentId, attempt_id: token.attempt_id, generation, state: 'STARTING',
      runner_credential_hash: hashToken(runnerCredential), credential_expires_at: credentialExpiresAt,
      gradio_url: null, gradio_username: gradioUsername, gradio_password_hash: hashToken(gradioPassword),
      last_heartbeat_at: timestamp, created_at: timestamp, closed_at: null,
    });
    return { deploymentId, runnerCredential, credentialExpiresAt, gradioUsername, gradioPassword, generation };
  });
}

export async function resolveRunner(database: Knex, config: AppConfig, credential: string): Promise<RunnerContext> {
  const deployment = await database<DeploymentRow>('deployments')
    .where({ runner_credential_hash: hashToken(credential) }).first();
  if (!deployment || deployment.closed_at || ['CLOSED', 'FAILED'].includes(deployment.state)) {
    throw new HttpError(401, 'RUNNER_CREDENTIAL_INVALID', 'Runner credential is invalid');
  }
  if (new Date(deployment.credential_expires_at).getTime() <= Date.now()) {
    throw new HttpError(401, 'RUNNER_CREDENTIAL_EXPIRED', 'Runner credential has expired');
  }
  deployment.credential_expires_at = new Date(Date.now() + config.runnerCredentialTtlMinutes * 60_000).toISOString();
  await database('deployments').where({ id: deployment.id }).update({ credential_expires_at: deployment.credential_expires_at });
  return { deployment, candidate: await getCandidateContextByAttemptId(database, deployment.attempt_id) };
}

export async function registerDeployment(database: Knex, context: RunnerContext, gradioUrl: string): Promise<void> {
  const parsed = new URL(gradioUrl);
  if (parsed.protocol !== 'https:') throw new HttpError(400, 'GRADIO_URL_INVALID', 'Gradio URL must use HTTPS');
  const timestamp = nowIso();
  await database('deployments').where({ id: context.deployment.id }).update({
    gradio_url: parsed.toString(), state: 'READY', last_heartbeat_at: timestamp,
  });
  context.deployment.gradio_url = parsed.toString();
  context.deployment.state = 'READY';
  context.deployment.last_heartbeat_at = timestamp;
}

export async function heartbeat(database: Knex, context: RunnerContext): Promise<string> {
  const timestamp = nowIso();
  await database('deployments').where({ id: context.deployment.id }).update({
    last_heartbeat_at: timestamp,
    state: context.deployment.gradio_url ? 'READY' : 'STARTING',
  });
  return timestamp;
}

export async function refreshDeploymentState(database: Knex, config: AppConfig, deployment: DeploymentRow): Promise<DeploymentRow> {
  if (['READY', 'STARTING'].includes(deployment.state) && deployment.last_heartbeat_at) {
    const offlineBefore = Date.now() - config.heartbeatOfflineSeconds * 1000;
    if (new Date(deployment.last_heartbeat_at).getTime() < offlineBefore) {
      await database('deployments').where({ id: deployment.id }).update({ state: 'OFFLINE' });
      deployment.state = 'OFFLINE';
    }
  }
  return deployment;
}

export async function latestDeployment(database: Knex, config: AppConfig, attemptId: string): Promise<DeploymentRow | undefined> {
  const deployment = await database<DeploymentRow>('deployments').where({ attempt_id: attemptId }).orderBy('generation', 'desc').first();
  return deployment ? refreshDeploymentState(database, config, deployment) : undefined;
}
