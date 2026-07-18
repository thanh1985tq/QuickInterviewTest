let csrfToken = '';
let currentUser;
let activeDomains = [];

const moduleRoot = document.querySelector('#app-module');
const messageStack = document.querySelector('#message-stack');
const pageTitle = document.querySelector('#page-title');
const pageDescription = document.querySelector('#page-description');
const pageKicker = document.querySelector('#page-kicker');

const routeMeta = {
  overview: ['Workspace overview', 'See coverage, publishing progress, and the next interview actions.'],
  domains: ['Domain management', 'Grow and organize the disciplines your interview library can assess.'],
  questions: ['Question bank', 'Create, filter, publish, and maintain versioned interview questions.'],
  templates: ['Test templates', 'Build coherent assessments from published questions—without editing JSON.'],
  attempts: ['Candidate attempts', 'Issue scoped interview links and monitor each delivery window.'],
  results: ['Results & review', 'Review submissions, record scores, and export decision-ready evidence.'],
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
  const input = type === 'textarea' ? node('textarea', { name, rows: options.rows || '5', placeholder: options.placeholder }) : node('input', attributes);
  input.value = value;
  if (options.required) input.required = true;
  if (options.min !== undefined) input.min = String(options.min);
  if (options.max !== undefined) input.max = String(options.max);
  if (options.step !== undefined) input.step = String(options.step);
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
  const tones = { PUBLISHED: 'success', DRAFT: 'warning', ARCHIVED: 'muted', SUBMITTED: 'success', IN_PROGRESS: 'info', STARTED: 'info', CREATED: 'muted', EXPIRED: 'danger', CANCELLED: 'danger' };
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

function loadingState(label = 'Loading workspace data…') {
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
  heroCopy.append(
    node('span', { class: 'hero-label' }, 'Interview readiness'),
    node('h2', {}, 'Build evidence, not busywork.'),
    node('p', {}, 'Curate domain-specific questions, assemble focused assessments, and keep every candidate decision traceable.'),
  );
  const heroActions = node('div', { class: 'hero-actions' });
  if (canAuthor) heroActions.append(node('a', { class: 'button light', href: '#questions' }, 'Open question bank'), node('a', { class: 'button glass', href: '#attempts' }, 'Invite candidate'));
  else heroActions.append(node('a', { class: 'button light', href: '#results' }, 'Review results'));
  hero.append(heroCopy, heroActions);

  const metrics = node('section', { class: 'metric-grid', 'aria-label': 'Workspace metrics' });
  metrics.append(
    metricCard('Active domains', domains.filter((domain) => domain.isActive).length, 'Interview disciplines', 'accent'),
    metricCard('Published questions', questions.filter((question) => question.status === 'PUBLISHED').length, `${questions.length} total in the library`),
    metricCard('Published templates', templates.filter((template) => template.status === 'PUBLISHED').length, `${templates.length} total assessment designs`),
    metricCard(canReview ? 'Submitted results' : 'Candidate attempts', canReview ? results.filter((result) => result.state === 'SUBMITTED').length : instances.length, canReview ? `${results.length} results visible` : 'Private delivery records'),
  );

  const coveragePanel = node('section', { class: 'panel' });
  coveragePanel.append(sectionHeader('Domain coverage', 'Balance your library before assembling the next interview.', currentUser.role === 'ADMIN' ? [node('a', { class: 'text-link', href: '#domains' }, 'Manage domains →')] : []));
  const coverageGrid = node('div', { class: 'domain-coverage-grid' });
  const maximum = Math.max(1, ...domains.map((domain) => domain.questionCount));
  domains.filter((domain) => domain.isActive).forEach((domain) => {
    const card = node('article', { class: 'coverage-card' });
    const top = node('div', { class: 'coverage-top' });
    top.append(node('span', { class: 'domain-monogram' }, domain.name.slice(0, 2).toLocaleUpperCase('en-US')), node('div'));
    top.lastElementChild.append(node('h3', {}, domain.name), node('p', {}, `${domain.questionCount} questions · ${domain.templateCount} templates`));
    const progress = node('div', { class: 'progress-track', role: 'progressbar', 'aria-valuenow': domain.questionCount, 'aria-valuemin': '0', 'aria-valuemax': maximum });
    progress.append(node('span', { style: `width:${Math.max(4, (domain.questionCount / maximum) * 100)}%` }));
    card.append(top, progress);
    coverageGrid.append(card);
  });
  if (coverageGrid.childElementCount === 0) coverageGrid.append(emptyState('No active domains', 'Create a domain to start organizing interview content.', { href: '#domains', label: 'Create a domain' }));
  coveragePanel.append(coverageGrid);

  const recentPanel = node('section', { class: 'panel' });
  recentPanel.append(sectionHeader('Recently updated questions', 'The newest work in your interview library.', canAuthor ? [node('a', { class: 'text-link', href: '#questions' }, 'View all →')] : []));
  const recentList = node('div', { class: 'compact-list' });
  questions.slice(0, 5).forEach((question) => {
    const row = node('article', { class: 'compact-row' });
    const copy = node('div');
    copy.append(node('strong', {}, question.title), node('small', {}, `${domainName(question.domain)} · ${humanize(question.difficulty)} · ${question.expectedDurationMinutes} min`));
    row.append(copy, statusBadge(question.status));
    recentList.append(row);
  });
  if (!questions.length) recentList.append(emptyState('No questions yet', 'Seed or create questions to make the workspace useful.', canAuthor ? { href: '#questions', label: 'Create a question' } : undefined));
  recentPanel.append(recentList);
  moduleRoot.replaceChildren(hero, metrics, node('div', { class: 'content-grid two-thirds' }));
  moduleRoot.lastElementChild.append(coveragePanel, recentPanel);
}

async function renderDomains() {
  moduleRoot.replaceChildren(loadingState('Loading domains…'));
  const domains = await refreshDomains('ALL');
  const createPanel = node('section', { class: 'panel composer-panel' });
  const createDetails = node('details');
  createDetails.append(node('summary', { class: 'composer-summary' }, 'Add a new interview domain'));
  const form = node('form', { class: 'form-grid domain-form' });
  form.append(
    field('Domain name', 'name', 'text', '', { required: true, placeholder: 'Security Testing' }),
    field('Identifier (optional)', 'slug', 'text', '', { placeholder: 'SECURITY_TESTING', help: 'Stable uppercase identifier. Leave blank to generate it.' }),
    field('Description', 'description', 'textarea', '', { className: 'field span-full', rows: 3, placeholder: 'What this domain covers and when to use it.' }),
    button('Create domain', 'button primary', 'submit'),
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      await api('/api/domains', { method: 'POST', body: JSON.stringify({ name: data.get('name'), slug: data.get('slug') || undefined, description: data.get('description') }) });
      showMessage('Domain created. It is now available to questions and templates.');
      await renderDomains();
    } catch (error) { showMessage(error.message, true); }
  });
  createDetails.append(form);
  createPanel.append(createDetails);

  const listPanel = node('section', { class: 'panel' });
  listPanel.append(sectionHeader('Interview domains', `${domains.filter((domain) => domain.isActive).length} active domains · ${domains.reduce((sum, domain) => sum + domain.questionCount, 0)} questions organized`));
  const grid = node('div', { class: 'domain-management-grid' });
  domains.forEach((domain) => {
    const card = node('article', { class: `domain-card ${domain.isActive ? '' : 'is-archived'}`.trim() });
    const top = node('div', { class: 'domain-card-top' });
    const title = node('div');
    title.append(node('span', { class: 'domain-monogram large' }, domain.name.slice(0, 2).toLocaleUpperCase('en-US')), node('div'));
    title.lastElementChild.append(node('h3', {}, domain.name), node('code', {}, domain.slug));
    top.append(title, badge(domain.isActive ? 'Active' : 'Archived', domain.isActive ? 'success' : 'muted'));
    const stats = node('div', { class: 'domain-stat-row' });
    stats.append(node('span', {}, `${domain.questionCount} questions`), node('span', {}, `${domain.templateCount} templates`));
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
      } catch (error) { showMessage(error.message, true); }
    });
    edit.append(editForm);
    const actions = node('div', { class: 'inline-actions' });
    actions.append(actionButton(domain.isActive ? 'Archive domain' : 'Reactivate domain', async () => {
      await api(`/api/domains/${domain.id}/${domain.isActive ? 'archive' : 'reactivate'}`, { method: 'POST', body: '{}' });
      showMessage(domain.isActive ? 'Domain archived. Existing content remains intact.' : 'Domain reactivated.');
      await renderDomains();
    }, true));
    card.append(top, node('p', {}, domain.description || 'No description yet.'), stats, edit, actions);
    grid.append(card);
  });
  listPanel.append(grid);
  moduleRoot.replaceChildren(sectionHeader('Domain management', 'Create durable categories for every interview discipline you support.'), createPanel, listPanel);
}

