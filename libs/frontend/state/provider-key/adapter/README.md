# @opencrane/state/provider-key/adapter — BYOK provider-key gateway

Owns the `ProviderKeyGateway` port and its live implementation,
`OpenCraneProviderKeyGateway`, over the Control Plane's `/providers/byok` and
`/providers/byok/{provider}` endpoints (typed GET/PUT/DELETE via the shared
`ControlPlaneApiService`, generated from the pinned contract). Responses map onto the
`ProviderKeyStatus` read model: which providers have a key configured in this silo and whether
LiteLLM accepted it on its dynamic path.

Key material is write-only — a key is PUT and never read back; only status ever crosses the
wire to the UI. WeOwnAI never imports OpenCrane source; this network contract is the only
coupling.

Consumed by `@opencrane/features/tools` (the model-keys admin screen); bound to
`PROVIDER_KEY_GATEWAY` by `@opencrane/state/gateways`. Tagged `scope:web`/`type:state`: may
depend only on `scope:web` and `scope:shared` libs — never on backend packages or apps.
