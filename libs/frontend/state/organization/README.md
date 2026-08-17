# Organisation state — membership browser state

> [frontend](../../README.md) › [state](../README.md) › organisation

This group contains browser state and transport adapters for organisation-level capabilities.

## Map

| Package | What it owns |
| --- | --- |
| [`members`](./members/README.md) | Member-directory and invitation gateway port, stores, and state vocabulary. |
| [`members/adapter`](./members/adapter/README.md) | Generated-client HTTP implementation of the member gateway. |

```
 settings feature
       │
       ▼
 members state port ◄──── members/adapter
       │                         │
       └──── typed results ──────┘
```

## Dependency rule for this tier

Packages use `scope:organization-members`. Features depend on state ports, while adapters depend
inward on the port and shared HTTP client; state never imports its adapter or a feature.

## See also

- Parent index: [state](../README.md)
- Consumer: [settings feature](../../features/settings/README.md)
