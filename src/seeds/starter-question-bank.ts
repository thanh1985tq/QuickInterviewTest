import type { Knex } from 'knex';
import type { AuthContext } from '../auth/service.js';
import type { QuestionInput } from '../questions/schemas.js';
import { createQuestion, publishQuestion } from '../questions/service.js';
import { nowIso } from '../domain/types.js';

export interface StarterQuestion {
  seedKey: string;
  question: QuestionInput;
}

type Difficulty = QuestionInput['difficulty'];

function choiceQuestion(
  seedKey: string, domain: string, title: string, prompt: string, options: string[], correctIndexes: number[],
  tags: string[], difficulty: Difficulty = 'MID', multiple = false,
): StarterQuestion {
  const choices = options.map((label, index) => ({ id: String.fromCharCode(97 + index), label }));
  return {
    seedKey,
    question: {
      title, description: `Assesses ${tags.join(', ').toLocaleLowerCase('en-US')}.`, prompt, domain,
      type: multiple ? 'MULTIPLE_CHOICE' : 'SINGLE_CHOICE', difficulty,
      expectedDurationMinutes: multiple ? 5 : 4, maximumScore: multiple ? 8 : 5, choices,
      answerKey: { correctChoiceIds: correctIndexes.map((index) => choices[index]?.id as string) },
      scoringRubric: '', tags,
    },
  };
}

function writtenQuestion(
  seedKey: string, domain: string, title: string, prompt: string, rubric: string, tags: string[],
  difficulty: Difficulty = 'MID', type: 'SCENARIO' | 'SHORT_ANSWER' | 'LONG_ANSWER' | 'CODE_ANSWER' = 'SCENARIO',
  expectedDurationMinutes = 12,
): StarterQuestion {
  return {
    seedKey,
    question: {
      title, description: `Practical ${tags.join(', ').toLocaleLowerCase('en-US')} interview scenario.`, prompt, domain,
      type, difficulty, expectedDurationMinutes, maximumScore: 10, choices: [],
      answerKey: { correctChoiceIds: [] }, scoringRubric: rubric, tags,
    },
  };
}

