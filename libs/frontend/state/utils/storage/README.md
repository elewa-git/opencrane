# @opencrane/state/utils/storage — safe browser-storage seam

> [frontend](../../../README.md) › [state](../../README.md) › utils › storage

## What it owns

Part of the OpenCrane **frontend state layer** (the code between the browser UI and the backend). The
browser offers `localStorage` and `sessionStorage` for saving small key-value data, but touching them
directly is risky: they throw or are missing during server-side rendering, in private-browsing mode,
or in a desktop build. This package owns the **platform seam** that hides that: a tiny `StorageGateway`
interface plus a safe web adapter, so any state package can persist data without coupling to the native
APIs.

`StorageGateway` is a three-method interface (`getItem`/`setItem`/`removeItem`). Two dependency-injection
tokens name the two scopes — `LOCAL_STORAGE_GATEWAY` (persists across sessions) and
`SESSION_STORAGE_GATEWAY` (cleared when the tab closes). The web adapter wraps the matching native
store and **degrades to a no-op** whenever the store is unavailable or throws, so callers never need a
`try/catch`.

Invariant: storage failures are swallowed by design — a read returns `null`, a write does nothing.
Callers (such as [`onboarding`](../../onboarding/README.md)) rely on this to treat persistence as
best-effort rather than load-bearing.

## Public surface

- `StorageGateway` — the synchronous key-value storage interface.
- `LOCAL_STORAGE_GATEWAY`, `SESSION_STORAGE_GATEWAY` — the DI tokens for the two scopes.
- `WebLocalStorageAdapter`, `WebSessionStorageAdapter` — the safe, no-op-degrading web implementations.

## Boundary

Consumed by `apps/opencrane-ui` (which binds the tokens to the web adapters) and by state packages that
persist data (`onboarding`). It provides the storage abstraction only — it makes no HTTP calls and
holds no application state itself.

## Dependency direction

Tagged `scope:web` (`type:state`): it may depend only on other `scope:web` and `scope:shared`
packages — here just Angular — never on apps or server domains.

## See also

- Parent index: [state](../../README.md)
- Siblings: [onboarding](../../onboarding/README.md) · [core](../../core/README.md)
