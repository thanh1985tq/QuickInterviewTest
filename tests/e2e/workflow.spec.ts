import { expect, test } from '@playwright/test';

test('administrator creates a Standard Web attempt and the candidate submits it', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator('#identity')).toContainText('ADMIN');

  const session = await page.request.get('/api/auth/session');
  const csrf = ((await session.json()) as { csrfToken: string }).csrfToken;
  const headers = { 'X-CSRF-Token': csrf };
  const questionResponse = await page.request.post('/api/questions', {
    headers,
    data: {
      title: 'Browser isolation', description: 'A concise architecture question.',
      prompt: 'Which option isolates parallel browser tests?', domain: 'AUTOMATION_TESTING',
      type: 'SINGLE_CHOICE', difficulty: 'MID', expectedDurationMinutes: 5, maximumScore: 10,
      choices: [{ id: 'shared', label: 'One shared page' }, { id: 'isolated', label: 'A context per test' }],
      answerKey: { correctChoiceIds: ['isolated'] }, scoringRubric: '', tags: ['Playwright'],
    },
  });
  expect(questionResponse.ok()).toBeTruthy();
  const question = (await questionResponse.json()) as { id: string; versionId: string };
  expect((await page.request.post(`/api/questions/${question.id}/publish`, { headers })).ok()).toBeTruthy();

  const templateResponse = await page.request.post('/api/templates', {
    headers,
    data: {
      title: 'Browser automation screen', description: 'Complete the required question.',
      domain: 'AUTOMATION_TESTING', targetSeniority: 'MID', durationMinutes: 20,
      randomizeQuestions: false, selectionMode: 'FIXED',
      sections: [{ key: 'main', title: 'Main', maximumScore: 10 }],
      navigation: { allowBack: true, requireSequential: false },
      questions: [{ questionVersionId: question.versionId, sectionKey: 'main', position: 1, scoreWeight: 1, required: true }],
    },
  });
  expect(templateResponse.ok()).toBeTruthy();
  const template = (await templateResponse.json()) as { id: string };
  expect((await page.request.post(`/api/templates/${template.id}/publish`, { headers })).ok()).toBeTruthy();

  const instanceResponse = await page.request.post('/api/test-instances', {
    headers,
    data: {
      templateId: template.id, candidate: { name: 'Browser Candidate', email: 'browser@example.com' },
      deliveryMode: 'STANDARD_WEB', availableFrom: new Date(Date.now() - 60_000).toISOString(),
      availableUntil: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 20,
    },
  });
  expect(instanceResponse.ok()).toBeTruthy();
  const instance = (await instanceResponse.json()) as { candidateUrl: string };

  await page.goto(instance.candidateUrl);
  await expect(page.getByRole('heading', { name: 'Browser automation screen' })).toBeVisible();
  await page.getByRole('button', { name: 'Start test' }).click();
  await page.getByLabel('A context per test').check();
  await expect(page.locator('.save-state')).toHaveText('Saved');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Review and submit' }).click();
  await expect(page.getByRole('heading', { name: 'Your answers were submitted' })).toBeVisible();
});
