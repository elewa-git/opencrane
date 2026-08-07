# Module-growth checker architecture

> [repository agent guidance](../../docs/agents/maintainability.md) › module-growth checker

This folder implements the deterministic, language-neutral pre-review gate. It produces candidates
for modeled maintainability review; it does not claim that a long file is architecturally wrong.

```text
module-growth-check.mjs
          │ arguments + exit status
          ▼
       cli.mjs ─────────► git.mjs
          │               changed files and baseline counts
          ▼
       core.mjs
       source classification, thresholds, exceptions, findings
```

| File | Owns | Must never own |
| --- | --- | --- |
| `cli.mjs` | Argument parsing, configuration loading, reporting, exit status | Threshold policy or Git command details |
| `git.mjs` | Repository discovery, changed paths, baseline content, added-line counts | Source classification or review policy |
| `core.mjs` | Pure source classification, configuration validation, exception validation, growth evaluation | Filesystem, subprocesses, or terminal output |

The pure core is tested with Node's built-in test runner. The CLI remains dependency-free so the
gate runs before package installation and can cover repositories containing several implementation
languages.
