let csrfToken = '';
let currentUser;
let activeDomains = [];

const moduleRoot = document.querySelector('#app-module');
const messageStack = document.querySelector('#message-stack');
const pageTitle = document.querySelector('#page-title');
const pageDescription = document.querySelector('#page-description');
const pageKicker = document.querySelector('#page-kicker');

const questionTypes = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SHORT_ANSWER', 'LONG_ANSWER', 'CODE_ANSWER', 'SCENARIO'];
const difficulties = ['JUNIOR', 'MID', 'SENIOR', 'EXPERT'];
const routeMeta = {
  overview: ['Workspace overview', 'See coverage, publishing progress, and the next interview actions.'],
  domains: ['Domain management', 'Grow and organize the disciplines your interview library can assess.'],
  questions: ['Question bank', 'View details, edit drafts safely, import JSON, and generate AI-assisted questions.'],
  templates: ['Test templates', 'Build, preview, edit, publish, and retire reusable assessments.'],
  attempts: ['Candidate attempts', 'Issue scoped links, edit candidate details, and cancel unused attempts.'],
  results: ['Results & review', 'Review each answer with pass/fail status and full question context.'],
  users: ['Users & audit', 'Provision administrative roles and review recent sensitive actions.'],
};

function node(name, attributes = {}, text = '') {
  const element = document.createElement(name);
  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== undefined && value !== null) element.setAttribute(key, String(value));
  });
  if (text !== '') element.textContent = text;
  return element;
}

function field(labelText, name, type = 'text', value = '', options = {}) {
  const label = node('label', { class: options.className || 'field' });
  label.append(node('span', { class: 'field-label' }, labelText));
  const attributes = { name, type, ...(options.placeholder ? { placeholder: options.placeholder } : {}) };
  const input = type === 'textarea'
    ? node('textarea', { name, rows: options.rows || '5', placeholder: options.placeholder })
    : node('input', attributes);
  input.value = value ?? '';
  if (options.required) input.required = true;
  if (options.min !== undefined) input.min = String(options.min);
  if (options.max !== undefined) input.max = String(options.max);
  if (options.step !== undefined) input.step = String(options.step);
  if (options.accept) input.accept = options.accept;
  if (options.help) label.append(input, node('small', { class: 'field-help' }, options.help));
  else label.append(input);
  return label;
}

function selectField(labelText, name, options, selected = '') {
  const label = node('label', { class: 'field' });
  label.append(node('span', { class: 'field-label' }, labelText));
  const select = node('select', { name });
  options.forEach((option) => {
    const normalized = typeof option === 'string' ? { value: option, label: humanize(option) } : option;
    const optionElement = node('option', { value: normalized.value }, normalized.label);
    if (normalized.value === selected) optionElement.selected = true;
    select.append(optionElement);
  });
  label.append(select);
  return label;
}

function checkboxField(labelText, name, checked = false) {
  const label = node('label', { class: 'checkbox-field' });
  const input = node('input', { type: 'checkbox', name });
  input.checked = checked;
  label.append(input, node('span', {}, labelText));
  return label;
}

function humanize(value) {
  return String(value || '').toLocaleLowerCase('en-US').replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toLocaleUpperCase('en-US'));
}

function domainName(slug) {
  return activeDomains.find((domain) => domain.slug === slug)?.name || humanize(slug);
}

function formatDate(value) {
  if (!value) return 'Not yet';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function badge(text, tone = '') {
  return node('span', { class: `badge ${tone}`.trim() }, text);
}

function statusBadge(status) {
  const tones = {
    PUBLISHED: 'success', DRAFT: 'warning', ARCHIVED: 'muted',
    SUBMITTED: 'success', IN_PROGRESS: 'info', STARTED: 'info', CREATED: 'muted',
    INVITED: 'muted', EXPIRED: 'danger', CANCELLED: 'danger',
  };
  return badge(humanize(status), tones[status] || 'muted');
}

function button(text, className = 'button primary', type = 'button') {
  return node('button', { type, class: className }, text);
}

function actionButton(text, action, secondary = false) {
  const control = button(text, secondary ? 'button quiet-button small' : 'button primary small');
  control.addEventListener('click', async () => {
    control.disabled = true;
    try {
      await action();
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      control.disabled = false;
    }
  });
  return control;
}

function showMessage(text, error = false) {
  const message = node('div', { class: error ? 'toast error' : 'toast success', role: error ? 'alert' : 'status' });
  message.append(node('strong', {}, error ? 'Action needed' : 'Done'), node('span', {}, text));
  messageStack.replaceChildren(message);
  setTimeout(() => message.remove(), 7000);
}

function emptyState(title, description, link) {
  const empty = node('div', { class: 'empty-state' });
  empty.append(node('span', { class: 'empty-mark' }, 'QI'), node('h3', {}, title), node('p', {}, description));
  if (link) empty.append(node('a', { class: 'button primary', href: link.href }, link.label));
  return empty;
}

function loadingState(label = 'Loading workspace data...') {
  const loading = node('div', { class: 'loading-state' });
  loading.append(node('span', { class: 'spinner' }), node('p', {}, label));
  return loading;
}

function sectionHeader(title, description, actions = []) {
  const header = node('div', { class: 'section-header' });
  const copy = node('div');
  copy.append(node('h2', {}, title), node('p', {}, description));
  const actionGroup = node('div', { class: 'section-actions' });
  actions.forEach((action) => actionGroup.append(action));
  header.append(copy, actionGroup);
  return header;
}

function modal(title, content, actions = []) {
  const dialog = node('dialog', { class: 'modal-dialog' });
  const shell = node('div', { class: 'modal-shell' });
  const close = button('Close', 'button quiet-button small');
  close.addEventListener('click', () => dialog.close());
  shell.append(sectionHeader(title, '', [close, ...actions]), content);
  dialog.append(shell);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
  return dialog;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(!['GET', 'HEAD'].includes(options.method || 'GET') ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(options.headers || {}),
    },
  });
  if (response.status === 204) return undefined;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `Request failed (${response.status})`);
  return body;
}

async function refreshDomains(status = 'ACTIVE') {
  const payload = await api(`/api/domains?status=${status}`);
  activeDomains = payload.domains.filter((domain) => domain.isActive);
  return payload.domains;
}

