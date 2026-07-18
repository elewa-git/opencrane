# OpenClaw connection security

OpenCrane connects a signed-in browser to its personal OpenClaw runtime without placing a pod
credential in the browser. The live model combines same-origin OIDC, an identity-routing proxy,
and an owner allowlist rendered into each tenant runtime.

> See also: [Identity and connection auth](/security/identity) for the wider identity model.
> [Networking and isolation](/operators/networking) covers the cluster enforcement layers.

## Connection flow

```text
Browser
  │  wss://<org>.<base>/gateway + OIDC session cookie
  ▼
Org ingress
  ▼
Identity-routing proxy in the OpenCrane operator
  ├── validate Origin
  ├── GET /api/v1/auth/gateway-resolve with the session cookie
  ├── strip any client-supplied identity header
  └── inject the verified owner email
  ▼
Personal OpenClaw pod
  └── trusted-proxy allowUsers must contain that exact owner
```

The browser holds only its host-scoped OIDC session cookie. It never receives a pod bearer token.
The proxy holds no session store or user secret; it delegates the authorization decision to the
control plane on every WebSocket upgrade.

## Fail-closed routing

`GET /api/v1/auth/gateway-resolve` derives the runtime target from the signed-in identity. A caller
cannot supply a tenant name or pod address. The request is refused when:

- there is no authenticated session;
- the session has no verified email;
- no tenant matches that identity in the current silo;
- more than one tenant matches; or
- the org membership is suspended.

The proxy then forwards to the resolved pod Service and injects `X-Forwarded-User`. It removes any
copy of that header supplied by the browser first.

## Owner pinning

Routing and pod admission are independent checks. The operator renders the normalized tenant-owner
email into `gateway.auth.trustedProxy.allowUsers`. Even if a proxy bug sent a socket to the wrong
pod, that pod would reject the foreign identity.

```jsonc
"gateway": {
  "auth": {
    "mode": "trusted-proxy",
    "trustedProxy": {
      "userHeader": "X-Forwarded-User",
      "allowUsers": ["owner@example.com"]
    }
  }
}
```

The proxy and pod both normalize the email with `trim().toLowerCase()` so an identity-format
difference cannot produce an accidental allow or lockout.

## Cross-site WebSocket protection

WebSocket upgrades are not protected by browser CORS. The proxy therefore validates `Origin`
before it asks the control plane to resolve a target. It accepts configured vanity origins and
the platform's `https://<org>.<base>` hosts. Missing, non-HTTPS, and unrecognized origins fail
closed. An empty allowlist rejects every upgrade.

The proxy also rate-limits upgrades per resolved identity. This limits reconnect storms and keeps
one account from exhausting the proxy's socket capacity.

## Transport requirements

Production traffic must use HTTPS and WSS end to end from the browser to the ingress. The cluster
leg is constrained by NetworkPolicy and the pod's trusted-proxy source allowlist.

Operators should enforce:

- HTTP-to-HTTPS redirects at ingress;
- HSTS for the org host and subdomains;
- secure, HTTP-only, host-scoped session cookies;
- an explicit proxy-source CIDR list; and
- a TLS certificate that covers every served org or vanity host.

`GATEWAY_TRUSTED_PROXIES=auto` is opt-in convenience. It trusts the derived pod range, not one
address, and logs that widened boundary. A missing or invalid pod IP drops the token and keeps the
gateway fail-closed.

## Connection cut

The supported administrative cut is `POST /api/v1/tenants/{name}/cut`. It force-deletes the
single-user runtime pod, immediately severing its WebSockets. This is independent of whether a CNI
re-evaluates established connections after a NetworkPolicy change. The audit entry records the
tenant, result, and optional reason.

Suspending a tenant is different: it persists desired state so the reconciler keeps the runtime
scaled down. A cut terminates the current process; a suspend prevents it from returning.

## Temporary blue preflight

`POST /api/v1/auth/pod-token` remains through R9 as a compatibility-named, no-token connection
preflight for the frozen blue browser. It validates the same session, silo, tenant, membership,
and ingress-readiness rules, then returns only:

```json
{
  "gatewayUrl": "wss://acme.example.com/gateway",
  "tenant": "owner-workspace",
  "ingressHost": "acme.example.com"
}
```

Despite the route name, the response contains no token. Green surfaces must not adopt this route;
it expires when each silo moves to the new connection contract at R9.

## Trust-boundary checklist

- The browser cannot choose a tenant, pod, or upstream identity header.
- The control plane is the session and routing authority.
- The proxy is a narrow delegate-auth and forwarding boundary.
- The pod independently pins the accepted owner identity.
- NetworkPolicy limits which workloads can reach the gateway and internal listeners.
- A tenant cut deletes the runtime pod rather than relying on runtime-local revocation state.
- No durable connection credential or device registry exists in the control-plane database.
