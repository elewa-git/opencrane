# @opencrane/backend/channel-proxy — edge trust-boundary logic

> [backend](../../README.md) › channel-proxy › main

## What it owns

This package is the brain of `channel-proxy`, the internet-facing edge service that stands between a
user's browser and OpenCrane's internal runtime. It sits on a **trust boundary**: everything arriving
from the browser is untrusted, and nothing internal is exposed directly. Its job is to let a
browser read an authorized conversation event stream without ever letting the
browser reach — or lie about — an internal address or identity.

```
 browser request  (Origin · Host · cookie/authorization)
          │
          ▼
 ┌──────────────────────────────────────────────┐
 │   channel-proxy  ◄── HERE                       │
 │   reject forged identity headers                │
 │   validate exact same-origin (HTTPS, no port)   │
 │   ask OpenCrane to resolve an authorised target │
 │   rate-limit the returned subject               │
 └──────────────────────────────────────────────┘
          │  bounded SSE relay
          ▼
 exact internal endpoint  (allowlisted host suffix, short-lived invocation context)
```

**In this flow:** OpenCrane target resolver *(the internal `/channel-targets:resolve` authority)* ·
`apps/channel-proxy` *(the deployable that wires these functions to an HTTP listener)*

The order matters and is deliberately fail-closed. First it **rejects forged identity headers** — any
`x-opencrane-user`/`-subject`/`-tenant`/`-workload` or `x-forwarded-user` is refused outright rather
than sanitised. Then it checks the request is **exactly same-origin**: the `Origin` must be in an exact
allowlist, be HTTPS on the default port with no credentials or path, and match `Host` — no wildcard or
base-domain inference. Only then does it hand the delegated browser session to OpenCrane's **target
resolver**, which returns a short-lived route (endpoint + invocation context) and a rate-limit subject.
It re-validates that route (internal `http:`, an allowlisted host suffix, no embedded credentials, not
expired) before touching it.

Forwarding is **bounded** in every dimension: the **SSE** relay (server-sent events — a long-lived stream the server pushes
events down) enforces total duration, idle-gap, and single-event byte limits, cancelling upstream the
instant the browser disconnects. Invariant: a request reaches an internal service only after it proves
same-origin, carries no forged identity, resolves to an allowlisted live target, and stays within every
bound — otherwise it gets a small non-sensitive error and nothing is forwarded.

Every `GET /v1/events` request names one opaque `conversationId`. The proxy sends only that coordinate
and its optional replay cursor to OpenCrane before it asks for a route. Message and run admission use
the product conversation API; this edge package exposes no parallel command authority.

## Public surface

- `__RelayEvents(request, dependencies)` — validate, authorise, rate-limit, then relay a bounded SSE event stream from its replay cursor.
- `__ValidateOrigin` / `__HasForgedIdentityHeaders` — the origin-policy and forged-header checks.
- `__FixedWindowRateLimiter` — a per-subject fixed-window rate limiter.
- `__OpenCraneTargetResolver` / `__CHANNEL_PROXY_TOKEN_PATH` — the workload-authenticated client for OpenCrane's target authority, and its default token path.
- `ChannelProxyConfig`, `ChannelProxyDependencies`, `ChannelTargetResolver`, `AuthorizedChannelTarget`, `DelegatedSession`, and related ports/types.

## Boundary

Consumed by `apps/channel-proxy`, which supplies the HTTP listener, config, and a `fetch` transport.
It makes no authorization decisions of its own — identity, membership, and resource/action checks are
delegated to OpenCrane via the resolver — and it never interprets the user's credentials, only forwards
them. It fails closed on every malformed authority response or target.

AG-UI projection is a shared contract owned by `@opencrane/contracts`; this proxy only relays the
already-authorised SSE bytes. It never reads canonical events or forwards raw event payloads.

## Dependency direction

Tagged `scope:channel-proxy`: it may depend only on `scope:channel-proxy` and `scope:shared` — never
on apps or sibling domains.

## Runtime & config

The resolver reads a rotating projected Kubernetes ServiceAccount token from
`__CHANNEL_PROXY_TOKEN_PATH` on every call (so kubelet rotation needs no restart) to authenticate
itself to OpenCrane. All limits, allowlisted origins, and target host suffixes come from the injected
`ChannelProxyConfig`.

## See also

- Parent index: [backend](../../README.md)
- Related: [artifacts/authorization](../../artifacts/authorization/main/README.md) *(the platform's other edge trust boundary)*