const automationQuestions: StarterQuestion[] = [
  choiceQuestion('automation-01-test-pyramid', 'AUTOMATION_TESTING', 'Choosing the right test layer',
    'A validation can be covered reliably at the service API layer. What is the strongest default choice?',
    ['Cover it only through the browser', 'Cover it primarily at the API layer and keep a thin UI confidence check', 'Replace it with a unit test even if integration behavior matters', 'Run the browser test five times'],
    [1], ['test strategy', 'test pyramid'], 'JUNIOR'),
  choiceQuestion('automation-02-parallel-isolation', 'AUTOMATION_TESTING', 'Parallel browser isolation',
    'Which design best prevents tests running in parallel from corrupting one another?',
    ['One shared browser page and shared account', 'A fresh browser context and unique test data per test', 'A fixed execution order', 'Long sleeps between tests'],
    [1], ['parallelism', 'browser automation'], 'JUNIOR'),
  choiceQuestion('automation-03-resilient-locators', 'AUTOMATION_TESTING', 'Resilient locator strategy',
    'Which locator practices usually produce the most maintainable UI tests? Select all that apply.',
    ['Prefer user-facing roles and accessible names', 'Use stable test IDs when semantic locators are unavailable', 'Depend on deeply nested CSS selectors', 'Assert that the intended element is unique'],
    [0, 1, 3], ['locators', 'accessibility'], 'MID', true),
  choiceQuestion('automation-04-waits', 'AUTOMATION_TESTING', 'Condition-based waiting',
    'A test is flaky because an asynchronous status changes at variable speed. What should replace a fixed sleep?',
    ['A longer fixed sleep', 'A retry loop with no timeout', 'A bounded wait for the observable status or network condition', 'Running the test serially'],
    [2], ['synchronization', 'flakiness'], 'JUNIOR'),
  choiceQuestion('automation-05-page-objects', 'AUTOMATION_TESTING', 'Page object responsibilities',
    'Which responsibilities belong in a maintainable page/component object? Select all that apply.',
    ['Stable element interaction methods', 'Every business assertion in the suite', 'Reusable UI-level workflows', 'Direct database cleanup for unrelated tests'],
    [0, 2], ['design patterns', 'page objects'], 'MID', true),
  writtenQuestion('automation-06-api-authorization', 'AUTOMATION_TESTING', 'Authorization regression suite',
    'Design an automated API test strategy for an endpoint that allows managers to edit reports but permits employees to view only their own reports. Include positive, negative, and data-isolation coverage.',
    'Award points for a role/action matrix, ownership boundaries, 401 versus 403 cases, cross-tenant identifiers, setup/cleanup isolation, and assertions on both response and persisted state.',
    ['API testing', 'authorization'], 'MID'),
  writtenQuestion('automation-07-flaky-triage', 'AUTOMATION_TESTING', 'Triaging a flaky checkout test',
    'A checkout UI test fails 3% of the time only in CI. Explain the evidence you would collect, how you would isolate the cause, and what you would change before enabling retries.',
    'Award points for reproducibility data, trace/video/network/console evidence, timing and environment comparison, failure classification, a root-cause fix, and limited diagnostic retries rather than masking.',
    ['flakiness', 'CI'], 'SENIOR'),
  writtenQuestion('automation-08-ci-sharding', 'AUTOMATION_TESTING', 'Scaling a slow CI suite',
    'A 90-minute automation suite must finish within 20 minutes. Propose a safe sharding and parallelization plan, including how to protect shared environments and preserve useful reporting.',
    'Award points for duration-aware sharding, isolated data/accounts, worker limits, fail-safe cleanup, artifact aggregation, flaky-test visibility, and capacity checks on dependencies.',
    ['CI', 'parallelism'], 'SENIOR'),
  writtenQuestion('automation-09-test-data', 'AUTOMATION_TESTING', 'Test data isolation strategy',
    'Describe a test-data strategy for parallel end-to-end tests against a shared staging environment where destructive database resets are not allowed.',
    'Award points for unique namespaces, API-based setup, ownership tagging, idempotent cleanup, time-bound garbage collection, collision avoidance, and observability of leaked data.',
    ['test data', 'parallelism'], 'MID'),
  choiceQuestion('automation-10-contract-vs-e2e', 'AUTOMATION_TESTING', 'Contract and end-to-end coverage',
    'Two services exchange a versioned JSON payload. Which approach catches compatibility breaks fastest with the least end-to-end cost?',
    ['Only a nightly browser test', 'Consumer/provider contract tests in CI plus a small integration smoke test', 'Manual verification before release', 'Snapshot every UI page'],
    [1], ['contract testing', 'API testing'], 'MID'),
  choiceQuestion('automation-11-visual-testing', 'AUTOMATION_TESTING', 'Stable visual regression tests',
    'Which controls reduce false positives in visual regression tests? Select all that apply.',
    ['Pin browser, viewport, fonts, and locale', 'Mask truly dynamic regions', 'Accept every changed baseline automatically', 'Wait for deterministic application state'],
    [0, 1, 3], ['visual testing', 'determinism'], 'MID', true),
  writtenQuestion('automation-12-mobile-strategy', 'AUTOMATION_TESTING', 'Mobile automation portfolio',
    'Design a mobile test portfolio for an application delivered on iOS and Android with shared business behavior but platform-specific permissions and navigation.',
    'Award points for layered coverage, device/OS risk matrix, real-device versus emulator choices, permission and lifecycle cases, network conditions, accessibility, and release-gate selection.',
    ['mobile', 'test strategy'], 'SENIOR'),
  choiceQuestion('automation-13-accessibility', 'AUTOMATION_TESTING', 'Accessibility automation boundaries',
    'Which statements about automated accessibility testing are correct? Select all that apply.',
    ['It catches many deterministic rule violations', 'It replaces keyboard and screen-reader evaluation', 'It can run on critical states in CI', 'Violations need context and prioritization'],
    [0, 2, 3], ['accessibility', 'quality gates'], 'MID', true),
  writtenQuestion('automation-14-mocking-boundaries', 'AUTOMATION_TESTING', 'Choosing mock boundaries',
    'A payment provider is costly and rate-limited in test environments. Explain what to mock, what to contract-test, and what small set of real-provider tests you would retain.',
    'Award points for mocking at the provider boundary, contract fidelity, deterministic failure simulation, sandbox smoke tests, webhook coverage, secret handling, and avoiding mocks of owned business logic.',
    ['mocking', 'integration testing'], 'SENIOR'),
  writtenQuestion('automation-15-cleanup', 'AUTOMATION_TESTING', 'Idempotent cleanup',
    'What properties make automated test cleanup safe to retry after a partially failed test run?',
    'Award points for unique ownership markers, delete-if-present behavior, dependency ordering, bounded scope, retryable APIs, and logging without deleting unrelated data.',
    ['cleanup', 'reliability'], 'MID', 'SHORT_ANSWER', 6),
  choiceQuestion('automation-16-browser-context', 'AUTOMATION_TESTING', 'Session isolation in browser tests',
    'Why is a new browser context commonly preferred over clearing cookies manually between tests?',
    ['It guarantees the server database is empty', 'It isolates cookies, storage, permissions, and cache with less cleanup leakage', 'It makes assertions unnecessary', 'It disables cross-origin security'],
    [1], ['browser automation', 'security'], 'JUNIOR'),
  writtenQuestion('automation-17-failure-evidence', 'AUTOMATION_TESTING', 'Actionable failure evidence',
    'Define the minimum failure artifacts and metadata a UI automation platform should preserve so a developer can diagnose a CI-only failure.',
    'Award points for trace, screenshot/video when useful, console and network failures, environment/build identity, test-data identifiers, timing, retry history, and secret redaction.',
    ['reporting', 'observability'], 'MID'),
  writtenQuestion('automation-18-roi', 'AUTOMATION_TESTING', 'Selecting automation candidates',
    'A team has 200 manual regression cases and capacity to automate only 40 this quarter. Describe a transparent prioritization model.',
    'Award points for business risk, execution frequency, defect history, repeatability, data/setup cost, maintenance cost, layer selection, feedback speed, and explicit cases that should remain exploratory.',
    ['automation ROI', 'test strategy'], 'SENIOR'),
  writtenQuestion('automation-19-code-review', 'AUTOMATION_TESTING', 'Retryable polling helper',
    'Write TypeScript-like pseudocode for a polling helper that waits for an asynchronous job to reach a terminal state. It must have a deadline, useful diagnostics, and no unbounded retry loop. Submitted code will be reviewed, not executed.',
    'Award points for monotonic deadline handling, bounded interval/backoff, terminal success/failure states, preservation of the last response, cancellation/error behavior, and readable diagnostics.',
    ['TypeScript', 'synchronization'], 'SENIOR', 'CODE_ANSWER', 15),
  writtenQuestion('automation-20-framework-migration', 'AUTOMATION_TESTING', 'Automation framework migration plan',
    'A brittle legacy UI suite must move to a modern framework without stopping weekly releases. Propose a staged migration plan, success measures, and rollback controls.',
    'Award points for inventory and risk segmentation, shared conventions, pilot selection, coexistence, CI integration, parity criteria, flake/runtime metrics, training, deprecation milestones, and rollback.',
    ['framework', 'migration'], 'EXPERT', 'LONG_ANSWER', 20),
];

