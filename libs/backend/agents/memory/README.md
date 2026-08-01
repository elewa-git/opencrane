# Agent memory — durable fact metadata

> [backend](../../README.md) › [agents](../README.md) › memory

This group holds the shared, non-personal part of agent memory: metadata that can describe a
durable fact in any future agent scope. It is separate from `personal/`, which only decides which
verified user's personal dataset and preferences may enter a run.

| Package | What it owns |
| --- | --- |
| [main](./main/README.md) | Generic fact catalogue metadata and its atomic outbox intent. |

```
 Cognee durable content ── accepted fact evidence ──► memory/main
                                                  metadata + outbox only
```

Packages here use `scope:memory`. They may use artifact references and shared contracts, but they
never select a personal subject, call Cognee, or import an app.

## See also

- Parent index: [agents](../README.md)
- Personal selection: [personal memory](../personal/memory/main/README.md)