function domainOptions(includePlaceholder = false) {
  const options = activeDomains.map((domain) => ({ value: domain.slug, label: domain.name }));
  if (includePlaceholder) options.unshift({ value: '', label: 'All domains' });
  return options;
}

function metricCard(label, value, supporting, tone = '') {
  const card = node('article', { class: `metric-card ${tone}`.trim() });
  card.append(node('p', {}, label), node('strong', {}, String(value)), node('small', {}, supporting));
  return card;
}

function answerToText(value) {
  if (value === null || value === undefined || value === '') return 'No answer';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function questionPayloadFromForm(form) {
  const data = new FormData(form);
  const type = String(data.get('type'));
  const choiceType = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE'].includes(type);
  const choices = choiceType ? String(data.get('choicesText') || '').split(/\r?\n/)
    .map((label) => label.trim()).filter(Boolean)
    .map((label, index) => ({ id: `choice_${index + 1}`, label })) : [];
  const correctChoiceIds = choiceType ? String(data.get('correctChoices') || '').split(',')
    .map((part) => Number(part.trim())).filter((index) => Number.isInteger(index) && index > 0)
    .map((index) => `choice_${index}`) : [];
  return {
    title: data.get('title'),
    description: data.get('description'),
    prompt: data.get('prompt'),
    domain: data.get('domain'),
    type,
    difficulty: data.get('difficulty'),
    expectedDurationMinutes: Number(data.get('expectedDurationMinutes')),
    maximumScore: Number(data.get('maximumScore')),
    choices,
    answerKey: { correctChoiceIds },
    scoringRubric: choiceType ? '' : data.get('scoringRubric'),
    tags: String(data.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean),
  };
}

function choicesText(question) {
  return (question?.choices || []).map((choice) => choice.label).join('\n') || 'Option A\nOption B';
}

function correctChoicesText(question) {
  const ids = question?.answerKey?.correctChoiceIds || [];
  return ids.map((id) => Number(String(id).replace('choice_', ''))).filter(Boolean).join(',') || '1';
}

function buildQuestionForm(existing, onSaved) {
  const details = node('details', { class: 'panel composer-panel' });
  details.open = Boolean(existing);
  details.append(node('summary', { class: 'composer-summary' }, existing ? 'Edit question' : 'Create a question'));
  const form = node('form', { class: 'form-grid question-form' });
  const type = existing?.type || 'SINGLE_CHOICE';
  const typeField = selectField('Answer format', 'type', questionTypes, type);
  const typeSelect = typeField.querySelector('select');
  const choicesField = field('Choices (one per line)', 'choicesText', 'textarea', choicesText(existing), { rows: 5, help: 'Choice numbers are assigned from top to bottom.' });
  const correctField = field('Correct choice number(s)', 'correctChoices', 'text', correctChoicesText(existing), { help: 'For multiple choice, use commas: 1,3' });
  const rubricField = field('Scoring rubric', 'scoringRubric', 'textarea', existing?.scoringRubric || '', { rows: 5, help: 'Required for written, scenario, and code answers.' });
  const choiceBlock = node('div', { class: 'subform span-full' });
  choiceBlock.append(choicesField, correctField);
  form.append(
    field('Question title', 'title', 'text', existing?.title || '', { required: true, placeholder: 'Parallel browser isolation' }),
    selectField('Domain', 'domain', domainOptions(), existing?.domain || activeDomains[0]?.slug || ''),
    typeField,
    selectField('Difficulty', 'difficulty', difficulties, existing?.difficulty || 'MID'),
    field('Expected minutes', 'expectedDurationMinutes', 'number', existing?.expectedDurationMinutes || '8', { required: true, min: 1, max: 240 }),
    field('Maximum score', 'maximumScore', 'number', existing?.maximumScore || '10', { required: true, min: 1, step: '0.5' }),
    field('Short description', 'description', 'textarea', existing?.description || '', { className: 'field span-full', rows: 2 }),
    field('Candidate prompt', 'prompt', 'textarea', existing?.prompt || '', { className: 'field span-full', rows: 6, required: true }),
    choiceBlock,
    rubricField,
    field('Tags', 'tags', 'text', (existing?.tags || []).join(', '), { className: 'field span-full', help: 'Comma-separated labels improve filtering and reuse.' }),
    button(existing ? 'Save question changes' : 'Save draft question', 'button primary', 'submit'),
  );
  function updateType() {
    const choiceType = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE'].includes(typeSelect.value);
    choiceBlock.hidden = !choiceType;
    rubricField.hidden = choiceType;
    rubricField.querySelector('textarea').required = !choiceType;
  }
  typeSelect.addEventListener('change', updateType);
  updateType();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const payload = questionPayloadFromForm(form);
      if (existing) await api(`/api/questions/${existing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/api/questions', { method: 'POST', body: JSON.stringify(payload) });
      showMessage(existing ? 'Question updated as a draft.' : 'Draft question created.');
      if (onSaved) await onSaved();
      else await renderQuestions();
    } catch (error) {
      showMessage(error.message, true);
    }
  });
  details.append(form);
  return details;
}

function questionDetail(question) {
  const content = node('div', { class: 'detail-stack' });
  const meta = node('div', { class: 'detail-grid' });
  meta.append(
    metricCard('Status', humanize(question.status), `Version ${question.version}`),
    metricCard('Domain', domainName(question.domain), humanize(question.difficulty)),
    metricCard('Score', question.maximumScore, `${question.expectedDurationMinutes} minutes`),
  );
  const prompt = node('section', { class: 'answer-panel' });
  prompt.append(node('small', {}, 'Candidate prompt'), node('pre', {}, question.prompt));
  content.append(meta, node('p', {}, question.description || 'No description.'), prompt);
  if (question.choices?.length) {
    const choices = node('section', { class: 'answer-panel' });
    choices.append(node('small', {}, 'Choices'));
    question.choices.forEach((choice) => choices.append(node('p', {}, `${choice.id}: ${choice.label}`)));
    content.append(choices);
  }
  const key = node('section', { class: 'answer-panel' });
  key.append(node('small', {}, 'Answer key and scoring'), node('pre', {}, question.scoringRubric || JSON.stringify(question.answerKey, null, 2)));
  content.append(key);
  if (question.tags?.length) {
    const tags = node('div', { class: 'tag-row' });
    question.tags.forEach((tag) => tags.append(badge(tag, 'tag')));
    content.append(tags);
  }
  modal(question.title, content);
}

function questionCard(question) {
  const card = node('article', { class: 'question-card-admin' });
  const header = node('div', { class: 'question-card-header' });
  const title = node('div');
  title.append(node('div', { class: 'badge-row' }), node('h3', {}, question.title));
  title.firstElementChild.append(statusBadge(question.status), badge(domainName(question.domain), 'domain'), badge(humanize(question.difficulty), 'muted'));
  header.append(title, node('span', { class: 'score-chip' }, `${question.maximumScore} pts`));
  const description = node('p', { class: 'question-description' }, question.description || question.prompt.slice(0, 180));
  const meta = node('div', { class: 'question-meta-row' });
  meta.append(node('span', {}, humanize(question.type)), node('span', {}, `${question.expectedDurationMinutes} min`), node('span', {}, `Version ${question.version}`));
  const tagRow = node('div', { class: 'tag-row' });
  (question.tags || []).forEach((tag) => tagRow.append(badge(tag, 'tag')));
  const actions = node('div', { class: 'inline-actions' });
  actions.append(actionButton('Details', () => questionDetail(question), true));
  actions.append(actionButton('Edit', () => {
    const content = node('div');
    const dialog = modal('Edit question', content);
    content.append(buildQuestionForm(question, async () => { dialog.close(); await renderQuestions(); }));
  }, true));
  if (question.status === 'DRAFT') actions.append(actionButton('Publish', async () => {
    await api(`/api/questions/${question.id}/publish`, { method: 'POST', body: '{}' });
    showMessage('Question published and ready for templates.');
    await renderQuestions();
  }));
  actions.append(actionButton('Duplicate', async () => {
    await api(`/api/questions/${question.id}/duplicate`, { method: 'POST', body: '{}' });
    showMessage('A draft copy was created.');
    await renderQuestions();
  }, true));
  if (question.status !== 'ARCHIVED') actions.append(actionButton('Delete', async () => {
    if (!confirm('Archive this question? Existing published snapshots and results stay intact.')) return;
    await api(`/api/questions/${question.id}`, { method: 'DELETE', body: '{}' });
    showMessage('Question archived.');
    await renderQuestions();
  }, true));
  card.append(header, description, meta, tagRow, actions);
  return card;
}

function buildImportPanel() {
  const panel = node('details', { class: 'panel composer-panel' });
  panel.append(node('summary', { class: 'composer-summary' }, 'Import question bank JSON'));
  const form = node('form', { class: 'form-grid' });
  const file = field('Question bank JSON file', 'document', 'file', '', { className: 'field span-full', accept: 'application/json,.json', required: true });
  const output = node('div', { class: 'credential-output span-full', hidden: '' });
  form.append(file, button('Check import', 'button quiet-button', 'button'), button('Import questions', 'button primary', 'submit'), output);
  const input = file.querySelector('input');
  async function readDocument() {
    if (!input.files?.[0]) throw new Error('Choose a JSON file first.');
    return JSON.parse(await input.files[0].text());
  }
  form.querySelector('button[type="button"]').addEventListener('click', async () => {
    try {
      const result = await api('/api/questions/import', { method: 'POST', body: JSON.stringify({ dryRun: true, document: await readDocument() }) });
      output.hidden = false;
      output.replaceChildren(node('strong', {}, 'Import check'), node('span', {}, `${result.conflicts.length} conflicts found.`));
    } catch (error) {
      showMessage(error.message, true);
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await api('/api/questions/import', { method: 'POST', body: JSON.stringify({ dryRun: false, document: await readDocument() }) });
      showMessage(`${result.imported} questions imported.`);
      await renderQuestions();
    } catch (error) {
      showMessage(error.message, true);
    }
  });
  panel.append(form);
  return panel;
}

function buildAiPanel() {
  const panel = node('details', { class: 'panel composer-panel' });
  panel.append(node('summary', { class: 'composer-summary' }, 'AI Assistant: generate questions'));
  const form = node('form', { class: 'form-grid' });
  const output = node('div', { class: 'ai-draft-list span-full' });
  form.append(
    selectField('Domain', 'domain', domainOptions(), activeDomains[0]?.slug || ''),
    field('Topic focus', 'topic', 'text', '', { placeholder: 'API automation, k6 analysis, CI flaky tests...' }),
    selectField('Difficulty', 'difficulty', difficulties, 'MID'),
    selectField('Format', 'type', [{ value: '', label: 'Mixed formats' }, ...questionTypes.map((value) => ({ value, label: humanize(value) }))]),
    field('Number of questions', 'count', 'number', '5', { min: 1, max: 20 }),
    button('Generate drafts', 'button primary', 'submit'),
    output,
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    output.replaceChildren(loadingState('Asking AI Assistant...'));
    const data = new FormData(form);
    try {
      const payload = await api('/api/ai/questions', { method: 'POST', body: JSON.stringify({
        domain: data.get('domain'),
        topic: data.get('topic'),
        difficulty: data.get('difficulty'),
        count: Number(data.get('count')),
        ...(data.get('type') ? { type: data.get('type') } : {}),
      }) });
      output.replaceChildren();
      payload.questions.forEach((draft) => {
        const card = questionCard({ ...draft, id: '', version: 1, versionId: '', status: 'DRAFT' });
        card.querySelector('.inline-actions').replaceChildren(actionButton('Save draft', async () => {
          await api('/api/questions', { method: 'POST', body: JSON.stringify(draft) });
          showMessage('AI draft saved to the question bank.');
          await renderQuestions();
        }));
        output.append(card);
      });
    } catch (error) {
      output.replaceChildren(emptyState('AI generation failed', error.message));
    }
  });
  panel.append(form);
  return panel;
}

async function renderOverview() {
  moduleRoot.replaceChildren(loadingState());
  const canAuthor = ['ADMIN', 'INTERVIEWER'].includes(currentUser.role);
  const canReview = ['ADMIN', 'REVIEWER'].includes(currentUser.role);
  const [domains, questionPayload, templatePayload, attemptPayload, resultPayload] = await Promise.all([
    refreshDomains('ALL'),
    canAuthor ? api('/api/questions') : Promise.resolve({ questions: [] }),
    canAuthor ? api('/api/templates') : Promise.resolve({ templates: [] }),
    canAuthor ? api('/api/test-instances') : Promise.resolve({ instances: [] }),
    canReview ? api('/api/results') : Promise.resolve({ results: [] }),
  ]);
  const questions = questionPayload.questions;
  const templates = templatePayload.templates;
  const instances = attemptPayload.instances;
  const results = resultPayload.results;
  const hero = node('section', { class: 'overview-hero' });
  const heroCopy = node('div');
  heroCopy.append(node('span', { class: 'hero-label' }, 'Interview readiness'), node('h2', {}, 'Build evidence, not busywork.'), node('p', {}, 'Curate questions, assemble focused assessments, and keep every candidate decision traceable.'));
  const heroActions = node('div', { class: 'hero-actions' });
  if (canAuthor) heroActions.append(node('a', { class: 'button light', href: '#questions' }, 'Open question bank'), node('a', { class: 'button glass', href: '#attempts' }, 'Invite candidate'));
  else heroActions.append(node('a', { class: 'button light', href: '#results' }, 'Review results'));
  hero.append(heroCopy, heroActions);
  const metrics = node('section', { class: 'metric-grid' });
  metrics.append(
    metricCard('Active domains', domains.filter((domain) => domain.isActive).length, 'Interview disciplines', 'accent'),
    metricCard('Published questions', questions.filter((question) => question.status === 'PUBLISHED').length, `${questions.length} total in the library`),
    metricCard('Published templates', templates.filter((template) => template.status === 'PUBLISHED').length, `${templates.length} total assessment designs`),
    metricCard(canReview ? 'Submitted results' : 'Candidate attempts', canReview ? results.filter((result) => result.state === 'SUBMITTED').length : instances.length, canReview ? `${results.length} results visible` : 'Private delivery records'),
  );
  moduleRoot.replaceChildren(hero, metrics);
}

async function renderDomains() {
  moduleRoot.replaceChildren(loadingState('Loading domains...'));
  const domains = await refreshDomains('ALL');
  const createPanel = node('section', { class: 'panel composer-panel' });
  const createDetails = node('details');
  createDetails.append(node('summary', { class: 'composer-summary' }, 'Add a new interview domain'));
  const form = node('form', { class: 'form-grid domain-form' });
  form.append(
    field('Domain name', 'name', 'text', '', { required: true, placeholder: 'Security Testing' }),
    field('Identifier (optional)', 'slug', 'text', '', { placeholder: 'SECURITY_TESTING' }),
    field('Description', 'description', 'textarea', '', { className: 'field span-full', rows: 3 }),
    button('Create domain', 'button primary', 'submit'),
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      await api('/api/domains', { method: 'POST', body: JSON.stringify({ name: data.get('name'), slug: data.get('slug') || undefined, description: data.get('description') }) });
      showMessage('Domain created.');
      await renderDomains();
    } catch (error) {
      showMessage(error.message, true);
    }
  });
  createDetails.append(form);
  createPanel.append(createDetails);
  const listPanel = node('section', { class: 'panel' });
  listPanel.append(sectionHeader('Interview domains', `${domains.filter((domain) => domain.isActive).length} active domains`));
  const grid = node('div', { class: 'domain-management-grid' });
  domains.forEach((domain) => {
    const card = node('article', { class: `domain-card ${domain.isActive ? '' : 'is-archived'}`.trim() });
    const top = node('div', { class: 'domain-card-top' });
    const title = node('div');
    title.append(node('span', { class: 'domain-monogram large' }, domain.name.slice(0, 2).toLocaleUpperCase('en-US')), node('div'));
    title.lastElementChild.append(node('h3', {}, domain.name), node('code', {}, domain.slug));
    top.append(title, badge(domain.isActive ? 'Active' : 'Archived', domain.isActive ? 'success' : 'muted'));
    const edit = node('details', { class: 'inline-editor' });
    edit.append(node('summary', {}, 'Edit details'));
    const editForm = node('form', { class: 'stack-form' });
    editForm.append(field('Display name', 'name', 'text', domain.name, { required: true }), field('Description', 'description', 'textarea', domain.description, { rows: 3 }), button('Save changes', 'button primary small', 'submit'));
    editForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(editForm);
      try {
        await api(`/api/domains/${domain.id}`, { method: 'PUT', body: JSON.stringify({ name: data.get('name'), description: data.get('description') }) });
        showMessage('Domain details updated.');
        await renderDomains();
      } catch (error) {
        showMessage(error.message, true);
      }
    });
    edit.append(editForm);
    card.append(top, node('p', {}, domain.description || 'No description yet.'), node('div', { class: 'domain-stat-row' }, `${domain.questionCount} questions | ${domain.templateCount} templates`), edit, actionButton(domain.isActive ? 'Archive domain' : 'Reactivate domain', async () => {
      await api(`/api/domains/${domain.id}/${domain.isActive ? 'archive' : 'reactivate'}`, { method: 'POST', body: '{}' });
      await renderDomains();
    }, true));
    grid.append(card);
  });
  listPanel.append(grid);
  moduleRoot.replaceChildren(sectionHeader('Domain management', 'Create durable categories for every interview discipline you support.'), createPanel, listPanel);
}

async function renderQuestions() {
  moduleRoot.replaceChildren(loadingState('Loading question bank...'));
  if (!activeDomains.length) await refreshDomains();
  const header = sectionHeader('Question bank', 'Published versions are immutable; editing later creates a safe new draft.');
  const listPanel = node('section', { class: 'panel' });
  const filters = node('form', { class: 'filter-bar' });
  filters.append(
    field('Search', 'search', 'search', '', { placeholder: 'Search title or description' }),
    selectField('Domain', 'domain', domainOptions(true)),
    selectField('Status', 'status', [{ value: '', label: 'All statuses' }, ...['DRAFT', 'PUBLISHED', 'ARCHIVED'].map((value) => ({ value, label: humanize(value) }))]),
    selectField('Format', 'type', [{ value: '', label: 'All formats' }, ...questionTypes.map((value) => ({ value, label: humanize(value) }))]),
    button('Apply filters', 'button quiet-button', 'submit'),
  );
  const countLabel = node('p', { class: 'list-count' });
  const list = node('div', { class: 'question-grid' });
  async function loadList() {
    list.replaceChildren(loadingState('Filtering questions...'));
    const data = new FormData(filters);
    const parameters = new URLSearchParams();
    for (const key of ['search', 'domain', 'status', 'type']) if (data.get(key)) parameters.set(key, String(data.get(key)));
    const payload = await api(`/api/questions?${parameters}`);
    countLabel.textContent = `${payload.questions.length} question${payload.questions.length === 1 ? '' : 's'}`;
    list.replaceChildren();
    payload.questions.forEach((question) => list.append(questionCard(question)));
    if (!payload.questions.length) list.append(emptyState('No matching questions', 'Change the filters or create a new question.'));
  }
  filters.addEventListener('submit', (event) => {
    event.preventDefault();
    void loadList().catch((error) => showMessage(error.message, true));
  });
  listPanel.append(filters, countLabel, list);
  moduleRoot.replaceChildren(header, buildQuestionForm(), buildImportPanel(), buildAiPanel(), listPanel);
  await loadList();
}

function templatePayloadFromForm(form) {
  const data = new FormData(form);
  const selected = Array.from(form.querySelectorAll('input[name="questionVersionId"]:checked')).map((input, index) => ({
    questionVersionId: input.value,
    sectionKey: 'main',
    position: index + 1,
    scoreWeight: 1,
    required: true,
  }));
  return {
    title: data.get('title'),
    description: data.get('description'),
    domain: data.get('domain'),
    targetSeniority: data.get('targetSeniority'),
    durationMinutes: Number(data.get('durationMinutes')),
    randomizeQuestions: data.get('randomizeQuestions') === 'on',
    selectionMode: 'FIXED',
    sections: [{ key: 'main', title: 'Interview' }],
    navigation: { allowBack: true, requireSequential: false },
    questions: selected,
  };
}

function buildTemplateForm(questions, existing, onSaved) {
  const form = node('form', { class: 'form-grid template-form' });
  const domainField = selectField('Domain', 'domain', domainOptions(), existing?.domain || activeDomains[0]?.slug || '');
  const domainSelect = domainField.querySelector('select');
  const picker = node('div', { class: 'question-picker span-full' });
  const selectedIds = new Set((existing?.questions || []).map((question) => question.questionVersionId));
  function refreshPicker() {
    picker.replaceChildren(node('div', { class: 'picker-heading' }, 'Select published questions'));
    const matching = questions.filter((question) => question.domain === domainSelect.value);
    matching.forEach((question) => {
      const label = node('label', { class: 'picker-row' });
      const input = node('input', { type: 'checkbox', name: 'questionVersionId', value: question.versionId });
      input.checked = selectedIds.has(question.versionId);
      const copy = node('span');
      copy.append(node('strong', {}, question.title), node('small', {}, `${humanize(question.difficulty)} | ${humanize(question.type)} | ${question.expectedDurationMinutes} min | ${question.maximumScore} pts`));
      label.append(input, copy);
      picker.append(label);
    });
    if (!matching.length) picker.append(emptyState('No published questions in this domain', 'Publish questions before composing a template.', { href: '#questions', label: 'Open question bank' }));
  }
  domainSelect.addEventListener('change', refreshPicker);
  form.append(
    field('Template title', 'title', 'text', existing?.title || '', { required: true, placeholder: 'Senior automation engineer screen' }),
    domainField,
    selectField('Target seniority', 'targetSeniority', ['JUNIOR', 'MID', 'SENIOR', 'EXPERT', 'MIXED'], existing?.targetSeniority || 'MID'),
    field('Duration minutes', 'durationMinutes', 'number', existing?.durationMinutes || '60', { required: true, min: 1, max: 480 }),
    field('Description', 'description', 'textarea', existing?.description || '', { className: 'field span-full', rows: 3 }),
    checkboxField('Randomize question order for each candidate', 'randomizeQuestions', Boolean(existing?.randomizeQuestions)),
    picker,
    button(existing ? 'Save template changes' : 'Save draft template', 'button primary', 'submit'),
  );
  refreshPicker();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = templatePayloadFromForm(form);
    if (!payload.questions.length) {
      showMessage('Select at least one published question.', true);
      return;
    }
    try {
      if (existing) await api(`/api/templates/${existing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/api/templates', { method: 'POST', body: JSON.stringify(payload) });
      showMessage(existing ? 'Template updated as a draft.' : 'Draft template created.');
      await onSaved();
    } catch (error) {
      showMessage(error.message, true);
    }
  });
  return form;
}

