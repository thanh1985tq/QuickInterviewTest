let csrfToken = '';
let currentUser;
const moduleRoot = document.querySelector('#app-module');

function node(name, attributes = {}, text = '') {
  const element = document.createElement(name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  if (text) element.textContent = text;
  return element;
}

function field(labelText, name, type = 'text', value = '') {
  const label = node('label');
  label.append(document.createTextNode(labelText));
  const input = type === 'textarea' ? node('textarea', { name, rows: '5' }) : node('input', { name, type });
  input.value = value;
  label.append(input);
  return label;
}

function selectField(labelText, name, options) {
  const label = node('label');
  label.append(document.createTextNode(labelText));
  const select = node('select', { name });
  options.forEach((option) => select.append(node('option', { value: option }, option)));
  label.append(select);
  return label;
}

function showMessage(text, error = false) {
  const message = node('p', { class: error ? 'error-banner' : 'notice', role: 'status' }, text);
  moduleRoot.prepend(message);
  setTimeout(() => message.remove(), 7000);
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

function actionButton(text, action, secondary = false) {
  const button = node('button', { type: 'button', class: secondary ? 'small-button secondary' : 'small-button' }, text);
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await action(); } catch (error) { showMessage(error.message, true); } finally { button.disabled = false; }
  });
  return button;
}

async function renderQuestions() {
  moduleRoot.replaceChildren(node('h2', {}, 'Question bank'));
  const form = node('form', { class: 'admin-form' });
  form.append(
    field('Title', 'title'), field('Description', 'description', 'textarea'), field('Prompt', 'prompt', 'textarea'),
    selectField('Domain', 'domain', ['AUTOMATION_TESTING', 'PERFORMANCE_TESTING']),
    selectField('Type', 'type', ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SHORT_ANSWER', 'LONG_ANSWER', 'CODE_ANSWER', 'SCENARIO']),
    selectField('Difficulty', 'difficulty', ['JUNIOR', 'MID', 'SENIOR', 'EXPERT']),
    field('Expected minutes', 'expectedDurationMinutes', 'number', '5'), field('Maximum score', 'maximumScore', 'number', '10'),
    field('Choices JSON', 'choices', 'textarea', '[{"id":"a","label":"Option A"},{"id":"b","label":"Option B"}]'),
    field('Answer key JSON', 'answerKey', 'textarea', '{"correctChoiceIds":["b"]}'),
    field('Scoring rubric (required for text answers)', 'scoringRubric', 'textarea'), field('Tags, comma-separated', 'tags'),
    node('button', { type: 'submit', class: 'button' }, 'Create draft question'),
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      await api('/api/questions', { method: 'POST', body: JSON.stringify({
        title: data.get('title'), description: data.get('description'), prompt: data.get('prompt'),
        domain: data.get('domain'), type: data.get('type'), difficulty: data.get('difficulty'),
        expectedDurationMinutes: Number(data.get('expectedDurationMinutes')), maximumScore: Number(data.get('maximumScore')),
        choices: JSON.parse(data.get('choices') || '[]'), answerKey: JSON.parse(data.get('answerKey') || '{}'),
        scoringRubric: data.get('scoringRubric'), tags: String(data.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean),
      }) });
      showMessage('Question draft created.');
      await renderQuestions();
    } catch (error) { showMessage(error.message, true); }
  });
  moduleRoot.append(form, node('hr'));
  const payload = await api('/api/questions');
  const list = node('div', { class: 'record-list' });
  payload.questions.forEach((question) => {
    const record = node('article', { class: 'record' });
    record.append(node('h3', {}, question.title), node('p', {}, `${question.domain} · ${question.type} · v${question.version} · ${question.status}`));
    const actions = node('div', { class: 'inline-actions' });
    if (question.status === 'DRAFT') actions.append(actionButton('Publish', async () => {
      await api(`/api/questions/${question.id}/publish`, { method: 'POST', body: '{}' }); await renderQuestions();
    }));
    actions.append(actionButton('Duplicate', async () => {
      await api(`/api/questions/${question.id}/duplicate`, { method: 'POST', body: '{}' }); await renderQuestions();
    }, true));
    actions.append(actionButton('Archive', async () => {
      await api(`/api/questions/${question.id}/archive`, { method: 'POST', body: '{}' }); await renderQuestions();
    }, true));
    record.append(actions, node('code', {}, `Question version ID: ${question.versionId}`));
    list.append(record);
  });
  moduleRoot.append(list);
}

