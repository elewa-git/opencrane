# Channel proxy

`apps/channel-proxy` owns OpenCrane's inbound channel trust boundary — the process that terminates
untrusted client connections and relays them to the OpenCrane server. It is a separate app precisely
because it faces the outside: it makes no product decisions of its own, so a compromise at the edge
cannot authorize anything.

The proxy validates the request origin, rejects forged workload-identity headers, and rate-limits
per subject before any relay. It never decides who may talk to whom: it resolves each request's
target by calling OpenCrane's internal resolver with its own audience-bound workload token, and
OpenCrane returns the authorized session or denies it. The proxy then forwards the command or relays
the event stream on that decision. Reusable behaviour lives in `libs/backend/channel-proxy/main`
(origin policy, rate limiter, target resolver, forwarding); this app is only the deployable shell
and HTTP transport.

The workload is stateless — one Deployment per silo, no persistent volume, no Kubernetes RBAC, and a
NetworkPolicy that admits inbound client traffic and permits egress only to the OpenCrane server and
DNS. Session and membership authority stay in OpenCrane; there is no local policy cache to drift.