function buildQuestionForm() {
  const details = node('details', { class: 'panel composer-panel' });
  details.append(node('summary', { class: 'composer-summary' }, 'Create a question'));
  const form = node('form', { class: 'form-grid question-form' });
  const typeField = selectField('Answer format', 'type', ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SHORT_ANSWER', 'LONG_ANSWER', 'CODE_ANSWER', 'SCENARIO'], 'SINGLE_CHOICE');
  const typeSelect = typeField.querySelector('select');
  const choicesField = field('Choices (one per line)', 'choicesText', 'textarea', 'Option A\nOption B', { rows: 5, help: 'Choice numbers are assigned from top to bottom.' });
  const correctField = field('Correct choice number(s)', 'correctChoices', 'text', '2', { help: 'For multiple choice, use commas: 1,3' });
  const rubricField = field('Scoring rubric', 'scoringRubric', 'textarea', '', { rows: 5, help: 'Required for written, scenario, and code answers.' });
  const choiceBlock = node('div', { class: 'subform span-full' });
  choiceBlock.append(choicesField, correctField);
  form.append(
    field('Question title', 'title', 'text', '', { required: true, placeholder: 'Parallel browser isolation' }),
    selectField('Domain', 'domain', domainOptions()), typeField,
    selectField('Difficulty', 'difficulty', ['JUNIOR', 'MID', 'SENIOR', 'EXPERT'], 'MID'),
    field('Expected minutes', 'expectedDurationMinutes', 'number', '8', { required: true, min: 1, max: 240 }),
    field('Maximum score', 'maximumScore', 'number', '10', { required: true, min: 1, step: '0.5' }),
    field('Short description', 'description', 'textarea', '', { className: 'field span-full', rows: 2, placeholder: 'What capability this question assesses.' }),
    field('Candidate prompt', 'prompt', 'textarea', '', { className: 'field span-full', rows: 6, required: true, placeholder: 'Write the complete question exactly as the candidate should see it.' }),
    choiceBlock, rubricField,
    field('Tags', 'tags', 'text', '', { className: 'field span-full', placeholder: 'playwright, parallelism, architecture', help: 'Comma-separated labels improve filtering and reuse.' }),
    button('Save draft question', 'button primary', 'submit'),
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
    const data = new FormData(form);
    const type = String(data.get('type'));
    const choiceType = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE'].includes(type);
    const choices = choiceType ? String(data.get('choicesText') || '').split(/\r?\n/).map((label) => label.trim()).filter(Boolean)
      .map((label, index) => ({ id: `choice_${index + 1}`, label })) : [];
    const correctChoiceIds = choiceType ? String(data.get('correctChoices') || '').split(',').map((part) => Number(part.trim()))
      .filter((index) => Number.isInteger(index) && index > 0).map((index) => `choice_${index}`) : [];
    try {
      await api('/api/questions', { method: 'POST', body: JSON.stringify({
        title: data.get('title'), description: data.get('description'), prompt: data.get('prompt'), domain: data.get('domain'),
        type, difficulty: data.get('difficulty'), expectedDurationMinutes: Number(data.get('expectedDurationMinutes')),
        maximumScore: Number(data.get('maximumScore')), choices, answerKey: { correctChoiceIds },
        scoringRubric: choiceType ? '' : data.get('scoringRubric'),
        tags: String(data.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean),
      }) });
      showMessage('Draft question created. Review it, then publish when ready.');
      await renderQuestions();
    } catch (error) { showMessage(error.message, true); }
  });
  details.append(form);
  return details;
}