async function renderTemplates() {
  moduleRoot.replaceChildren(node('h2', {}, 'Test templates'));
  const questionData = await api('/api/questions?status=PUBLISHED');
  const help = node('details');
  help.append(node('summary', {}, 'Published question version IDs'));
  questionData.questions.forEach((question) => help.append(node('code', {}, `${question.title}: ${question.versionId}`), node('br')));
  moduleRoot.append(help);
  const form = node('form', { class: 'admin-form' });
  form.append(
    field('Title', 'title'), field('Description', 'description', 'textarea'),
    selectField('Domain', 'domain', ['AUTOMATION_TESTING', 'PERFORMANCE_TESTING']),
    selectField('Target seniority', 'targetSeniority', ['JUNIOR', 'MID', 'SENIOR', 'EXPERT', 'MIXED']),
    field('Duration minutes', 'durationMinutes', 'number', '60'),
    field('Sections JSON', 'sections', 'textarea', '[{"key":"main","title":"Main"}]'),
    field('Questions JSON', 'questions', 'textarea', '[{"questionVersionId":"PASTE-UUID","sectionKey":"main","position":1,"scoreWeight":1,"required":true}]'),
    node('button', { type: 'submit', class: 'button' }, 'Create draft template'),
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      await api('/api/templates', { method: 'POST', body: JSON.stringify({
        title: data.get('title'), description: data.get('description'), domain: data.get('domain'),
        targetSeniority: data.get('targetSeniority'), durationMinutes: Number(data.get('durationMinutes')),
        randomizeQuestions: false, selectionMode: 'FIXED', sections: JSON.parse(data.get('sections')),
        navigation: { allowBack: true, requireSequential: false }, questions: JSON.parse(data.get('questions')),
      }) });
      await renderTemplates();
    } catch (error) { showMessage(error.message, true); }
  });
  moduleRoot.append(form, node('hr'));
  const payload = await api('/api/templates');
  payload.templates.forEach((template) => {
    const record = node('article', { class: 'record' });
    record.append(node('h3', {}, template.title), node('p', {}, `${template.domain} · ${template.durationMinutes} minutes · v${template.version} · ${template.status}`));
    if (template.status === 'DRAFT') record.append(actionButton('Publish', async () => {
      await api(`/api/templates/${template.id}/publish`, { method: 'POST', body: '{}' }); await renderTemplates();
    }));
    record.append(node('code', {}, `Template ID: ${template.id}`));
    moduleRoot.append(record);
  });
}

