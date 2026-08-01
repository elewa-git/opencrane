# Personal-assets state

> [frontend](../../README.md) › [state](../README.md) › assets

This group contains the browser-state boundary for assets owned by the signed-in user. A personal asset is a durable document, upload, generated result, or skill artifact whose bytes remain behind OpenCrane's server-side authorization boundary.

## Map

| Package | What it owns |
| --- | --- |
| [adapter](./adapter/README.md) | The read-only Angular port and live Control Plane adapter for owner-bound asset metadata. |

```
 opencrane-ui feature
          │ injects a read-only port
          ▼
 assets/adapter  ◄── HERE
          │ fetches safe owner-bound metadata
          ▼
 Control Plane API → artifact catalogue authority
```

## Dependency rule for this group

Packages here carry `scope:web`, `layer:frontend`, and `type:lib`. They may depend on frontend core and browser-safe shared contracts, but never on UI features, backend domains, or an application. The server derives both owner and silo; the browser supplies neither coordinate.

## See also

- Parent index: [state](../README.md)
- Child package: [adapter](./adapter/README.md)
- Sibling: [skills](../skills/README.md)