function questionCard(question) {
  const card = node('article', { class: 'question-card-admin' });
  const header = node('div', { class: 'question-card-header' });
  const title = node('div');
  title.append(node('div', { class: 'badge-row' }, ''), node('h3', {}, question.title));
  title.firstElementChild.append(statusBadge(question.status), badge(domainName(question.domain), 'domain'), badge(humanize(question.difficulty), 'muted'));
  header.append(title, node('span', { class: 'score-chip' }, `${question.maximumScore} pts`));
  const description = node('p', { class: 'question-description' }, question.description || question.prompt.slice(0, 180));
  const meta = node('div', { class: 'question-meta-row' });
  meta.append(node('span', {}, humanize(question.type)), node('span', {}, `${question.expectedDurationMinutes} min`), node('span', {}, `Version ${question.version}`));
  const tagRow = node('div', { class: 'tag-row' });
  question.tags.forEach((tag) => tagRow.append(badge(tag, 'tag')));
  const actions = node('div', { class: 'inline-actions' });
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
  if (question.status !== 'ARCHIVED') actions.append(actionButton('Archive', async () => {
    await api(`/api/questions/${question.id}/archive`, { method: 'POST', body: '{}' });
    showMessage('Question archived. Published snapshots remain unchanged.');
    await renderQuestions();
  }, true));
  card.append(header, description, meta, tagRow, actions);
  return card;
}

