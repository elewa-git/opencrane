# Deploy ledger

Append-only log for deployment runs against the current OpenCrane architecture. The `deploy` agent
reads this file before every run and appends one concise evidence block afterwards.

Historical deployment evidence for removed product paths remains available in Git history and must
not be reused as current operational guidance.

## Format

```text
## <date> · <environment> · <profile> · <sha> · <LIVE|PARTIAL|FAILED>
- findings: <class>: one evidence-backed line per finding
- friction: repeated configuration or script difficulty
- lesson: what the next run must verify
```

When a lesson is fixed at its source, replace it with a one-line pointer to the fixing pull request.
Full run reports belong in the corresponding pull request or issue.

## Standing lessons

- Resolve chart dependencies from `Chart.lock` with `helm dep build`.
- Put repeatable environment configuration in a checked-in values profile.
- A passing render does not prove an in-place upgrade will accept immutable-field changes; inspect
  the live object and release manifest before applying.
- Verify the running image digest and application health after rollout.
- Mutate clusters only through the app-owned deployment scripts.

## Runs

No current-architecture deployment run has been recorded yet.