function previewTemplate(templateId) {
  return async () => {
    const preview = await api(`/api/templates/${templateId}/preview`);
    const content = node('div', { class: 'detail-stack' });
    content.append(node('p', {}, `${preview.durationMinutes} minutes | ${humanize(preview.targetSeniority)} | ${preview.questions.length} questions`));
    preview.questions.forEach((question, index) => {
      const card = node('article', { class: 'review-card preview-card' });
      card.append(node('span', { class: 'question-number' }, `Question ${index + 1}`), node('h3', {}, question.title), node('p', { class: 'prompt' }, question.prompt));
      if (question.choices?.length) {
        const choices = node('div', { class: 'answer-panel' });
        choices.append(node('small', {}, 'Candidate choices'));
        question.choices.forEach((choice) => choices.append(node('p', {}, choice.label)));
        card.append(choices);
      }
      content.append(card);
    });
    modal(preview.title, content);
  };
}

async function renderTemplates() {
  moduleRoot.replaceChildren(loadingState('Loading templates...'));
  if (!activeDomains.length) await refreshDomains();
  const [questionPayload, templatePayload] = await Promise.all([api('/api/questions?status=PUBLISHED'), api('/api/templates')]);
  const questions = questionPayload.questions;
  const composer = node('details', { class: 'panel composer-panel' });
  composer.append(node('summary', { class: 'composer-summary' }, 'Create a test template'));
  composer.append(buildTemplateForm(questions, null, renderTemplates));
  const listPanel = node('section', { class: 'panel' });
  listPanel.append(sectionHeader('Assessment templates', `${templatePayload.templates.length} reusable interview designs`));
  const list = node('div', { class: 'data-list' });
  templatePayload.templates.forEach((template) => {
    const record = node('article', { class: 'template-row' });
    const title = node('div');
    title.append(node('div', { class: 'badge-row' }), node('h3', {}, template.title), node('p', {}, template.description || 'No description.'));
    title.firstElementChild.append(statusBadge(template.status), badge(domainName(template.domain), 'domain'));
    const metrics = node('div', { class: 'template-metrics' });
    metrics.append(node('span', {}, `${template.questions.length} questions`), node('span', {}, `${template.durationMinutes} min`), node('span', {}, humanize(template.targetSeniority)));
    const actions = node('div', { class: 'inline-actions' });
    actions.append(actionButton('Preview', previewTemplate(template.id), true));
    actions.append(actionButton('Edit', async () => {
      const full = await api(`/api/templates/${template.id}`);
      const content = node('div');
      const dialog = modal('Edit template', content);
      content.append(buildTemplateForm(questions, full, async () => { dialog.close(); await renderTemplates(); }));
    }, true));
    if (template.status === 'DRAFT') actions.append(actionButton('Publish', async () => {
      await api(`/api/templates/${template.id}/publish`, { method: 'POST', body: '{}' });
      showMessage('Template published and ready for candidate attempts.');
      await renderTemplates();
    }));
    if (template.status !== 'ARCHIVED') actions.append(actionButton('Delete', async () => {
      if (!confirm('Archive this template? Existing assigned attempts stay intact.')) return;
      await api(`/api/templates/${template.id}`, { method: 'DELETE', body: '{}' });
      showMessage('Template archived.');
      await renderTemplates();
    }, true));
    record.append(title, metrics, actions);
    list.append(record);
  });
  if (!templatePayload.templates.length) list.append(emptyState('No templates yet', 'Select published questions above to create the first assessment.'));
  listPanel.append(list);
  moduleRoot.replaceChildren(sectionHeader('Test templates', 'Compose candidate-ready assessments from your published library.'), composer, listPanel);
}