function localDatetime(offsetMs) {
  const date = new Date(Date.now() + offsetMs - new Date().getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

async function renderAttempts() {
  moduleRoot.replaceChildren(node('h2', {}, 'Candidate attempts'));
  moduleRoot.append(node('p', { class: 'experimental' }, 'Colab + Gradio Lab Mode is experimental. Do not share its link until deployment is READY.'));
  const templates = (await api('/api/templates?status=PUBLISHED')).templates;
  const form = node('form', { class: 'admin-form' });
  const templateLabel = node('label');
  templateLabel.append(document.createTextNode('Published template'));
  const templateSelect = node('select', { name: 'templateId' });
  templates.forEach((template) => templateSelect.append(node('option', { value: template.id }, template.title)));
  templateLabel.append(templateSelect);
  form.append(
    templateLabel, field('Candidate name', 'name'), field('Candidate email', 'email', 'email'),
    selectField('Delivery mode', 'deliveryMode', ['STANDARD_WEB', 'COLAB_GRADIO']),
    field('Available from', 'availableFrom', 'datetime-local', localDatetime(-60_000)),
    field('Available until', 'availableUntil', 'datetime-local', localDatetime(86_400_000)),
    field('Duration minutes', 'durationMinutes', 'number', '60'),
    node('button', { type: 'submit', class: 'button' }, 'Create private attempt'),
  );
  const credentials = node('pre', { class: 'credential-output' });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      const created = await api('/api/test-instances', { method: 'POST', body: JSON.stringify({
        templateId: data.get('templateId'), candidate: { name: data.get('name'), email: data.get('email') || null },
        deliveryMode: data.get('deliveryMode'), availableFrom: new Date(data.get('availableFrom')).toISOString(),
        availableUntil: new Date(data.get('availableUntil')).toISOString(), durationMinutes: Number(data.get('durationMinutes')),
      }) });
      credentials.textContent = `SAVE NOW — secrets are shown once\nCandidate URL: ${created.candidateUrl}\nCandidate token: ${created.candidateToken}\n${created.runnerToken ? `Runner token: ${created.runnerToken}\nNotebook: ${location.origin}/lab/QuickInterviewTest.ipynb` : ''}`;
      await appendAttemptList();
    } catch (error) { showMessage(error.message, true); }
  });
  moduleRoot.append(form, credentials, node('hr'));
  await appendAttemptList();
}

async function appendAttemptList() {
  moduleRoot.querySelector('#attempt-list')?.remove();
  const list = node('div', { id: 'attempt-list', class: 'record-list' });
  const payload = await api('/api/test-instances');
  payload.instances.forEach((instance) => {
    const record = node('article', { class: 'record' });
    record.append(node('h3', {}, instance.candidate.name), node('p', {}, `${instance.templateTitle} · ${instance.deliveryMode} · ${instance.state}`));
    record.append(node('small', {}, `${instance.availableFrom} → ${instance.availableUntil}`));
    list.append(record);
  });
  moduleRoot.append(list);
}

async function renderResults() {
  moduleRoot.replaceChildren(node('h2', {}, 'Results'));
  const exports = node('p');
  exports.append(node('a', { href: '/api/results/export.csv' }, 'Download CSV'), document.createTextNode(' · '), node('a', { href: '/api/results/export.json' }, 'Download JSON'));
  moduleRoot.append(exports);
  const payload = await api('/api/results');
  payload.results.forEach((result) => {
    const record = node('article', { class: 'record' });
    record.append(node('h3', {}, result.candidate.name), node('p', {}, `${result.template.title} · ${result.state} · ${result.score}/${result.maximumScore}`));
    record.append(actionButton('Review', async () => renderResultDetail(result.attemptId)));
    moduleRoot.append(record);
  });
}

async function renderResultDetail(attemptId) {
  const result = await api(`/api/results/${attemptId}`);
  moduleRoot.replaceChildren(node('h2', {}, `${result.candidate.name} — ${result.template.title}`));
  moduleRoot.append(node('p', {}, `${result.state} · ${result.score}/${result.maximumScore}`));
  result.questions.forEach((question) => {
    const record = node('article', { class: 'record' });
    record.append(node('h3', {}, question.title), node('p', { class: 'prompt' }, question.prompt));
    record.append(node('pre', {}, `Answer: ${JSON.stringify(question.answer, null, 2)}\nAnswer key: ${JSON.stringify(question.answerKey, null, 2)}\nRubric: ${question.scoringRubric}`));
    if (question.answerId) {
      const scoreForm = node('form', { class: 'inline-form' });
      scoreForm.append(field(`Score (max ${question.maximumScore})`, 'score', 'number'), field('Reason', 'reason'), node('button', { class: 'small-button' }, 'Save score'));
      scoreForm.addEventListener('submit', async (event) => {
        event.preventDefault(); const data = new FormData(scoreForm);
        try { await api(`/api/results/${attemptId}/scores`, { method: 'POST', body: JSON.stringify({ answerId: question.answerId, score: Number(data.get('score')), reason: data.get('reason') }) }); await renderResultDetail(attemptId); }
        catch (error) { showMessage(error.message, true); }
      });
      record.append(scoreForm);
    }
    moduleRoot.append(record);
  });
  const commentForm = node('form', { class: 'inline-form' });
  commentForm.append(field('Attempt comment', 'comment'), node('button', { class: 'small-button' }, 'Add comment'));
  commentForm.addEventListener('submit', async (event) => {
    event.preventDefault(); const data = new FormData(commentForm);
    try { await api(`/api/results/${attemptId}/comments`, { method: 'POST', body: JSON.stringify({ comment: data.get('comment') }) }); await renderResultDetail(attemptId); }
    catch (error) { showMessage(error.message, true); }
  });
  moduleRoot.append(commentForm, actionButton('Back to results', renderResults, true));
}

