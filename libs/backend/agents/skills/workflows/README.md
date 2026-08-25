# Skill workflows

> [backend](../../../../README.md) › [agents](../../../README.md) › [skills](../../README.md) › workflows

| Package | What it owns |
|---|---|
| [contract](./contract/README.md) | The shared name, input, and retry policy for one remote skill validation task. |
| [main](./main/README.md) | Transaction-bound admission that creates or finds a validation and saves its task receipt. |

The contract is dependency-light so the server and controller agree on task facts without importing
each other's implementation. The main package provides the admission rule that a later product
adapter will use to save the task in the caller's database transaction. No product adapter or
controller registration is wired in this initial slice.

```
 server composition ──► contract ◄── controller
          │
          ▼
   main admission ──► saved remote task
```

## See also

- Parent: [skills](../../README.md)
- Controller: [controller](../../controller/README.md)
