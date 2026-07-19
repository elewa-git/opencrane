# @opencrane/backend/channel-proxy — edge channel trust boundary

Owns the logic of the public channel edge, consumed by the `apps/channel-proxy` deployable. It
holds no identity, membership, or routing policy of its own: every request is resolved through
OpenCrane's internal channel-target authority and the proxy only enforces the mechanical trust
boundary around that call.

Load-bearing exports: `__ValidateOrigin` (exact HTTPS origin allowlist bound to the Host header —
no wildcard or base-domain inference, default port only), `__HasForgedIdentityHeaders` (rejects
public identity assertions such as `x-forwarded-user` outright rather than sanitising them),
`__FixedWindowRateLimiter` (an in-memory per-replica abuse bound keyed by the authority-returned
subject — OpenCrane remains the authorization authority), `__OpenCraneTargetResolver` (workload-
authenticated client for `/api/internal/channel-targets:resolve` that re-reads the projected token
on every call so kubelet rotation needs no restart, bounds the call with its own timeout, and
fails closed on any malformed response), and `__ForwardCommand` / `__RelayEvents` (bounded JSON
command forwarding and SSE relay to the exact endpoint the authority returned, with target hosts
restricted to configured suffixes and only a response-header allowlist passed back).

Tagged `scope:channel-proxy`: it may depend only on `scope:channel-proxy` and `scope:shared`
(models, util, observability) — never on apps, server domains, or the runtimes it fronts.