async function renderQuestions() {
  moduleRoot.replaceChildren(loadingState('Loading question bank…'));
  if (!activeDomains.length) await refreshDomains();
  const shell = node('div');
  const header = sectionHeader('Question bank', 'Published versions are immutable; editing later creates a safe new draft.');
  const composer = buildQuestionForm();
  const listPanel = node('section', { class: 'panel' });
  const filters = node('form', { class: 'filter-bar' });
  filters.append(
    field('Search', 'search', 'search', '', { placeholder: 'Search title or description' }),
    selectField('Domain', 'domain', domainOptions(true)),
    selectField('Status', 'status', [{ value: '', label: 'All statuses' }, ...['DRAFT', 'PUBLISHED', 'ARCHIVED'].map((value) => ({ value, label: humanize(value) }))]),
    selectField('Format', 'type', [{ value: '', label: 'All formats' }, ...['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SHORT_ANSWER', 'LONG_ANSWER', 'CODE_ANSWER', 'SCENARIO'].map((value) => ({ value, label: humanize(value) }))]),
    button('Apply filters', 'button quiet-button', 'submit'),
  );
  const countLabel = node('p', { class: 'list-count' });
  const list = node('div', { class: 'question-grid' });
  async function loadList() {
    list.replaceChildren(loadingState('Filtering questions…'));
    const data = new FormData(filters);
    const parameters = new URLSearchParams();
    for (const key of ['search', 'domain', 'status', 'type']) if (data.get(key)) parameters.set(key, String(data.get(key)));
    const payload = await api(`/api/questions?${parameters}`);
    countLabel.textContent = `${payload.questions.length} question${payload.questions.length === 1 ? '' : 's'}`;
    list.replaceChildren();
    payload.questions.forEach((question) => list.append(questionCard(question)));
    if (!payload.questions.length) list.append(emptyState('No matching questions', 'Change the filters or create a new question.'));
  }
  filters.addEventListener('submit', (event) => { event.preventDefault(); void loadList().catch((error) => showMessage(error.message, true)); });
  listPanel.append(filters, countLabel, list);
  shell.append(header, composer, listPanel);
  moduleRoot.replaceChildren(shell);
  await loadList();
}

