# Identity & network isolation (Cilium + SPIFFE)

Every workload and every person on the platform has a **cryptographic identity**, and
**every network decision is made on that identity — never on an IP address**. This is
what keeps one customer's silo sealed off from every other, and it is the single idea
behind all the rules on this page.

> See also:
> [Networking & isolation](/operators/networking) — the two-plane cluster model and the public edge this identity layer sits behind; read that first for the overall shape.
> [Identity & connection auth](/security/identity) — how a person signs in (Zitadel OIDC) and reaches their own assistant.
> [Silo deployment model](/operators/silo-deployment) — how each customer's silo is installed as its own release.
> [ADR 0003 — Cilium + SPIFFE identity substrate](https://github.com/elewa-git/opencrane/blob/main/docs/adr/0003-cilium-spiffe-identity-substrate.md) — the decision behind this model, and why it supersedes the earlier Linkerd choice.

---

## Two kinds of identity

There are exactly two kinds of principal on the platform, and each carries a
cryptographic identity that the network can check.

| Principal | Identity | Issued by | Used for |
|-----------|----------|-----------|----------|
| **A person** (owner, admin, member) | Zitadel **OIDC** session, scoped to their org | Zitadel (one org per customer) | Signing in to the control plane and reaching their own assistant |
| **A workload** (control plane, operator, LiteLLM, Obot, Cognee, an assistant pod) | **SPIFFE SVID** — `spiffe://opencrane/ct/<org>/<workload>` | SPIRE, from the pod's Kubernetes ServiceAccount | Proving *which workload* is calling, over mutual TLS |

People and workloads meet only at the control plane, and only over an OIDC-guarded
hop. A person never gets a workload identity, and a workload never gets a browser
credential.

::: tip Why identity, not IP
Pods come and go; IP addresses churn and can be reused. A SPIFFE identity is bound to
the workload's ServiceAccount, is short-lived, and rotates automatically — so a rule
written against it keeps meaning the same thing no matter where the pod lands.
:::

---

## One rule: default-deny, opened by identity

Each customer org is a **silo** — its own namespace, its own runtime planes. The rule
in every silo is the same: **deny everything, then re-open only for named identities.**

```
┌───────────────────────────────────────────────────────────────┐
│  SILO  (org "acme")                                            │
│                                                                │
│   default: DENY all traffic, in and out                        │
│                                                                │
│   allow ▸ acme workloads  ⇄  acme workloads     (same silo)    │
│   allow ▸ super-admin identity  →  acme         (control plane) │
│   allow ▸ acme workloads  →  DNS                               │
│   allow ▸ acme workloads  →  approved hostnames only  (egress) │
│                                                                │
│   there is NO rule that names another silo — so:               │
│        acme  ✗  bravo         bravo  ✗  acme                    │
└───────────────────────────────────────────────────────────────┘
```

Because no rule ever names another silo, **there is no silo-to-silo path to exploit** —
cross-silo traffic isn't blocked by a clever filter, it simply has nothing that permits
it. The only identity admitted into a silo from outside is the **super-admin**
(the control plane / operator), which brokers the person's connection to their pod.

---

## Who can talk to whom

These are the network-level authorisation rules, expressed as `CiliumNetworkPolicy` and
keyed on workload identity. Every allow below is an identity match; everything not
listed is denied.

| From (identity) | To (identity) | Allowed? | Why |
|-----------------|---------------|----------|-----|
| An assistant pod in silo *acme* | Another pod in silo *acme* | ✅ | Intra-silo — one org's workloads collaborate |
| An assistant pod in silo *acme* | A pod in silo *bravo* | ❌ | No rule names another silo — cross-silo is impossible |
| The super-admin (control plane / operator) | Any silo | ✅ | The only cross-silo identity; it brokers connections and reconciles the silo |
| Any silo | The super-admin control plane | ✅, `/api/*` only | Silos re-pull their effective contract and mint model keys |
| An assistant pod | LiteLLM / Obot / Cognee **in its own silo** | ✅ | The runtime planes are dedicated per silo |
| An assistant pod | An external hostname **on the egress allow-list** | ✅ | e.g. the model provider — see [egress](#egress-is-an-allow-list-too) |
| An assistant pod | Any other external hostname | ❌ | Egress is default-deny by hostname |
| A browser | An assistant pod directly | ❌ | Browsers never reach a pod directly — only through the identity-routing proxy ([connection auth](/security/identity)) |

---

## How a workload gets its identity

The chain is automatic — no secrets to distribute, nothing for an operator to rotate by
hand.

```
Kubernetes ServiceAccount           the pod's declared identity
        │
        ▼
SPIRE issues a SPIFFE SVID          spiffe://opencrane/ct/acme/openclaw
        │  (short-lived, auto-rotating X.509)
        ▼
Cilium mutual authentication        every silo-to-silo call is mTLS,
        │                           proven on both ends by SVID
        ▼
CiliumNetworkPolicy decision        allow / deny keyed on the SVID identity
```

Each workload's SVID is derived from its ServiceAccount, so "who is calling" is a
cryptographic fact, not a header a caller can spoof. Calls between workloads are wrapped
in mutual TLS, so both ends prove their identity before a byte of application data flows.

---

## The super-admin is the only cross-silo identity

The control plane and operator run as the **super-admin** identity — and it is the
*only* principal that may cross a silo boundary. It uses that reach to broker a person's
connection to their own assistant and to reconcile the silo's resources. Nothing else —
no assistant, no plane, no person — can address a workload in a silo it doesn't belong
to.

That makes the super-admin's identity the **crown jewel**: its issuance, rotation, and
audit are the most load-bearing security tasks on the platform. Every other identity is
scoped to a single silo by construction.

---

## Egress is an allow-list too

Isolation isn't only about east-west (silo-to-silo) traffic — it also bounds what a silo
can reach on the **outside**. Egress is default-deny by hostname: a silo can resolve DNS
and reach only the external endpoints on its allow-list.

```
assistant pod ──► DNS (cluster)                         ✅ always
assistant pod ──► api.openai.com (approved provider)    ✅ on the allow-list
assistant pod ──► anything else on the internet         ✗ denied
```

`CiliumNetworkPolicy` `toFQDN` rules express this per silo, so a compromised assistant
cannot exfiltrate to an arbitrary host — it can only reach the model and tool endpoints
the org has approved.

---

## Three layers, all keyed on identity

The isolation is defence-in-depth: a connection between two silos has to defeat **all
three** layers, and each is keyed on the same workload identity.

| Layer | What it does | Cross-silo verdict |
|-------|--------------|--------------------|
| **L3/L4 — CiliumNetworkPolicy** | Packet-level allow-list, keyed on Cilium security identity | Drops the packet — the source identity isn't in any allow rule |
| **L7 — CiliumNetworkPolicy (per-route)** | Which identities may call which routes/methods | Rejects the request — the caller identity isn't authorised for that route |
| **mTLS — SPIFFE mutual auth** | Both ends prove their SVID before data flows | Fails the handshake — no trusted SVID for a foreign silo |

A gap in any one layer doesn't open the silo, because the other two still have to pass.
And because all three read the same identity, they can't disagree about *who* the caller
is.

::: info The floor never disappears
The portable, standard-`NetworkPolicy` default-deny floor from the silo baseline stays
in place underneath — Cilium enforces it too. The identity layers add to it; they never
relax it.
:::

---

## See also

- [Networking & isolation](/operators/networking) — the public edge, the two planes, and how the silo baseline composes with these identity rules
- [Identity & connection auth](/security/identity) — how a person authenticates (Zitadel OIDC) and reaches their own assistant with no browser-held pod credential
- [Silo IAM: inheritance & sharing](/integrators/silo-iam) — how a person's org-scoped identity flows into what their assistant may retrieve and act on
- [ADR 0003 — Cilium + SPIFFE identity substrate](https://github.com/elewa-git/opencrane/blob/main/docs/adr/0003-cilium-spiffe-identity-substrate.md) — the substrate decision and why it supersedes ADR 0001 (Linkerd)