function localDatetime(offsetMs) {
  const date = new Date(Date.now() + offsetMs - new Date().getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

async function renderAttempts() {
  moduleRoot.replaceChildren(loadingState('Loading candidate attempts...'));
  const [templatePayload, attemptPayload] = await Promise.all([api('/api/templates?status=PUBLISHED'), api('/api/test-instances')]);
  const templates = templatePayload.templates;
  const composer = node('details', { class: 'panel composer-panel' });
  composer.append(node('summary', { class: 'composer-summary' }, 'Invite a candidate'));
  if (!templates.length) {
    composer.append(emptyState('Publish a template first', 'Candidate links are created from immutable published templates.', { href: '#templates', label: 'Open templates' }));
  } else {
    const form = node('form', { class: 'form-grid' });
    const credentials = node('div', { class: 'credential-output', hidden: '' });
    form.append(
      selectField('Published template', 'templateId', templates.map((template) => ({ value: template.id, label: `${template.title} | ${domainName(template.domain)}` }))),
      field('Candidate name', 'name', 'text', '', { required: true }),
      field('Candidate email', 'email', 'email'),
      selectField('Delivery mode', 'deliveryMode', [{ value: 'STANDARD_WEB', label: 'Standard Web' }, { value: 'COLAB_GRADIO', label: 'Colab + Gradio' }]),
      field('Available from', 'availableFrom', 'datetime-local', localDatetime(-60_000), { required: true }),
      field('Available until', 'availableUntil', 'datetime-local', localDatetime(86_400_000), { required: true }),
      field('Duration minutes', 'durationMinutes', 'number', '60', { required: true, min: 1, max: 480 }),
      button('Create private attempt', 'button primary', 'submit'),
      credentials,
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      try {
        const created = await api('/api/test-instances', { method: 'POST', body: JSON.stringify({
          templateId: data.get('templateId'),
          candidate: { name: data.get('name'), email: data.get('email') || null },
          deliveryMode: data.get('deliveryMode'),
          availableFrom: new Date(data.get('availableFrom')).toISOString(),
          availableUntil: new Date(data.get('availableUntil')).toISOString(),
          durationMinutes: Number(data.get('durationMinutes')),
        }) });
        credentials.hidden = false;
        credentials.replaceChildren(node('strong', {}, 'Save these credentials now. They are shown once.'), node('code', {}, created.candidateUrl));
        if (created.runnerToken) credentials.append(node('small', {}, `Lab runner token: ${created.runnerToken}`));
        showMessage('Candidate attempt created.');
        await renderAttempts();
      } catch (error) {
        showMessage(error.message, true);
      }
    });
    composer.append(form);
  }
  const listPanel = node('section', { class: 'panel' });
  listPanel.append(sectionHeader('Delivery activity', 'Every link is scoped to one candidate, one test, and one expiry window.'));
  const attemptList = node('div', { class: 'data-list' });
  attemptPayload.instances.forEach((instance) => attemptList.append(attemptRow(instance)));
  if (!attemptPayload.instances.length) attemptList.append(emptyState('No candidate attempts', 'Create a private attempt when a published template is ready.'));
  listPanel.append(attemptList);
  moduleRoot.replaceChildren(sectionHeader('Candidate attempts', 'Create private links and track interview delivery.'), composer, listPanel);
}

function attemptRow(instance) {
  const record = node('article', { class: 'attempt-row' });
  const identity = node('div', { class: 'candidate-identity' });
  identity.append(node('span', { class: 'account-avatar pale' }, instance.candidate.name.slice(0, 1).toLocaleUpperCase('en-US')), node('div'));
  identity.lastElementChild.append(node('h3', {}, instance.candidate.name), node('p', {}, instance.candidate.email || 'No email recorded'));
  const test = node('div');
  test.append(node('strong', {}, instance.templateTitle), node('small', {}, `${humanize(instance.deliveryMode)} | ${instance.durationMinutes} min`));
  const window = node('div');
  window.append(node('small', {}, 'Availability'), node('span', {}, `${formatDate(instance.availableFrom)} - ${formatDate(instance.availableUntil)}`));
  const actions = node('div', { class: 'inline-actions' });
  actions.append(actionButton('Edit candidate', () => {
    const form = node('form', { class: 'stack-form' });
    const dialog = modal('Edit candidate', form);
    form.append(field('Candidate name', 'name', 'text', instance.candidate.name, { required: true }), field('Candidate email', 'email', 'email', instance.candidate.email || ''), button('Save candidate', 'button primary', 'submit'));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      try {
        await api(`/api/test-instances/${instance.id}/candidate`, { method: 'PUT', body: JSON.stringify({ name: data.get('name'), email: data.get('email') || null }) });
        dialog.close();
        showMessage('Candidate updated.');
        await renderAttempts();
      } catch (error) {
        showMessage(error.message, true);
      }
    });
  }, true));
  if (instance.state !== 'SUBMITTED' && instance.state !== 'CANCELLED') actions.append(actionButton('Delete', async () => {
    if (!confirm('Cancel this attempt? The candidate link will stop working.')) return;
    await api(`/api/test-instances/${instance.id}`, { method: 'DELETE', body: '{}' });
    showMessage('Candidate attempt cancelled.');
    await renderAttempts();
  }, true));
  record.append(identity, test, window, statusBadge(instance.state), actions);
  return record;
}

