# Data retention and candidate anonymization

`DATA_RETENTION_DAYS` is the operator's default retention target. QuickInterviewTest does not silently delete interview evidence. Operators must align retention with consent, employment policy, and applicable law.

Run `npm run retention` periodically to delete expired administrative sessions, expired runner tokens, and old login-throttle history. This does not delete attempts, answers, scores, or audit records.

To anonymize the directly identifying candidate fields while preserving result referential integrity:

```text
npm run retention -- --anonymize-candidate 00000000-0000-0000-0000-000000000000
```

The command replaces the name, removes email and metadata, and records the anonymization time. Review free-text answers, reviewer comments, and audit detail separately because users may have entered identifying information there. For complete erasure, export required audit evidence, take a verified backup, and use an operator-reviewed database procedure rather than an automated cascade.
