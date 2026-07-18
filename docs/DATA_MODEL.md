# Data model

All primary keys are UUIDs and all timestamps represent UTC. JSON values are stored as JSON text on SQLite and JSON-compatible values on PostgreSQL through the repository boundary.

## Identity and audit

| Table | Purpose and important constraints |
| --- | --- |
| `users` | Administrative identities. Unique normalized email, password hash, `ADMIN`/`INTERVIEWER`/`REVIEWER` role, active flag, optional forced password change. |
| `user_sessions` | Database-backed opaque sessions. Only a SHA-256 token hash is stored; includes CSRF secret, expiry, last-seen time, and revocation time. |
| `login_attempts` | Successful and failed login events used for brute-force throttling. |
| `admin_audit_log` | Actor, action, target, request ID, timestamp, and non-sensitive JSON detail for administrative changes. |

## Question bank

| Table | Purpose and important constraints |
| --- | --- |
| `domains` | Administrator-managed interview disciplines. Unique stable slug, editable display name/description, and active/archive state. |
| `questions` | Stable question identity, author, current lifecycle status, and current version number. |
| `question_versions` | Immutable published revisions plus editable draft revisions. Contains type, prompt, choices, scoring configuration, rubric, duration, and maximum score. Unique `(question_id, version)`. |
| `tags` | Unique normalized skill tag. |
| `question_tags` | Many-to-many link with composite uniqueness. |
| `question_library_seeds` | Idempotency registry that maps each versioned starter-library key to the question it created. |

A published version is never updated. Editing a published question creates the next draft version. Archiving changes discoverability, not historical snapshots. Domain slugs are stable references; renaming a domain changes only its display metadata. Archiving a domain blocks new questions/templates in that domain but preserves all historical content.

## Templates and test instances

| Table | Purpose and important constraints |
| --- | --- |
| `test_templates` | Stable template identity, author, lifecycle status, and current version. |
| `test_template_versions` | Immutable published revision; includes duration, domain, seniority, sections, randomization, navigation, and selection settings. |
| `test_template_questions` | Ordered published question-version references and section/scoring metadata. Unique position per template version. |
| `candidates` | Candidate identity and optional email. Email is not an application account. |
| `test_instances` | A template-version assignment to one candidate with delivery mode, availability window, duration, and immutable configuration. |
| `test_instance_questions` | Ordered snapshot of every candidate-visible question field plus server-only scoring data. Later question edits cannot change it. |

## Attempts, answers, and evaluation

| Table | Purpose and important constraints |
| --- | --- |
| `candidate_attempts` | One attempt per test instance, state, hashed candidate token, expiry, start/deadline/submission timestamps. |
| `answers` | One row per attempt/question. Contains normalized JSON answer, client idempotency key, and save timestamp. Unique `(attempt_id, instance_question_id)`. |
| `attempt_events` | Append-only lifecycle/audit timeline without secret values. |
| `scores` | Objective or manual score per answer, reviewer, reason, revision, and timestamp. Changes append revisions instead of overwriting history. |
| `review_comments` | Append-only reviewer comments scoped to an attempt and optionally a question. |

Once an attempt is submitted or expired, candidate writes are rejected. Reviewer scoring and comments remain available without mutating the submitted answers.

## Colab delivery

| Table | Purpose and important constraints |
| --- | --- |
| `runner_tokens` | Single-use hashed exchange token, attempt scope, expiry, consumed time. |
| `deployments` | Colab runner lifecycle, hashed short-lived credential, Gradio URL, hashed candidate Gradio password, last heartbeat, generation, and state. |

Candidate tokens, session IDs, runner exchange tokens, runner credentials, and Gradio passwords are never stored in plaintext. Plain values exist only in the immediate response that creates or rotates them.

## Referential and portability rules

- Foreign keys are enabled on SQLite and PostgreSQL.
- Destructive cascades are limited to draft/configuration records; historical attempts use restrictive references.
- Portable application-level status validation supplements database constraints.
- Migration order is identical for both engines and migration history is stored in the selected database.
- There is no connection or synchronization process between the SQLite and PostgreSQL environments.