async function renderResults() {
  moduleRoot.replaceChildren(loadingState('Loading results...'));
  const payload = await api('/api/results');
  const downloadActions = [node('a', { class: 'button quiet-button', href: '/api/results/export.csv' }, 'Export CSV'), node('a', { class: 'button quiet-button', href: '/api/results/export.json' }, 'Export JSON')];
  const listPanel = node('section', { class: 'panel' });
  listPanel.append(sectionHeader('Candidate results', `${payload.results.length} review records`, downloadActions));
  const list = node('div', { class: 'data-list' });
  payload.results.forEach((result) => {
    const record = node('article', { class: 'result-row' });
    const identity = node('div');
    identity.append(node('h3', {}, result.candidate.name), node('p', {}, result.candidate.email || 'No email recorded'));
    const template = node('div');
    template.append(node('strong', {}, result.template.title), node('small', {}, domainName(result.template.domain)));
    const score = node('div', { class: 'result-score' });
    score.append(node('strong', {}, `${result.score}/${result.maximumScore}`), node('small', {}, 'Current score'));
    record.append(identity, template, statusBadge(result.state), score, actionButton('Review', () => renderResultDetail(result.attemptId), true));
    list.append(record);
  });
  if (!payload.results.length) list.append(emptyState('No results yet', 'Submitted candidate attempts will appear here.'));
  listPanel.append(list);
  moduleRoot.replaceChildren(sectionHeader('Results & review', 'Turn candidate submissions into consistent, auditable decisions.'), listPanel);
}

