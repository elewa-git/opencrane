# @opencrane/state/utils/storage — safe browser storage gateway

Owns the `StorageGateway` abstraction over native browser storage: the
`LOCAL_STORAGE_GATEWAY` and `SESSION_STORAGE_GATEWAY` injection tokens plus the web adapter
that wraps `localStorage`/`sessionStorage` and degrades every operation to a safe no-op (or
`null` read) when the native store is unavailable or throws — SSR, private browsing, or a
locked-down runtime.

The invariant it carries: no feature or state lib touches `window.localStorage` directly, so
persistence is swappable per platform and storage failure can never crash a flow — callers
must treat persisted state as best-effort.

Consumed by `apps/opencrane-ui` (which provides the adapters) and
`@opencrane/state/onboarding`. Tagged `scope:web`/`type:state`: may depend only on
`scope:web` and `scope:shared` libs — never on backend packages or apps.
