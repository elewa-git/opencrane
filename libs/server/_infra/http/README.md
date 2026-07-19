# @opencrane/server/_infra/http — Express transport plumbing

HTTP mechanics owned by the OpenCrane server process: the global error handler, the
`/healthz` database probe (`SELECT 1` → 200 ok / 503 degraded, shared by the fleet registry
and each silo's database), the per-IP rate limiter, transport-security middleware (HSTS on
secure responses, with an opt-in `OPENCRANE_FORCE_HTTPS` redirect for safe methods only), the
trusted-proxy allowlist parser, and the public OpenAPI route.

The trusted-proxy parser is deliberately fail-closed because the allowlist is a security
boundary: an empty `GATEWAY_TRUSTED_PROXIES` means trust nothing (never trust-all), and a
malformed CIDR throws at config load rather than silently widening trust.

Helpers accept their required contracts as parameters — a `$queryRaw`-shaped probe, a parsed
spec — so this package never imports an application-owned Prisma client or API specification.
Its only consumer is the `apps/opencrane` server; it mounts these handlers, this package
defines no routes of its own beyond the handlers it exports.

Tagged `type:lib`, `layer:infra`, `scope:http`: it may depend only on `scope:http` and
`scope:shared` — never on backend domains, apps, or sibling `_infra` packages.
