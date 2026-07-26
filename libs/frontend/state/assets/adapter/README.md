# @opencrane/state/assets/adapter — personal asset catalogue gateway

> [frontend](../../../README.md) › [state](../../README.md) › [assets](../README.md) › adapter

## What it owns

This package belongs to the frontend state layer, between Angular features and the Control Plane HTTP API. It exposes the signed-in user's **personal asset catalogue** through a narrow, read-only gateway. The catalogue contains browser-safe metadata, never the stored content or the server evidence that controls access to it.

A feature injects `PERSONAL_ASSETS_GATEWAY` and asks for the current catalogue. The live adapter uses the existing cookie session to call the API. The server derives the owner from the authenticated identity and the silo from the trusted request boundary, then returns at most the safe projection.

```
 signed-in browser session
          │ feature asks for personal assets
          ▼
 ┌─────────────────────────────────────┐
 │ assets/adapter  ◄── HERE              │
 │ port token + live HTTP implementation │
 └─────────────────────────────────────┘
          │ GET /me/assets (no owner or silo supplied)
          ▼
 Control Plane API → artifact catalogue authority
```

**In this flow:** [gateways](../../gateways/README.md) binds the live implementation; the server-side artifact authority owns filtering and the safe projection.

Invariant: this package can list metadata only. It must never expose content addresses, provenance, leases, receipts, outbox state, stored bytes, or any asset mutation.

## Public surface

- `PersonalAsset` — browser-safe metadata for one owner-bound asset.
- `PersonalAssetsGateway` — the read-only port a feature depends on.
- `PERSONAL_ASSETS_GATEWAY` — Angular injection token for that port.
- `OpenCranePersonalAssetsGateway` — live cookie-session implementation using the Control Plane API.

## Boundary

Consumed by frontend features through the injection token and composed by [state/gateways](../../gateways/README.md). On an API error it fails closed by rejecting the request; it has no fallback owner, cache, or fixture in production. It cannot read bytes, upload, delete, index, or otherwise mutate an asset.

## Dependency direction

Tagged `scope:web`, `layer:frontend`, and `type:lib`: it may import frontend core and browser-safe shared contracts, but never an application, UI feature, backend domain, or deployment package. The adapter depends downward on the public API; features depend upward on this port.

## See also

- Parent index: [assets](../README.md)
- Composition root: [gateways](../../gateways/README.md)
- Sibling adapter: [skills/adapter](../../skills/adapter/README.md)
