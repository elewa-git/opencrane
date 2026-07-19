# Trust boundaries & the network

Where OpenCrane draws its security lines, and how the network enforces them. The
previous pages introduced [capabilities](/security-architecture/capabilities) and
[workload identity](/security-architecture/workload-identity); this page shows
the four places those mechanisms meet untrusted input — and the default-deny
network that guarantees nothing bypasses them.

## What a trust boundary is

A **trust boundary** is a line where the level of trust changes: on one side,
input is unverified; on the other, it has been checked and may be acted on. Good
boundaries share a design rule: the component *at* the boundary should be so
simple, and so powerless, that compromising it wins an attacker as little as
possible.

OpenCrane has four:

```
                     1. channel-proxy        the outside world meets the platform
 untrusted ──────▶   2. artifact-service     uploaded bytes meet durable storage
   input             3. agent-controller     server decisions meet Kubernetes
                     4. agent-runtime        agent code meets… nothing (by design)
```

Everything inside the boundaries — the OpenCrane server and Postgres — only ever
sees input that crossed one of these four checkpoints.

## 1. Channel proxy: the edge

The channel proxy terminates untrusted client connections — browsers, apps,
integrations — and relays them to the server. It exposes exactly two endpoints:
a command endpoint (send something) and an event-stream endpoint (receive the
run's events). Everything else is 404.

Its defining property is that **it makes no product decisions**. For every
request it:

- validates the request's **origin** against an exact HTTPS allowlist (no
  wildcards, no port or path tricks, origin must match the host);
- rejects any request carrying **forged identity headers** — a client that
  presents `x-opencrane-user` or similar is refused outright, because only the
  platform may assert identity;
- asks the server to resolve the target: it forwards the user's own credential
  and authenticates *itself* with its audience-bound workload token. The server
  answers with either a short-lived, exact target to relay to — or a refusal;
- **rate-limits** per authenticated subject (as identified by the server, never
  by anything the client claimed);
- relays the canonical stream with hard bounds: body size caps, connect
  timeouts, stream duration and idle limits.

The proxy is stateless — no database, no policy cache to go stale, no Kubernetes
permissions, no persistent volume. Compromise the edge and you hold a component
that can only ask the server questions the server was going to answer anyway.

## 2. Artifact service: leased writes

The artifact service guards the platform's file store. Bytes get in only through
one door, and the door checks three things:

1. **A signed write lease.** The server issues a short-lived lease for one
   specific upload — its expected content digest, maximum byte length, media
   type, and expiry — signed with the server's key. The artifact service
   verifies the signature with the server's public key. No lease, no write; and
   the lease authorises exactly one artifact's exact bytes.
2. **Bounds enforced while streaming.** The upload is refused the moment it
   exceeds the leased byte length, and the whole exchange has an absolute
   deadline capped by the lease expiry — a slow upload cannot hold resources
   past its authorisation.
3. **Content-addressed promotion.** The service hashes what actually arrived,
   verifies it against the leased digest, and only then publishes the bytes at
   their content address (the address *is* the hash of the bytes — verified,
   not asserted). It answers with a **signed receipt** — the only evidence the
   server accepts to finalise the artifact record.

The workload itself holds no Kubernetes RBAC and no automounted token; its
network policy admits only the server as a client. Note the deliberate asymmetry
with the other internal APIs: authorisation here travels *in the request* (a
signature to verify) rather than *with the caller* (a token to review) — the
artifact service never needs to ask Kubernetes anything.

## 3. Agent controller: decisions meet Kubernetes

The controller is the third boundary: the only place where the server's
decisions become real Kubernetes objects. Its mechanics — claim, create
suspended, acknowledge, unsuspend — are covered in
[Workload identity](/security-architecture/workload-identity#the-controller-one-mutator-no-judgement);
what matters here is the boundary shape:

- Inbound, it accepts **no traffic at all** (its network policy allows no
  incoming connections — health probes come from Kubernetes itself, not over
  the network).
- Outbound, it may reach exactly two things: the Kubernetes API and the server's
  internal port.
- Everything it learns from the server it re-validates against its own pinned
  policy (exact namespace, ServiceAccount, image) before acting — a compromised
  server cannot use the controller to schedule an arbitrary image.

## 4. Agent runtime: the inert boundary

The runtime is where the least-trusted code of all — the agent's own reasoning
and tool use — executes. Its boundary is the strangest of the four because it is
defined by absence:

- zero Kubernetes RBAC, no automounted token;
- deny-all ingress (no incoming connections); egress (outgoing connections) to
  DNS and telemetry only;
- **no network path to the server, the database, or the artifact store** — in
  the current phase the runtime cannot open a connection to any of them
  (the proof-bound bootstrap listener arrives in a later phase, as its own
  dedicated door);
- created per run as a **suspended Job** with no retries, a read-only root
  filesystem, dropped capabilities, and scratch space that dies with the Pod.

An attacker who fully controls the runtime holds a process with nothing to
steal, nowhere to go, and an identity every verifier was built to distrust.

## The network: default-deny, twice

Boundaries are only as good as the network's willingness to enforce them. Two
layers do:

**Kubernetes NetworkPolicies** provide the floor: platform namespaces carry
default-deny policies, and each app ships its own precise allow rules
(exactly the flows described above — nothing more). The broad platform-wide
policies deliberately *exclude* the four boundary workloads: each carries only
its own precise policy, so a platform-wide allow rule can never quietly add a
flow to a boundary workload.

**Cilium policies bind flows to identity.**
[Cilium](https://github.com/italanta/opencrane/blob/main/apps/_infra/cilium/README.md)
is the cluster's network layer — and unlike a plain firewall, it can tell *who*
a connection comes from.
That matters because Kubernetes **labels** (the free-form name tags on Pods,
editable by anyone who can edit the Pod) are how ordinary network policies
select traffic — and labels can be copied. A ServiceAccount cannot. Each
boundary workload therefore carries an additional Cilium policy that selects on
the workload's **ServiceAccount identity**, so "may talk to the server" means
*this identity* may — a Pod that merely copies the right labels matches
nothing. A contract test asserts every boundary workload has an identity-bound
policy, and a live probe proves an identical-but-unlabelled client is actually
dropped on the wire.

The result, end to end: every arrow in the topology diagram on the
[overview page](/security-architecture/) exists because a policy explicitly
allows it, is pinned to a Kubernetes-issued identity, and is re-authorised at the
application layer on every request.

> **See also:** [Data authority](/security-architecture/data-authority) — the
> stores these boundaries protect, and the database-level guards behind them.