async function renderTemplates() {
  moduleRoot.replaceChildren(loadingState('Loading templates…'));
  if (!activeDomains.length) await refreshDomains();
  const [questionPayload, templatePayload] = await Promise.all([api('/api/questions?status=PUBLISHED'), api('/api/templates')]);
  const questions = questionPayload.questions;
  const composer = node('details', { class: 'panel composer-panel' });
  composer.append(node('summary', { class: 'composer-summary' }, 'Create a test template'));
  const form = node('form', { class: 'form-grid template-form' });
  const domainField = selectField('Domain', 'domain', domainOptions());
  const domainSelect = domainField.querySelector('select');
  const picker = node('div', { class: 'question-picker span-full' });
  function refreshPicker() {
    picker.replaceChildren(node('div', { class: 'picker-heading' }, 'Select published questions'));
    const matching = questions.filter((question) => question.domain === domainSelect.value);
    matching.forEach((question) => {
      const label = node('label', { class: 'picker-row' });
      const input = node('input', { type: 'checkbox', name: 'questionVersionId', value: question.versionId });
      const copy = node('span');
      copy.append(node('strong', {}, question.title), node('small', {}, `${humanize(question.difficulty)} · ${humanize(question.type)} · ${question.expectedDurationMinutes} min · ${question.maximumScore} pts`));
      label.append(input, copy);
      picker.append(label);
    });
    if (!matching.length) picker.append(emptyState('No published questions in this domain', 'Publish questions before composing a template.', { href: '#questions', label: 'Open question bank' }));
  }
  domainSelect.addEventListener('change', refreshPicker);
  form.append(
    field('Template title', 'title', 'text', '', { required: true, placeholder: 'Senior automation engineer screen' }), domainField,
    selectField('Target seniority', 'targetSeniority', ['JUNIOR', 'MID', 'SENIOR', 'EXPERT', 'MIXED'], 'MID'),
    field('Duration minutes', 'durationMinutes', 'number', '60', { required: true, min: 1, max: 480 }),
    field('Description', 'description', 'textarea', '', { className: 'field span-full', rows: 3 }),
    checkboxField('Randomize question order for each candidate', 'randomizeQuestions'), picker,
    button('Save draft template', 'button primary', 'submit'),
  );
  refreshPicker();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const selected = Array.from(form.querySelectorAll('input[name="questionVersionId"]:checked')).map((input) => input.value);
    if (!selected.length) { showMessage('Select at least one published question.', true); return; }
    try {
      await api('/api/templates', { method: 'POST', body: JSON.stringify({
        title: data.get('title'), description: data.get('description'), domain: data.get('domain'),
        targetSeniority: data.get('targetSeniority'), durationMinutes: Number(data.get('durationMinutes')),
        randomizeQuestions: data.get('randomizeQuestions') === 'on', selectionMode: 'FIXED',
        sections: [{ key: 'main', title: 'Interview' }], navigation: { allowBack: true, requireSequential: false },
        questions: selected.map((questionVersionId, index) => ({ questionVersionId, sectionKey: 'main', position: index + 1, scoreWeight: 1, required: true })),
      }) });
      showMessage('Draft template created.');
      await renderTemplates();
    } catch (error) { showMessage(error.message, true); }
  });
  composer.append(form);

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
    if (template.status === 'DRAFT') actions.append(actionButton('Publish', async () => {
      await api(`/api/templates/${template.id}/publish`, { method: 'POST', body: '{}' });
      showMessage('Template published and ready for candidate attempts.');
      await renderTemplates();
    }));
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
  moduleRoot.replaceChildren(loadingState('Loading candidate attempts…'));
  const [templatePayload, attemptPayload] = await Promise.all([api('/api/templates?status=PUBLISHED'), api('/api/test-instances')]);
  const templates = templatePayload.templates;
  const composer = node('details', { class: 'panel composer-panel' });
  composer.append(node('summary', { class: 'composer-summary' }, 'Invite a candidate'));
  if (!templates.length) {
    composer.append(emptyState('Publish a template first', 'Candidate links are created from immutable published templates.', { href: '#templates', label: 'Open templates' }));
  } else {
    const form = node('form', { class: 'form-grid' });
    const templateField = selectField('Published template', 'templateId', templates.map((template) => ({ value: template.id, label: `${template.title} · ${domainName(template.domain)}` })));
    const credentials = node('div', { class: 'credential-output', hidden: '' });
    form.append(
      templateField, field('Candidate name', 'name', 'text', '', { required: true }), field('Candidate email', 'email', 'email'),
      selectField('Delivery mode', 'deliveryMode', [{ value: 'STANDARD_WEB', label: 'Standard Web (recommended)' }, { value: 'COLAB_GRADIO', label: 'Colab + Gradio (experimental)' }]),
      field('Available from', 'availableFrom', 'datetime-local', localDatetime(-60_000), { required: true }),
      field('Available until', 'availableUntil', 'datetime-local', localDatetime(86_400_000), { required: true }),
      field('Duration minutes', 'durationMinutes', 'number', '60', { required: true, min: 1, max: 480 }),
      button('Create private attempt', 'button primary', 'submit'), credentials,
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      try {
        const created = await api('/api/test-instances', { method: 'POST', body: JSON.stringify({
          templateId: data.get('templateId'), candidate: { name: data.get('name'), email: data.get('email') || null },
          deliveryMode: data.get('deliveryMode'), availableFrom: new Date(data.get('availableFrom')).toISOString(),
          availableUntil: new Date(data.get('availableUntil')).toISOString(), durationMinutes: Number(data.get('durationMinutes')),
        }) });
        credentials.hidden = false;
        credentials.replaceChildren(node('strong', {}, 'Save these credentials now—they are shown once.'), node('code', {}, created.candidateUrl));
        if (created.runnerToken) credentials.append(node('small', {}, `Lab runner token: ${created.runnerToken}`));
        showMessage('Candidate attempt created.');
        await appendAttemptList(attemptList);
      } catch (error) { showMessage(error.message, true); }
    });
    composer.append(form);
  }
  const listPanel = node('section', { class: 'panel' });
  listPanel.append(sectionHeader('Delivery activity', 'Every link is scoped to one candidate, one test, and one expiry window.'));
  const attemptList = node('div', { class: 'data-list' });
  listPanel.append(attemptList);
  moduleRoot.replaceChildren(sectionHeader('Candidate attempts', 'Create private links and track interview delivery.'), composer, listPanel);
  attemptPayload.instances.forEach((instance) => attemptList.append(attemptRow(instance)));
  if (!attemptPayload.instances.length) attemptList.append(emptyState('No candidate attempts', 'Create a private attempt when a published template is ready.'));
}

