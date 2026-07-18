const app = document.querySelector('#candidate-app');
const connection = document.querySelector('#connection');
const timer = document.querySelector('#timer');
const token = decodeURIComponent(window.location.pathname.split('/').pop() || '');
let manifest;
let timerHandle;
const pending = new Map();

async function api(path, options = {}) {
  const response = await fetch(`/api/candidate${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error?.message || `Request failed (${response.status})`);
  }
  connection.textContent = 'Saved online';
  connection.className = 'status online';
  return response.status === 204 ? undefined : response.json();
}

function element(name, attributes = {}, text = '') {
  const node = document.createElement(name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  if (text) node.textContent = text;
  return node;
}

function renderWelcome() {
  app.replaceChildren();
  const card = element('section', { class: 'candidate-card' });
  card.append(element('span', { class: 'eyebrow' }, `Welcome, ${manifest.candidate.name}`));
  card.append(element('h1', {}, manifest.test.title));
  card.append(element('p', {}, manifest.test.description));
  card.append(element('p', {}, `${manifest.questions.length} question(s) · ${manifest.test.durationMinutes} minutes`));
  const button = element('button', { class: 'button', type: 'button' }, 'Start test');
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { manifest = await api('/start', { method: 'POST', body: '{}' }); renderAttempt(); }
    catch (error) { showError(error.message); button.disabled = false; }
  });
  card.append(button);
  app.append(card);
}

function currentValue(question, container) {
  if (question.type === 'SINGLE_CHOICE') return container.querySelector('input:checked')?.value ?? '';
  if (question.type === 'MULTIPLE_CHOICE') return [...container.querySelectorAll('input:checked')].map((input) => input.value);
  return container.querySelector('textarea')?.value ?? '';
}

async function save(question, container) {
  const operation = crypto.randomUUID();
  pending.set(question.id, operation);
  connection.textContent = 'Saving…';
  try {
    await api(`/answers/${question.id}`, {
      method: 'PUT', body: JSON.stringify({ value: currentValue(question, container), idempotencyKey: operation }),
    });
    if (pending.get(question.id) === operation) pending.delete(question.id);
    container.querySelector('.save-state').textContent = 'Saved';
  } catch (error) {
    connection.textContent = 'Offline — retrying';
    connection.className = 'status offline';
    container.querySelector('.save-state').textContent = 'Not saved yet';
    setTimeout(() => { if (pending.get(question.id) === operation) void save(question, container); }, 3000);
  }
}

function renderQuestion(question) {
  const card = element('section', { class: 'question-card', 'data-question': question.id });
  card.append(element('span', { class: 'question-meta' }, `Question ${question.position} · ${question.maximumScore} points`));
  card.append(element('h2', {}, question.title));
  if (question.description) card.append(element('p', {}, question.description));
  card.append(element('p', { class: 'prompt' }, question.prompt));
  const field = element('div', { class: 'answer-field' });
  if (question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE') {
    question.choices.forEach((choice) => {
      const label = element('label', { class: 'choice' });
      const input = element('input', { type: question.type === 'SINGLE_CHOICE' ? 'radio' : 'checkbox', name: question.id, value: choice.id });
      const selected = question.type === 'SINGLE_CHOICE' ? question.answer === choice.id : Array.isArray(question.answer) && question.answer.includes(choice.id);
      input.checked = selected;
      input.addEventListener('change', () => void save(question, card));
      label.append(input, document.createTextNode(choice.label));
      field.append(label);
    });
  } else {
    const textarea = element('textarea', { rows: question.type === 'SHORT_ANSWER' ? '4' : '10', maxlength: '50000' });
    textarea.value = typeof question.answer === 'string' ? question.answer : '';
    let debounce;
    textarea.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => void save(question, card), 700);
    });
    field.append(textarea);
  }
  card.append(field, element('span', { class: 'save-state' }, question.savedAt ? 'Saved' : 'Not answered'));
  return card;
}

function updateTimer() {
  if (!manifest.attempt.deadlineAt) return;
  const remaining = Math.max(0, new Date(manifest.attempt.deadlineAt).getTime() - Date.now());
  const totalSeconds = Math.floor(remaining / 1000);
  timer.textContent = `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')} remaining`;
  if (remaining === 0) {
    clearInterval(timerHandle);
    document.querySelectorAll('input, textarea, button').forEach((control) => { control.disabled = true; });
  }
}

function renderAttempt() {
  clearInterval(timerHandle);
  app.replaceChildren();
  const heading = element('section', { class: 'candidate-heading' });
  heading.append(element('span', { class: 'eyebrow' }, manifest.candidate.name), element('h1', {}, manifest.test.title));
  const answered = manifest.questions.filter((question) => question.answer !== null && question.answer !== '' && (!Array.isArray(question.answer) || question.answer.length)).length;
  heading.append(element('p', {}, `${answered} of ${manifest.questions.length} answered`));
  app.append(heading);
  manifest.questions.forEach((question) => app.append(renderQuestion(question)));
  const submit = element('button', { class: 'button submit-button', type: 'button' }, 'Review and submit');
  submit.addEventListener('click', async () => {
    if (!window.confirm('Submit your final answers? You cannot change them afterward.')) return;
    submit.disabled = true;
    try {
      await Promise.all([...pending.keys()].map((id) => {
        const question = manifest.questions.find((item) => item.id === id);
        const card = document.querySelector(`[data-question="${id}"]`);
        return question && card ? save(question, card) : Promise.resolve();
      }));
      await api('/submit', { method: 'POST', body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) });
      renderComplete();
    } catch (error) { showError(error.message); submit.disabled = false; }
  });
  app.append(submit);
  updateTimer();
  timerHandle = setInterval(updateTimer, 1000);
}

function renderComplete() {
  clearInterval(timerHandle);
  timer.textContent = 'Submitted';
  app.replaceChildren();
  const card = element('section', { class: 'candidate-card' });
  card.append(element('span', { class: 'eyebrow' }, 'Complete'), element('h1', {}, 'Your answers were submitted'));
  card.append(element('p', {}, 'You may close this window. Your interviewer will review the result.'));
  app.append(card);
}

function showError(message) {
  const alert = element('p', { class: 'error-banner', role: 'alert' }, message);
  app.prepend(alert);
}

window.addEventListener('offline', () => { connection.textContent = 'Offline'; connection.className = 'status offline'; });
window.addEventListener('online', () => { connection.textContent = 'Back online'; connection.className = 'status online'; });

api('/attempt').then((data) => {
  manifest = data;
  if (manifest.attempt.state === 'SUBMITTED') renderComplete();
  else if (manifest.attempt.startedAt) renderAttempt();
  else renderWelcome();
}).catch((error) => { app.textContent = ''; showError(error.message); });