const performanceQuestions: StarterQuestion[] = [
  choiceQuestion('performance-01-percentiles', 'PERFORMANCE_TESTING', 'Interpreting latency percentiles',
    'What does a p95 response time of 800 ms mean for the measured sample?',
    ['Every request completed in exactly 800 ms', 'About 95% completed in 800 ms or less', 'The average was 800 ms', 'Only 5% completed successfully'],
    [1], ['latency', 'percentiles'], 'JUNIOR'),
  choiceQuestion('performance-02-throughput', 'PERFORMANCE_TESTING', 'Throughput and concurrency',
    'When concurrency increases but throughput stops rising and latency climbs sharply, what is the strongest interpretation?',
    ['The system has likely reached a bottleneck or saturation point', 'The test needs fewer assertions', 'Percentiles are no longer valid', 'Caching is guaranteed to be working'],
    [0], ['throughput', 'saturation'], 'JUNIOR'),
  writtenQuestion('performance-03-workload-model', 'PERFORMANCE_TESTING', 'Production workload model',
    'Build a workload model for an online marketplace with browse, search, cart, checkout, and seller APIs. Explain how you derive transaction mix, arrival rate, data, and peak behavior.',
    'Award points for production evidence, user/transaction mix, open versus closed model choice, seasonality and peaks, think time, data cardinality, geography, background traffic, and documented assumptions.',
    ['workload modeling', 'capacity'], 'SENIOR'),
  choiceQuestion('performance-04-littles-law', 'PERFORMANCE_TESTING', 'Applying Little’s Law',
    'A stable system completes 100 requests/second with an average response time of 0.5 seconds. Approximately how many requests are in the system on average?',
    ['20', '50', '100', '200'], [1], ['Little’s Law', 'concurrency'], 'MID'),
  choiceQuestion('performance-05-warmup', 'PERFORMANCE_TESTING', 'Warm-up and steady state',
    'Which factors can make early test measurements unrepresentative? Select all that apply.',
    ['JIT compilation and lazy initialization', 'Cold caches and empty connection pools', 'A stable workload held for sufficient time', 'Autoscaling or database compute wake-up'],
    [0, 1, 3], ['warm-up', 'measurement'], 'MID', true),
  choiceQuestion('performance-06-coordinated-omission', 'PERFORMANCE_TESTING', 'Coordinated omission',
    'Why can a closed-loop load generator under-report severe latency during a stall?',
    ['It may stop scheduling new work while waiting for slow responses', 'It records too many failed requests', 'It always uses the wrong percentile formula', 'It disables server logging'],
    [0], ['load generation', 'measurement'], 'SENIOR'),
  choiceQuestion('performance-07-think-time', 'PERFORMANCE_TESTING', 'Modeling think time',
    'What is the main purpose of realistic think time in a user-session workload?',
    ['To hide server errors', 'To represent pauses between user actions and avoid an unrealistically tight loop', 'To replace ramp-up', 'To guarantee constant throughput'],
    [1], ['workload modeling', 'think time'], 'JUNIOR'),
  writtenQuestion('performance-08-bottleneck', 'PERFORMANCE_TESTING', 'Bottleneck investigation',
    'At peak load, API latency doubles while application CPU remains 35%, database CPU reaches 90%, lock waits rise, and the connection pool is full. Describe your investigation and validation plan.',
    'Award points for correlating timelines, query/lock analysis, pool wait versus execution time, slow-query evidence, controlled hypothesis tests, safe tuning, and rerunning the same workload to validate.',
    ['bottleneck analysis', 'database'], 'SENIOR'),
  choiceQuestion('performance-09-generator-health', 'PERFORMANCE_TESTING', 'Load-generator saturation',
    'Which signals suggest the load generator—not the system under test—is saturated? Select all that apply.',
    ['Generator CPU or event-loop delay is high', 'Requested arrival rate is not achieved', 'Server resource use remains low while client-side latency rises', 'All server replicas show identical high CPU'],
    [0, 1, 2], ['load generation', 'observability'], 'MID', true),
  writtenQuestion('performance-10-connection-pool', 'PERFORMANCE_TESTING', 'Connection-pool tuning',
    'A service opens a very large database pool per replica. Under scale-out, database connection limits are exhausted. Explain how you would size, test, and monitor the pools.',
    'Award points for total connections across replicas, database capacity, request concurrency, queueing, transaction duration, min/max/idle settings, failure behavior, and load validation rather than formula-only tuning.',
    ['database', 'connection pooling'], 'SENIOR'),
  writtenQuestion('performance-11-cache', 'PERFORMANCE_TESTING', 'Cache-aware performance test',
    'Design tests that distinguish cold-cache, warm-cache, cache-churn, and stampede behavior for a read-heavy service.',
    'Award points for explicit cache state, data cardinality, hit/miss measurement, invalidation, TTL boundaries, hot-key distribution, concurrency at expiry, origin load, and separate reported scenarios.',
    ['caching', 'workload modeling'], 'SENIOR'),
  choiceQuestion('performance-12-ramp', 'PERFORMANCE_TESTING', 'Ramp-up design',
    'Why should a load test often ramp traffic instead of jumping instantly to peak?',
    ['It guarantees no failures', 'It reveals capacity transitions and allows realistic scaling behavior to occur', 'It removes the need for monitoring', 'It makes all requests independent'],
    [1], ['ramp-up', 'autoscaling'], 'JUNIOR'),
  writtenQuestion('performance-13-slo', 'PERFORMANCE_TESTING', 'Turning SLOs into pass criteria',
    'Translate “99.9% monthly availability and p95 checkout latency below 1.2 seconds” into testable performance acceptance criteria. State important limitations.',
    'Award points for workload and measurement windows, percentile and error thresholds, allowed exclusions, sample size, dependency behavior, burn-rate context, test-versus-monthly limitations, and stop conditions.',
    ['SLO', 'acceptance criteria'], 'SENIOR'),
  writtenQuestion('performance-14-memory', 'PERFORMANCE_TESTING', 'Detecting a memory leak',
    'During an eight-hour steady-load test, heap usage shows a rising sawtooth and does not return to its earlier baseline after garbage collection. Describe how you would confirm and localize a leak.',
    'Award points for stable workload, GC and allocation metrics, heap snapshots/profiles at comparable points, retained-object analysis, native/container memory, controlled reproduction, and fix verification.',
    ['endurance testing', 'memory'], 'SENIOR'),
  choiceQuestion('performance-15-network', 'PERFORMANCE_TESTING', 'Realistic network conditions',
    'Which factors belong in a geographically distributed client-performance plan? Select all that apply.',
    ['Round-trip latency and packet loss', 'TLS and connection reuse', 'CDN/cache location', 'Only server-side execution time'],
    [0, 1, 2], ['network', 'geography'], 'MID', true),
  writtenQuestion('performance-16-capacity', 'PERFORMANCE_TESTING', 'Capacity test design',
    'Design a capacity test that estimates the maximum sustainable order rate for a service while protecting the shared environment from uncontrolled overload.',
    'Award points for sustainable definition, stepwise load, guardrails and abort thresholds, steady-state holds, saturation signals, dependency limits, recovery observation, and repeatability/confidence bounds.',
    ['capacity', 'saturation'], 'SENIOR'),
  choiceQuestion('performance-17-endurance', 'PERFORMANCE_TESTING', 'Purpose of an endurance test',
    'What is an endurance or soak test primarily intended to expose?',
    ['Only maximum instantaneous throughput', 'Degradation that accumulates over time, such as leaks or resource exhaustion', 'Functional requirement gaps', 'Compiler syntax errors'],
    [1], ['endurance testing', 'reliability'], 'JUNIOR'),
  writtenQuestion('performance-18-variance', 'PERFORMANCE_TESTING', 'Handling result variance',
    'Two identical performance runs differ by 12% in p95 latency. Explain how you determine whether this is noise, environment variation, or a real regression.',
    'Award points for repeated runs, confidence/dispersion, environment and build identity, workload achievement, outlier inspection, resource/trace correlation, controlled baselines, and a predefined regression threshold.',
    ['statistics', 'regression analysis'], 'SENIOR'),
  writtenQuestion('performance-19-correlation', 'PERFORMANCE_TESTING', 'Correlating performance telemetry',
    'Describe a timeline you would build to correlate client latency with service, runtime, database, cache, queue, and infrastructure signals during a load test.',
    'Award points for synchronized clocks, request rate/errors/percentiles, resource saturation, queue and pool waits, traces, dependency metrics, deployment/scaling events, and hypothesis-driven annotations.',
    ['observability', 'analysis'], 'MID'),
  writtenQuestion('performance-20-test-plan', 'PERFORMANCE_TESTING', 'Performance qualification plan',
    'Create a performance qualification plan for a new public API before launch. Cover objectives, workload, environments, data, observability, scenarios, acceptance, execution controls, analysis, and reporting.',
    'Award points for risk-linked objectives, representative models, environment limitations, safe data, smoke/load/stress/spike/endurance choices, telemetry, criteria, abort/recovery controls, reproducibility, and decision-focused reporting.',
    ['test plan', 'performance engineering'], 'EXPERT', 'LONG_ANSWER', 20),
];

export const starterQuestionBank: StarterQuestion[] = [...automationQuestions, ...performanceQuestions];

export async function seedStarterQuestionBank(
  database: Knex, auth: AuthContext, requestId = 'starter-question-bank',
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const item of starterQuestionBank) {
    await database.transaction(async (transaction) => {
      const existing = await transaction<{ seed_key: string }>('question_library_seeds')
        .where({ seed_key: item.seedKey }).first('seed_key');
      if (existing) {
        skipped += 1;
        return;
      }
      const questionId = await createQuestion(transaction, item.question, auth, requestId);
      await publishQuestion(transaction, questionId, auth, requestId);
      await transaction('question_library_seeds').insert({
        seed_key: item.seedKey, question_id: questionId, created_at: nowIso(),
      });
      inserted += 1;
    });
  }
  return { inserted, skipped };
}
