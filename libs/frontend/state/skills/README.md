# Skills state

> [frontend](../../README.md) › [state](../README.md) › skills

This group contains the browser-state adapter for the governed skill catalogue. A **governed skill** is a reusable, reviewed automation instruction; the browser can see its safe catalogue metadata but cannot inspect its source, revision evidence, or execution details.

## Map

| Package | What it owns |
| --- | --- |
| [adapter](./adapter/README.md) | The read-only Angular port and live Control Plane adapter for the host-silo skill catalogue. |

```
 opencrane-ui feature
          │ injects a read-only port
          ▼
 skills/adapter  ◄── HERE
          │ fetches safe catalogue metadata
          ▼
 Control Plane API → governed skill authority
```

## Dependency rule for this group

Packages here carry `scope:web` and `type:state`. They may depend on frontend core and shared contracts, but never on UI features, backend domains, or an application. The server, not the browser, chooses the current silo and filters what a session may see.

## See also

- Parent index: [state](../README.md)
- Child package: [adapter](./adapter/README.md)
- Sibling: [gateways](../gateways/README.md)
