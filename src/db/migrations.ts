import type { Knex } from 'knex';

interface Migration {
  up: (database: Knex) => Promise<void>;
  down: (database: Knex) => Promise<void>;
}

const initialSchema: Migration = {
  async up(database) {
    await database.schema.createTable('users', (table) => {
      table.uuid('id').primary();
      table.string('email', 320).notNullable().unique();
      table.text('password_hash').notNullable();
      table.string('role', 24).notNullable();
      table.boolean('is_active').notNullable().defaultTo(true);
      table.boolean('must_change_password').notNullable().defaultTo(false);
      table.text('created_at').notNullable();
      table.text('updated_at').notNullable();
    });

    await database.schema.createTable('user_sessions', (table) => {
      table.uuid('id').primary();
      table.string('token_hash', 64).notNullable().unique();
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('csrf_secret', 128).notNullable();
      table.text('expires_at').notNullable();
      table.text('last_seen_at').notNullable();
      table.text('revoked_at').nullable();
      table.text('created_at').notNullable();
      table.index(['user_id', 'expires_at']);
    });

    await database.schema.createTable('login_attempts', (table) => {
      table.uuid('id').primary();
      table.string('account_hash', 64).notNullable();
      table.string('ip_hash', 64).notNullable();
      table.boolean('successful').notNullable();
      table.text('occurred_at').notNullable();
      table.index(['account_hash', 'occurred_at']);
      table.index(['ip_hash', 'occurred_at']);
    });

    await database.schema.createTable('admin_audit_log', (table) => {
      table.uuid('id').primary();
      table.uuid('actor_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
      table.string('action', 100).notNullable();
      table.string('target_type', 100).notNullable();
      table.string('target_id', 100).nullable();
      table.string('request_id', 100).nullable();
      table.text('details_json').notNullable().defaultTo('{}');
      table.text('created_at').notNullable();
      table.index(['actor_user_id', 'created_at']);
    });

    await database.schema.createTable('questions', (table) => {
      table.uuid('id').primary();
      table.uuid('author_user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.string('status', 24).notNullable().defaultTo('DRAFT');
      table.integer('current_version').notNullable().defaultTo(1);
      table.text('created_at').notNullable();
      table.text('updated_at').notNullable();
      table.index(['status', 'updated_at']);
    });

    await database.schema.createTable('question_versions', (table) => {
      table.uuid('id').primary();
      table.uuid('question_id').notNullable().references('id').inTable('questions').onDelete('CASCADE');
      table.integer('version').notNullable();
      table.string('status', 24).notNullable().defaultTo('DRAFT');
      table.string('title', 300).notNullable();
      table.text('description').notNullable();
      table.text('prompt').notNullable();
      table.string('domain', 40).notNullable();
      table.string('type', 40).notNullable();
      table.string('difficulty', 24).notNullable();
      table.integer('expected_duration_minutes').notNullable();
      table.decimal('maximum_score', 10, 2).notNullable();
      table.text('choices_json').notNullable().defaultTo('[]');
      table.text('answer_key_json').notNullable().defaultTo('{}');
      table.text('scoring_rubric').notNullable().defaultTo('');
      table.uuid('created_by_user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.text('created_at').notNullable();
      table.text('published_at').nullable();
      table.unique(['question_id', 'version']);
      table.index(['domain', 'type', 'status']);
    });

    await database.schema.createTable('tags', (table) => {
      table.uuid('id').primary();
      table.string('name', 100).notNullable();
      table.string('normalized_name', 100).notNullable().unique();
      table.text('created_at').notNullable();
    });

    await database.schema.createTable('question_tags', (table) => {
      table.uuid('question_id').notNullable().references('id').inTable('questions').onDelete('CASCADE');
      table.uuid('tag_id').notNullable().references('id').inTable('tags').onDelete('CASCADE');
      table.primary(['question_id', 'tag_id']);
    });

    await database.schema.createTable('test_templates', (table) => {
      table.uuid('id').primary();
      table.uuid('author_user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.string('status', 24).notNullable().defaultTo('DRAFT');
      table.integer('current_version').notNullable().defaultTo(1);
      table.text('created_at').notNullable();
      table.text('updated_at').notNullable();
      table.index(['status', 'updated_at']);
    });

    await database.schema.createTable('test_template_versions', (table) => {
      table.uuid('id').primary();
      table.uuid('template_id').notNullable().references('id').inTable('test_templates').onDelete('CASCADE');
      table.integer('version').notNullable();
      table.string('status', 24).notNullable().defaultTo('DRAFT');
      table.string('title', 300).notNullable();
      table.text('description').notNullable();
      table.string('domain', 40).notNullable();
      table.string('target_seniority', 40).notNullable();
      table.integer('duration_minutes').notNullable();
      table.boolean('randomize_questions').notNullable().defaultTo(false);
      table.string('selection_mode', 24).notNullable().defaultTo('FIXED');
      table.text('sections_json').notNullable().defaultTo('[]');
      table.text('navigation_json').notNullable().defaultTo('{}');
      table.uuid('created_by_user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.text('created_at').notNullable();
      table.text('published_at').nullable();
      table.unique(['template_id', 'version']);
    });

    await database.schema.createTable('test_template_questions', (table) => {
      table.uuid('id').primary();
      table.uuid('template_version_id').notNullable().references('id').inTable('test_template_versions').onDelete('CASCADE');
      table.uuid('question_version_id').notNullable().references('id').inTable('question_versions').onDelete('RESTRICT');
      table.string('section_key', 100).notNullable().defaultTo('main');
      table.integer('position').notNullable();
      table.decimal('score_weight', 10, 4).notNullable().defaultTo(1);
      table.boolean('required').notNullable().defaultTo(true);
      table.unique(['template_version_id', 'position']);
      table.unique(['template_version_id', 'question_version_id']);
    });

    await database.schema.createTable('candidates', (table) => {
      table.uuid('id').primary();
      table.string('name', 300).notNullable();
      table.string('email', 320).nullable();
      table.text('metadata_json').notNullable().defaultTo('{}');
      table.text('anonymized_at').nullable();
      table.text('created_at').notNullable();
      table.text('updated_at').notNullable();
      table.index(['email']);
    });

    await database.schema.createTable('test_instances', (table) => {
      table.uuid('id').primary();
      table.uuid('template_version_id').notNullable().references('id').inTable('test_template_versions').onDelete('RESTRICT');
      table.uuid('candidate_id').notNullable().references('id').inTable('candidates').onDelete('RESTRICT');
      table.uuid('created_by_user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.string('delivery_mode', 32).notNullable().defaultTo('STANDARD_WEB');
      table.text('available_from').notNullable();
      table.text('available_until').notNullable();
      table.integer('duration_minutes').notNullable();
      table.text('configuration_json').notNullable().defaultTo('{}');
      table.text('created_at').notNullable();
      table.index(['candidate_id', 'created_at']);
      table.index(['delivery_mode', 'created_at']);
    });

    await database.schema.createTable('test_instance_questions', (table) => {
      table.uuid('id').primary();
      table.uuid('test_instance_id').notNullable().references('id').inTable('test_instances').onDelete('CASCADE');
      table.uuid('source_question_version_id').notNullable().references('id').inTable('question_versions').onDelete('RESTRICT');
      table.integer('position').notNullable();
      table.string('section_key', 100).notNullable();
      table.string('title', 300).notNullable();
      table.text('description').notNullable();
      table.text('prompt').notNullable();
      table.string('domain', 40).notNullable();
      table.string('type', 40).notNullable();
      table.decimal('maximum_score', 10, 2).notNullable();
      table.decimal('score_weight', 10, 4).notNullable().defaultTo(1);
      table.boolean('required').notNullable().defaultTo(true);
      table.text('choices_json').notNullable().defaultTo('[]');
      table.text('answer_key_json').notNullable().defaultTo('{}');
      table.text('scoring_rubric').notNullable().defaultTo('');
      table.unique(['test_instance_id', 'position']);
      table.unique(['test_instance_id', 'source_question_version_id']);
    });

    await database.schema.createTable('candidate_attempts', (table) => {
      table.uuid('id').primary();
      table.uuid('test_instance_id').notNullable().unique().references('id').inTable('test_instances').onDelete('CASCADE');
      table.string('state', 32).notNullable().defaultTo('CREATED');
      table.string('candidate_token_hash', 64).notNullable().unique();
      table.text('token_expires_at').notNullable();
      table.text('started_at').nullable();
      table.text('deadline_at').nullable();
      table.text('submitted_at').nullable();
      table.text('created_at').notNullable();
      table.text('updated_at').notNullable();
      table.index(['state', 'updated_at']);
    });

    await database.schema.createTable('answers', (table) => {
      table.uuid('id').primary();
      table.uuid('attempt_id').notNullable().references('id').inTable('candidate_attempts').onDelete('CASCADE');
      table.uuid('instance_question_id').notNullable().references('id').inTable('test_instance_questions').onDelete('RESTRICT');
      table.text('answer_json').notNullable();
      table.string('idempotency_key', 100).notNullable();
      table.text('saved_at').notNullable();
      table.unique(['attempt_id', 'instance_question_id']);
      table.index(['attempt_id', 'idempotency_key']);
    });

    await database.schema.createTable('attempt_events', (table) => {
      table.uuid('id').primary();
      table.uuid('attempt_id').notNullable().references('id').inTable('candidate_attempts').onDelete('CASCADE');
      table.string('type', 100).notNullable();
      table.text('details_json').notNullable().defaultTo('{}');
      table.text('created_at').notNullable();
      table.index(['attempt_id', 'created_at']);
    });

    await database.schema.createTable('scores', (table) => {
      table.uuid('id').primary();
      table.uuid('attempt_id').notNullable().references('id').inTable('candidate_attempts').onDelete('CASCADE');
      table.uuid('answer_id').notNullable().references('id').inTable('answers').onDelete('CASCADE');
      table.string('kind', 24).notNullable();
      table.decimal('score', 10, 2).notNullable();
      table.decimal('maximum_score', 10, 2).notNullable();
      table.integer('revision').notNullable();
      table.uuid('reviewer_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
      table.text('reason').notNullable().defaultTo('');
      table.text('created_at').notNullable();
      table.unique(['answer_id', 'revision']);
      table.index(['attempt_id', 'created_at']);
    });

    await database.schema.createTable('review_comments', (table) => {
      table.uuid('id').primary();
      table.uuid('attempt_id').notNullable().references('id').inTable('candidate_attempts').onDelete('CASCADE');
      table.uuid('instance_question_id').nullable().references('id').inTable('test_instance_questions').onDelete('SET NULL');
      table.uuid('reviewer_user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.text('comment').notNullable();
      table.text('created_at').notNullable();
      table.index(['attempt_id', 'created_at']);
    });

    await database.schema.createTable('runner_tokens', (table) => {
      table.uuid('id').primary();
      table.uuid('attempt_id').notNullable().references('id').inTable('candidate_attempts').onDelete('CASCADE');
      table.string('token_hash', 64).notNullable().unique();
      table.text('expires_at').notNullable();
      table.text('consumed_at').nullable();
      table.text('created_at').notNullable();
      table.index(['attempt_id', 'expires_at']);
    });

    await database.schema.createTable('deployments', (table) => {
      table.uuid('id').primary();
      table.uuid('attempt_id').notNullable().references('id').inTable('candidate_attempts').onDelete('CASCADE');
      table.integer('generation').notNullable();
      table.string('state', 24).notNullable().defaultTo('CREATED');
      table.string('runner_credential_hash', 64).notNullable().unique();
      table.text('credential_expires_at').notNullable();
      table.text('gradio_url').nullable();
      table.string('gradio_username', 100).nullable();
      table.string('gradio_password_hash', 64).nullable();
      table.text('last_heartbeat_at').nullable();
      table.text('created_at').notNullable();
      table.text('closed_at').nullable();
      table.unique(['attempt_id', 'generation']);
      table.index(['attempt_id', 'state']);
    });
  },

  async down(database) {
    const tables = [
      'deployments', 'runner_tokens', 'review_comments', 'scores', 'attempt_events', 'answers',
      'candidate_attempts', 'test_instance_questions', 'test_instances', 'candidates',
      'test_template_questions', 'test_template_versions', 'test_templates', 'question_tags',
      'tags', 'question_versions', 'questions', 'admin_audit_log', 'login_attempts',
      'user_sessions', 'users',
    ];
    for (const table of tables) await database.schema.dropTableIfExists(table);
  },
};

const migrations: Record<string, Migration> = { '001_initial_schema': initialSchema };

export async function migrateDatabase(database: Knex): Promise<void> {
  await database.migrate.latest({
    migrationSource: {
      getMigrations: () => Promise.resolve(Object.keys(migrations)),
      getMigrationName: (name: string) => name,
      getMigration: (name: string) => Promise.resolve(migrations[name] as Migration),
    },
  });
}

export async function rollbackDatabase(database: Knex): Promise<void> {
  await database.migrate.rollback({
    migrationSource: {
      getMigrations: () => Promise.resolve(Object.keys(migrations)),
      getMigrationName: (name: string) => name,
      getMigration: (name: string) => Promise.resolve(migrations[name] as Migration),
    },
  });
}
