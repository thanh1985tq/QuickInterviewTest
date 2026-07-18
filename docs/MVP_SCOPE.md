# Version 1 scope

## Included

- Offline bootstrap of administrative users and role-based admin access.
- Versioned question bank for choice, text, code-text, and scenario questions.
- Versioned templates and immutable per-candidate question snapshots.
- Candidate records, scoped expiring links, availability windows, and server deadlines.
- Standard Web autosave, refresh/reconnect resume, idempotent submission, and responsive UI.
- Server-side objective scoring, manual scores/comments, audit history, and CSV/JSON results.
- Fixed Colab/Gradio runner with one-time exchange, manifest, registration, heartbeat, and recovery.
- Explicit JSON import/export, SQLite backup, and PostgreSQL backup documentation.
- SQLite local operation, PostgreSQL cloud operation, Render deployment/runbook, and automated coverage of critical flows.

## Explicitly excluded

- Executing candidate-submitted code or running k6, JMeter, Locust, Selenium, Playwright, shell, or Python submissions.
- Public administrator registration, candidate user accounts, automatic email delivery, webcam/screen proctoring, or AI scoring.
- Multi-tenant SaaS/billing, high-availability Colab hosting, or automatic/bidirectional SQLite/PostgreSQL synchronization.
- Persistent application data, sessions, answers, or backups on the Render filesystem.

## Version 1 acceptance boundary

Version 1 is complete when another operator can bootstrap an admin, author and publish content, create an independently tokenized attempt, complete and resume it through Standard Web, score/review/export it, optionally render it with the fixed Colab runner, deploy to Render with external PostgreSQL, and recover through documented backups—without exposing answer keys or relying on ephemeral filesystem state.
