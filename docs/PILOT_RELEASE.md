# Pilot and release checklist

## Alpha — local SQLite

- Bootstrap an admin and change its password.
- Provision interviewer/reviewer roles; verify denied operations.
- Create, revise, publish, duplicate, export, and import questions.
- Build/publish a template and prove a later question edit does not change its snapshot.
- Complete a Standard Web attempt through refresh, connectivity interruption, autosave retry, submit, objective/manual scoring, comments, and exports.
- Create and restore an SQLite backup.

## Beta — Render and external PostgreSQL

- Run PostgreSQL CI and deploy through the production runbook.
- Confirm HTTPS cookie attributes and persistence across a redeploy/cold start.
- Use internal candidates on realistic Automation and Performance Testing templates.
- Inspect deadlines, reconnect behavior, audit trail, scoring revisions, exports, and provider backup restore.
- Record cold-start time and warm the service before every scheduled interview.

## Lab Beta — selected internal attempts

- Use only the fixed versioned notebook/runner.
- Verify token reuse fails, manifest is candidate-safe, Gradio authentication is required, and status gates sharing.
- Stop Colab after an autosave, relaunch with a new token, verify old credentials fail, and confirm answers recover.
- Exercise missed heartbeat → `OFFLINE` and document the operator response.

## Version 1 approval

- Standard Web is approved for normal interviews; Lab Mode remains visibly experimental and selected per attempt.
- Security and operations checklists are signed off; no high-severity dependency finding is open.
- PostgreSQL is the only cloud data store and Render has no persistent application disk.
- Backup/restore, rollback, retention, anonymization, and cold-start procedures have named owners.
- Another developer/operator can follow the README and runbooks without undocumented credentials or steps.
