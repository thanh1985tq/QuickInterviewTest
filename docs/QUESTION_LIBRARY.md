# Starter question library

QuickInterviewTest includes a versioned starter library of 40 published questions. It contains 20 Automation Testing questions and 20 Performance Testing questions across junior, mid, senior, and expert levels.

The library combines automatically scored single/multiple-choice questions with scenario, short-answer, long-answer, and code-review prompts. Code answers are stored as text and are never executed.

## Automation Testing coverage

1. Choosing the right test layer
2. Parallel browser isolation
3. Resilient locator strategy
4. Condition-based waiting
5. Page object responsibilities
6. Authorization regression suite
7. Triaging a flaky checkout test
8. Scaling a slow CI suite
9. Test data isolation strategy
10. Contract and end-to-end coverage
11. Stable visual regression tests
12. Mobile automation portfolio
13. Accessibility automation boundaries
14. Choosing mock boundaries
15. Idempotent cleanup
16. Session isolation in browser tests
17. Actionable failure evidence
18. Selecting automation candidates
19. Retryable polling helper
20. Automation framework migration plan

## Performance Testing coverage

1. Interpreting latency percentiles
2. Throughput and concurrency
3. Production workload model
4. Applying Little's Law
5. Warm-up and steady state
6. Coordinated omission
7. Modeling think time
8. Bottleneck investigation
9. Load-generator saturation
10. Connection-pool tuning
11. Cache-aware performance test
12. Ramp-up design
13. Turning SLOs into pass criteria
14. Detecting a memory leak
15. Realistic network conditions
16. Capacity test design
17. Purpose of an endurance test
18. Handling result variance
19. Correlating performance telemetry
20. Performance qualification plan

## Loading the library

Set `SEED_ADMIN_EMAIL` to an existing active administrator, configure the target database profile, and run:

```text
npm run migrate
npm run seed:question-bank
```

The command uses the normal question authoring and publication services. Each entry has a stable seed key stored in `question_library_seeds`, so rerunning the same application version does not create duplicates. The source is maintained in `src/seeds/starter-question-bank.ts`.

Custom domains and manually authored questions are never overwritten or removed by this seed. Add future disciplines in the admin console under **Domains** before authoring or importing content for them.