function latestScore(question) {
  return [...(question.scores || [])].sort((a, b) => b.revision - a.revision)[0];
}

function answerVerdict(question) {
  const score = latestScore(question);
  if (!question.answerId || !score) return { label: 'Unscored', tone: 'muted', className: '' };
  return score.score >= question.maximumScore
    ? { label: 'PASSED', tone: 'success', className: 'passed-answer' }
    : { label: 'FAILED', tone: 'danger', className: 'failed-answer' };
}

async function renderResultDetail(attemptId) {
  moduleRoot.replaceChildren(loadingState('Loading submission...'));
  const result = await api(`/api/results/${attemptId}`);
  const back = actionButton('Back to results', renderResults, true);
  const summary = node('section', { class: 'panel result-summary' });
  summary.append(sectionHeader(`${result.candidate.name} | ${result.template.title}`, `${result.state} | ${domainName(result.template.domain)}`, [back]), metricCard('Current score', `${result.score}/${result.maximumScore}`, 'Across automatic and manual scoring'));
  const questions = node('div', { class: 'review-list' });
  result.questions.forEach((question, index) => {
    const verdict = answerVerdict(question);
    const record = node('article', { class: `panel review-card ${verdict.className}`.trim() });
    const titleRow = node('div', { class: 'review-title-row' });
    titleRow.append(node('span', { class: 'question-number' }, `Question ${index + 1}`), badge(verdict.label, verdict.tone));
    record.append(titleRow, node('h3', {}, question.title), node('p', { class: 'prompt' }, question.prompt));
    if (question.choices?.length) {
      const choices = node('div', { class: 'answer-panel' });
      choices.append(node('small', {}, 'Choices'));
      question.choices.forEach((choice) => choices.append(node('p', {}, `${choice.id}: ${choice.label}`)));
      record.append(choices);
    }
    const answer = node('div', { class: 'answer-panel' });
    answer.append(node('small', {}, 'Candidate answer'), node('pre', {}, answerToText(question.answer)));
    const key = node('div', { class: 'answer-panel' });
    key.append(node('small', {}, 'Expected answer / rubric'), node('pre', {}, question.scoringRubric || JSON.stringify(question.answerKey, null, 2)));
    record.append(answer, key);
    const score = latestScore(question);
    if (score) record.append(badge(`Score ${score.score}/${score.maximumScore}: ${score.reason}`, verdict.tone));
    if (question.answerId) {
      const scoreForm = node('form', { class: 'inline-form score-form' });
      scoreForm.append(field(`Score (max ${question.maximumScore})`, 'score', 'number', score?.score ?? '', { required: true, min: 0, max: question.maximumScore, step: '0.5' }), field('Review reason', 'reason', 'text', score?.reason ?? '', { required: true }), button('Save score', 'button primary small', 'submit'));
      scoreForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = new FormData(scoreForm);
        try {
          await api(`/api/results/${attemptId}/scores`, { method: 'POST', body: JSON.stringify({ answerId: question.answerId, score: Number(data.get('score')), reason: data.get('reason') }) });
          showMessage('Manual score recorded.');
          await renderResultDetail(attemptId);
        } catch (error) {
          showMessage(error.message, true);
        }
      });
      record.append(scoreForm);
    }
    questions.append(record);
  });
  const commentForm = node('form', { class: 'panel inline-form' });
  commentForm.append(field('Attempt comment', 'comment', 'text', '', { required: true, placeholder: 'Add decision context for other reviewers' }), button('Add comment', 'button primary small', 'submit'));
  commentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(commentForm);
    try {
      await api(`/api/results/${attemptId}/comments`, { method: 'POST', body: JSON.stringify({ comment: data.get('comment') }) });
      showMessage('Review comment added.');
      await renderResultDetail(attemptId);
    } catch (error) {
      showMessage(error.message, true);
    }
  });
  moduleRoot.replaceChildren(summary, questions, commentForm);
}