function attemptRow(instance) {
  const record = node('article', { class: 'attempt-row' });
  const identity = node('div', { class: 'candidate-identity' });
  identity.append(node('span', { class: 'account-avatar pale' }, instance.candidate.name.slice(0, 1).toLocaleUpperCase('en-US')), node('div'));
  identity.lastElementChild.append(node('h3', {}, instance.candidate.name), node('p', {}, instance.candidate.email || 'No email recorded'));
  const test = node('div');
  test.append(node('strong', {}, instance.templateTitle), node('small', {}, `${humanize(instance.deliveryMode)} · ${instance.durationMinutes} min`));
  const window = node('div');
  window.append(node('small', {}, 'Availability'), node('span', {}, `${formatDate(instance.availableFrom)} – ${formatDate(instance.availableUntil)}`));
  record.append(identity, test, window, statusBadge(instance.state));
  return record;
}

async function appendAttemptList(container) {
  const payload = await api('/api/test-instances');
  container.replaceChildren();
  payload.instances.forEach((instance) => container.append(attemptRow(instance)));
}

async function renderResults() {
  moduleRoot.replaceChildren(loadingState('Loading results…'));
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

async function renderResultDetail(attemptId) {
  moduleRoot.replaceChildren(loadingState('Loading submission…'));
  const result = await api(`/api/results/${attemptId}`);
  const back = actionButton('← Back to results', renderResults, true);
  const summary = node('section', { class: 'panel result-summary' });
  summary.append(sectionHeader(`${result.candidate.name} · ${result.template.title}`, `${result.state} · ${domainName(result.template.domain)}`, [back]), metricCard('Current score', `${result.score}/${result.maximumScore}`, 'Across automatic and manual scoring'));
  const questions = node('div', { class: 'review-list' });
  result.questions.forEach((question, index) => {
    const record = node('article', { class: 'panel review-card' });
    record.append(node('span', { class: 'question-number' }, `Question ${index + 1}`), node('h3', {}, question.title), node('p', { class: 'prompt' }, question.prompt));
    const answer = node('div', { class: 'answer-panel' });
    answer.append(node('small', {}, 'Candidate answer'), node('pre', {}, JSON.stringify(question.answer, null, 2) || 'No answer'));
    record.append(answer);
    if (question.answerId) {
      const scoreForm = node('form', { class: 'inline-form score-form' });
      scoreForm.append(field(`Score (max ${question.maximumScore})`, 'score', 'number', '', { required: true, min: 0, max: question.maximumScore, step: '0.5' }), field('Review reason', 'reason', 'text', '', { required: true }), button('Save score', 'button primary small', 'submit'));
      scoreForm.addEventListener('submit', async (event) => {
        event.preventDefault(); const data = new FormData(scoreForm);
        try {
          await api(`/api/results/${attemptId}/scores`, { method: 'POST', body: JSON.stringify({ answerId: question.answerId, score: Number(data.get('score')), reason: data.get('reason') }) });
          showMessage('Manual score recorded.'); await renderResultDetail(attemptId);
        } catch (error) { showMessage(error.message, true); }
      });
      record.append(node('details', { class: 'rubric-details' }), scoreForm);
      record.querySelector('details').append(node('summary', {}, 'View scoring guidance'), node('p', {}, question.scoringRubric || 'Use the published answer key and interviewer judgment.'));
    }
    questions.append(record);
  });
  const commentForm = node('form', { class: 'panel inline-form' });
  commentForm.append(field('Attempt comment', 'comment', 'text', '', { required: true, placeholder: 'Add decision context for other reviewers' }), button('Add comment', 'button primary small', 'submit'));
  commentForm.addEventListener('submit', async (event) => {
    event.preventDefault(); const data = new FormData(commentForm);
    try { await api(`/api/results/${attemptId}/comments`, { method: 'POST', body: JSON.stringify({ comment: data.get('comment') }) }); showMessage('Review comment added.'); await renderResultDetail(attemptId); }
    catch (error) { showMessage(error.message, true); }
  });
  moduleRoot.replaceChildren(summary, questions, commentForm);
}

async function renderUsers() {
  moduleRoot.replaceChildren(loadingState('Loading users and audit…'));
  const [users, audit] = await Promise.all([api('/api/admin/users'), api('/api/admin/audit?limit=25')]);
  const composer = node('details', { class: 'panel composer-panel' });
  composer.append(node('summary', { class: 'composer-summary' }, 'Provision an administrative user'));
  const form = node('form', { class: 'form-grid' });
  form.append(field('Email', 'email', 'email', '', { required: true }), field('Temporary password', 'password', 'password', '', { required: true, help: 'At least 12 characters; the user must replace it.' }), selectField('Role', 'role', ['INTERVIEWER', 'REVIEWER', 'ADMIN'], 'INTERVIEWER'), button('Provision user', 'button primary', 'submit'));
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); const data = new FormData(form);
    try { await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ email: data.get('email'), password: data.get('password'), role: data.get('role'), mustChangePassword: true }) }); showMessage('Administrative user provisioned.'); await renderUsers(); }
    catch (error) { showMessage(error.message, true); }
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
    row.lastElementChild.append(node('strong', {}, humanize(entry.action)), node('p', {}, `${entry.actorEmail || 'System'} · ${humanize(entry.targetType)}`), node('small', {}, formatDate(entry.createdAt)));
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
    event.preventDefault(); const data = new FormData(form);
    try { await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: data.get('currentPassword'), newPassword: data.get('newPassword') }) }); window.location.hash = '#overview'; window.location.reload(); }
    catch (error) { showMessage(error.message, true); }
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
  if (currentUser?.mustChangePassword) { await renderPasswordChange(); return; }
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
  if (!response.ok) { window.location.assign('/login'); return; }
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