async function renderUsers() {
  moduleRoot.replaceChildren(node('h2', {}, 'Users & audit'));
  if (currentUser.role !== 'ADMIN') { moduleRoot.append(node('p', {}, 'Only administrators can manage users.')); return; }
  const form = node('form', { class: 'admin-form' });
  form.append(field('Email', 'email', 'email'), field('Temporary password', 'password', 'password'),
    selectField('Role', 'role', ['INTERVIEWER', 'REVIEWER', 'ADMIN']), node('button', { class: 'button' }, 'Provision user'));
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); const data = new FormData(form);
    try { await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ email: data.get('email'), password: data.get('password'), role: data.get('role'), mustChangePassword: true }) }); await renderUsers(); }
    catch (error) { showMessage(error.message, true); }
  });
  moduleRoot.append(form);
  const users = await api('/api/admin/users');
  users.users.forEach((user) => moduleRoot.append(node('p', {}, `${user.email} · ${user.role} · ${user.isActive ? 'active' : 'inactive'}`)));
  moduleRoot.append(node('h3', {}, 'Recent audit'));
  const audit = await api('/api/admin/audit?limit=25');
  audit.audit.forEach((entry) => moduleRoot.append(node('p', {}, `${entry.createdAt} · ${entry.actorEmail || 'system'} · ${entry.action} · ${entry.targetType}`)));
}

async function renderPasswordChange() {
  moduleRoot.replaceChildren(node('h2', {}, 'Change bootstrap password'), node('p', {}, 'Choose a permanent password before using administrative tools.'));
  const form = node('form', { class: 'admin-form' });
  form.append(field('Current password', 'currentPassword', 'password'), field('New password (12+ characters)', 'newPassword', 'password'), node('button', { class: 'button' }, 'Change password'));
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); const data = new FormData(form);
    try { await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: data.get('currentPassword'), newPassword: data.get('newPassword') }) }); window.location.reload(); }
    catch (error) { showMessage(error.message, true); }
  });
  moduleRoot.append(form);
}

async function route() {
  if (currentUser?.mustChangePassword) { await renderPasswordChange(); return; }
  const module = window.location.hash.slice(1) || 'questions';
  const routes = { questions: renderQuestions, templates: renderTemplates, attempts: renderAttempts, results: renderResults, users: renderUsers };
  try { await (routes[module] || renderQuestions)(); } catch (error) { moduleRoot.replaceChildren(); showMessage(error.message, true); }
}

async function loadSession() {
  const response = await fetch('/api/auth/session');
  if (!response.ok) { window.location.assign('/login'); return; }
  const session = await response.json();
  csrfToken = session.csrfToken;
  currentUser = session.user;
  document.querySelector('#identity').textContent = `${session.user.email} · ${session.user.role}`;
  await route();
}

document.querySelector('#logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } });
  window.location.assign('/login');
});
window.addEventListener('hashchange', () => void route());
void loadSession();