async function renderUsers() {
  moduleRoot.replaceChildren(loadingState('Loading users and audit...'));
  const [users, audit] = await Promise.all([api('/api/admin/users'), api('/api/admin/audit?limit=25')]);
  const composer = node('details', { class: 'panel composer-panel' });
  composer.append(node('summary', { class: 'composer-summary' }, 'Provision an administrative user'));
  const form = node('form', { class: 'form-grid' });
  form.append(field('Email', 'email', 'email', '', { required: true }), field('Temporary password', 'password', 'password', '', { required: true, help: 'At least 12 characters; the user must replace it.' }), selectField('Role', 'role', ['INTERVIEWER', 'REVIEWER', 'ADMIN'], 'INTERVIEWER'), button('Provision user', 'button primary', 'submit'));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ email: data.get('email'), password: data.get('password'), role: data.get('role'), mustChangePassword: true }) });
      showMessage('Administrative user provisioned.');
      await renderUsers();
    } catch (error) {
      showMessage(error.message, true);
    }
  });
  composer.append(form);
  const userPanel = node('section', { class: 'panel' });
  userPanel.append(sectionHeader('Administrative access', `${users.users.length} named users`));
  const userList = node('div', { class: 'data-list' });
  users.users.forEach((user) => {
    const row = node('article', { class: 'user-row' });
    const identity = node('div', { class: 'candidate-identity' });
    identity.append(node('span', { class: 'account-avatar pale' }, user.email.slice(0, 1).toLocaleUpperCase('en-US')), node('div'));
    identity.lastElementChild.append(node('h3', {}, user.email), node('p', {}, user.mustChangePassword ? 'Password change required' : 'Onboarding complete'));
    row.append(identity, badge(humanize(user.role), 'domain'), badge(user.isActive ? 'Active' : 'Inactive', user.isActive ? 'success' : 'muted'));
    userList.append(row);
  });
  userPanel.append(userList);
  const auditPanel = node('section', { class: 'panel' });
  auditPanel.append(sectionHeader('Recent audit trail', 'Sensitive administrative changes recorded by the server.'));
  const auditList = node('div', { class: 'audit-list' });
  audit.audit.forEach((entry) => {
    const row = node('article');
    row.append(node('span', { class: 'audit-dot' }), node('div'));
    row.lastElementChild.append(node('strong', {}, humanize(entry.action)), node('p', {}, `${entry.actorEmail || 'System'} | ${humanize(entry.targetType)}`), node('small', {}, formatDate(entry.createdAt)));
    auditList.append(row);
  });
  auditPanel.append(auditList);
  moduleRoot.replaceChildren(sectionHeader('Users & audit', 'Keep authoring, reviewing, and administration privileges explicit.'), composer, node('div', { class: 'content-grid' }));
  moduleRoot.lastElementChild.append(userPanel, auditPanel);
}

