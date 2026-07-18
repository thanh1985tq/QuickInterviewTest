import { Router } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import { getAuth } from '../auth/middleware.js';
import { domains, lifecycleStatuses } from '../domain/types.js';
import { templateInputSchema } from './schemas.js';
import {
  archiveTemplate, createTemplate, getTemplate, mapTemplateVersion, previewTemplate, publishTemplate,
  type TemplateQuestionRow, type TemplateVersionRow, updateTemplate,
} from './service.js';
import { exportTemplates, importTemplates } from '../portability/service.js';

interface TemplateListRow extends TemplateVersionRow {
  entity_status: string;
  updated_at: string;
}

const listSchema = z.object({
  search: z.string().trim().max(200).optional(),
  domain: z.enum(domains).optional(),
  status: z.enum(lifecycleStatuses).optional(),
}).strict();

export function createTemplatesRouter(database: Knex): Router {
  const router = Router();
  router.get('/export.json', async (_request, response, next) => {
    try {
      response.setHeader('Content-Disposition', 'attachment; filename="quick-interview-templates.json"');
      response.json(await exportTemplates(database));
    } catch (error) {
      next(error);
    }
  });
  router.post('/import', async (request, response, next) => {
    try {
      const input = z.object({ dryRun: z.boolean().default(true), document: z.unknown() }).strict().parse(request.body);
      response.json(await importTemplates(
        database, input.document, input.dryRun, getAuth(response), response.locals.requestId as string | undefined,
      ));
    } catch (error) {
      next(error);
    }
  });
  router.get('/', async (request, response, next) => {
    try {
      const filters = listSchema.parse(request.query);
      let query = database('test_templates as templates')
        .join('test_template_versions as versions', function joinCurrent() {
          this.on('versions.template_id', 'templates.id').andOn('versions.version', 'templates.current_version');
        })
        .select<TemplateListRow[]>('versions.*', 'templates.status as entity_status', 'templates.updated_at');
      if (filters.search) query = query.where((builder) => builder
        .whereILike('versions.title', `%${filters.search}%`)
        .orWhereILike('versions.description', `%${filters.search}%`));
      if (filters.domain) query = query.where('versions.domain', filters.domain);
      if (filters.status) query = query.where('templates.status', filters.status);
      const rows = await query.orderBy('templates.updated_at', 'desc');
      response.json({ templates: await Promise.all(rows.map(async (row) => {
        const questions = await database<TemplateQuestionRow>('test_template_questions')
          .where({ template_version_id: row.id }).orderBy('position');
        return { ...mapTemplateVersion(row, questions, row.entity_status), updatedAt: row.updated_at };
      })) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (request, response, next) => {
    try {
      const id = await createTemplate(
        database, templateInputSchema.parse(request.body), getAuth(response), response.locals.requestId as string | undefined,
      );
      response.status(201).json(await getTemplate(database, id));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:templateId', async (request, response, next) => {
    try {
      response.json(await getTemplate(database, z.string().uuid().parse(request.params.templateId)));
    } catch (error) {
      next(error);
    }
  });

  router.put('/:templateId', async (request, response, next) => {
    try {
      const templateId = z.string().uuid().parse(request.params.templateId);
      await updateTemplate(
        database, templateId, templateInputSchema.parse(request.body), getAuth(response),
        response.locals.requestId as string | undefined,
      );
      response.json(await getTemplate(database, templateId));
    } catch (error) {
      next(error);
    }
  });

  router.post('/:templateId/publish', async (request, response, next) => {
    try {
      const templateId = z.string().uuid().parse(request.params.templateId);
      const version = await publishTemplate(database, templateId, getAuth(response), response.locals.requestId as string | undefined);
      response.json({ id: templateId, version, status: 'PUBLISHED' });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:templateId/archive', async (request, response, next) => {
    try {
      const templateId = z.string().uuid().parse(request.params.templateId);
      await archiveTemplate(database, templateId, getAuth(response), response.locals.requestId as string | undefined);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get('/:templateId/preview', async (request, response, next) => {
    try {
      response.json(await previewTemplate(database, z.string().uuid().parse(request.params.templateId)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:templateId/versions', async (request, response, next) => {
    try {
      const templateId = z.string().uuid().parse(request.params.templateId);
      const versions = await database<TemplateVersionRow>('test_template_versions')
        .where({ template_id: templateId }).orderBy('version', 'desc');
      response.json({ versions: await Promise.all(versions.map(async (version) => {
        const questions = await database<TemplateQuestionRow>('test_template_questions')
          .where({ template_version_id: version.id }).orderBy('position');
        return mapTemplateVersion(version, questions);
      })) });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