async function renderPasswordChange() {
  document.querySelectorAll('.admin-nav a').forEach((link) => link.setAttribute('aria-disabled', 'true'));
  const card = node('section', { class: 'password-change-card' });
  card.append(node('span', { class: 'brand-mark large' }, 'QI'), node('p', { class: 'page-kicker' }, 'One secure step'), node('h2', {}, 'Replace the bootstrap password'), node('p', {}, 'Choose a permanent password before opening administrative tools. Your work remains locked until this is complete.'));
  const form = node('form', { class: 'stack-form' });
  form.append(field('Current password', 'currentPassword', 'password', '', { required: true }), field('New password (12+ characters)', 'newPassword', 'password', '', { required: true }), button('Secure my workspace', 'button primary', 'submit'));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: data.get('currentPassword'), newPassword: data.get('newPassword') }) });
      window.location.hash = '#overview';
      window.location.reload();
    } catch (error) {
      showMessage(error.message, true);
    }
  });
  card.append(form);
  moduleRoot.replaceChildren(card);
}

const renderers = { overview: renderOverview, domains: renderDomains, questions: renderQuestions, templates: renderTemplates, attempts: renderAttempts, results: renderResults, users: renderUsers };

function allowedRoutes() {
  if (currentUser.role === 'ADMIN') return Object.keys(renderers);
  if (currentUser.role === 'INTERVIEWER') return ['overview', 'questions', 'templates', 'attempts'];
  return ['overview', 'results'];
}

function configureNavigation() {
  const allowed = allowedRoutes();
  document.querySelectorAll('.admin-nav a').forEach((link) => { link.hidden = !allowed.includes(link.dataset.route); });
}

async function route() {
  if (currentUser?.mustChangePassword) {
    await renderPasswordChange();
    return;
  }
  const requested = window.location.hash.slice(1) || 'overview';
  const routeName = allowedRoutes().includes(requested) ? requested : 'overview';
  const [title, description] = routeMeta[routeName];
  pageKicker.textContent = routeName === 'overview' ? 'Interview operations' : 'QuickInterviewTest';
  pageTitle.textContent = title;
  pageDescription.textContent = description;
  document.querySelectorAll('.admin-nav a').forEach((link) => link.classList.toggle('active', link.dataset.route === routeName));
  document.body.classList.remove('nav-open');
  try {
    await renderers[routeName]();
    moduleRoot.focus({ preventScroll: true });
  } catch (error) {
    moduleRoot.replaceChildren(emptyState('This module could not load', error.message));
    showMessage(error.message, true);
  }
}

async function loadSession() {
  const response = await fetch('/api/auth/session');
  if (!response.ok) {
    window.location.assign('/login');
    return;
  }
  const session = await response.json();
  csrfToken = session.csrfToken;
  currentUser = session.user;
  document.querySelector('#account-email').textContent = session.user.email;
  document.querySelector('#account-role').textContent = humanize(session.user.role);
  document.querySelector('#account-avatar').textContent = session.user.email.slice(0, 1).toLocaleUpperCase('en-US');
  configureNavigation();
  if (!session.user.mustChangePassword) await refreshDomains();
  await route();
}

document.querySelector('#logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } });
  window.location.assign('/login');
});
document.querySelector('#nav-toggle').addEventListener('click', () => document.body.classList.toggle('nav-open'));
window.addEventListener('hashchange', () => void route());
void loadSession();
