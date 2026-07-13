# Brief for the OpenCrane team — native multi-instance (single cluster) support

**From:** WeOwnAI / Elewa platform team
**Status:** request for comment + scoping
**One-line ask:** support running **N independent, strictly-isolated OpenCrane
instances inside one Kubernetes cluster** as a first-class, documented mode —
rather than the current "one OpenCrane install owns the cluster" assumption.

This brief is self-contained; file references point into the OpenCrane repo.

---

## 1. What we're building (context)

Elewa operates a single large GKE Autopilot cluster and wants to run **many
OpenCrane instances** in it — one per customer organisation. Each instance is a
full OpenCrane (opencrane-server + operator + Postgres + its own tenant OpenClaw
pods) and must be **strictly isolated** from every other instance: no shared
data, no cross-namespace reconciliation, no shared cloud credentials.

We onboard, meter, and lifecycle these instances from our own superadmin "fleet"
plane. We treat OpenCrane as a pinned, network-/artifact-boundary dependency
(we consume the OpenAPI spec and vendor the Helm/terraform; we never fork the
application). So we want this capability **upstream and supported**, not patched
locally.

---

## 2. The good news — most of the model is already namespaced

Credit where due: the data model does not block this. We found:

- **All CRDs are `scope: Namespaced`** — `tenants`, `accesspolicies`, `mcpservers`,
  `schedules`, `skillregistries` (`platform/helm/crds/*.yaml:14` `scope: Namespaced`).
  So custom resources are already isolated per namespace; **no CR name collisions**
  across instances.
- **The operator already supports namespace-scoped watching** — `WATCH_NAMESPACE`
  (`apps/fleet-operator/src/config.ts:12`) drives `listNamespacedCustomObject` vs
  `listClusterCustomObject` (`apps/fleet-operator/src/tenants/runtime/idle-checker.ts:105-106`).
- **The opencrane-server already targets a configurable namespace** for CR writes
  (`libs/backend/tenants/main/src/routes/tenants.ts` — `process.env.NAMESPACE ?? "default"`).
- **Helm names are release-prefixed** via `opencrane.fullname`, so distinct releases
  produce distinct object names.

So the work is **not** a re-architecture. It's closing a small set of
cluster-scoped singletons and unsafe defaults.

---

## 3. The blockers (cluster-scoped singletons & unsafe defaults)

Each item: the finding, why it blocks multi-instance, and a proposed change.

### B1 — Operator RBAC is cluster-wide
- **Finding:** `platform/helm/templates/operator-rbac.yaml` emits a **ClusterRole**
  + **ClusterRoleBinding** granting `tenants/accesspolicies` + Deployments,
  Services, Secrets, Ingresses, etc. cluster-wide.
- **Why it blocks:** even with `WATCH_NAMESPACE` scoping the *watch*, the *grant*
  is cluster-wide — instance A's operator SA can read/write instance B's Secrets,
  Deployments, and Tenant CRs. That breaks isolation (and is a privilege-escalation
  path between customers).
- **Ask:** a Helm mode that emits namespaced **Role** + **RoleBinding** over only
  the instance's own namespace(s). Reserve ClusterRole for the legacy
  single-install mode.

### B2 — Default watch scope is the whole cluster
- **Finding:** `WATCH_NAMESPACE` empty ⇒ watch **all** namespaces
  (`config.ts:12` "empty string watches all namespaces").
- **Why it blocks:** an instance deployed without setting it will reconcile every
  other instance's Tenants — dueling operators.
- **Ask:** in multi-instance mode make namespace scoping **mandatory / fail-closed**
  (operator refuses to start if `WATCH_NAMESPACE` is unset), or default it to the
  operator's own namespace.

### B3 — CRDs are cluster-global and shipped per-release
- **Finding:** CRDs live in `platform/helm/crds/` (Helm installs `crds/` with the
  release). CRDs are inherently cluster-scoped objects, so all instances share one
  `tenants.opencrane.io` schema/version.
- **Why it blocks:** two Helm installs both try to own the CRDs (ownership/version
  conflict), and the fleet is coupled to a single CRD schema version — you cannot
  run two instances on CRD-incompatible OpenCrane versions at once.
- **Ask:** (a) install CRDs **once, cluster-wide**, decoupled from the per-instance
  release (documented `--skip-crds` + a separate CRD chart/step); and (b) a stated
  **fleet CRD-version compatibility contract** (which opencrane-server/operator
  versions a given CRD version supports), so we can plan rolling upgrades.

### B4 — Cluster-scoped cert + secret singletons
- **Finding:** `cluster-issuer.yaml` is a **ClusterIssuer**;
  `external-secrets-store.yaml` is a **ClusterSecretStore**.
- **Why it blocks:** these are cluster-singletons; per-instance installs collide on
  name and/or force a shared issuer/secret backend across customers.
- **Ask:** support namespaced **Issuer** and **SecretStore** per instance (or
  document a deliberately-shared "platform" issuer installed once, with per-instance
  scoping). Make it a values toggle.

### B5 — Component scope is undeclared (per-instance vs fleet-shared)
- **Finding:** the chart ships LiteLLM, feat-skill-registry, MCP gateway, external-secrets,
  cert-manager wiring (`platform/helm/templates/*`) with no explicit statement of
  which are per-instance and which are meant to be one shared cluster copy.
- **Why it blocks:** we cannot reason about isolation/cost without knowing, per
  component, whether two instances share it (and therefore share a trust/data
  boundary) or each get their own.
- **Ask:** for **each** platform component, declare and make configurable: *instance-
  scoped* (default, isolated) vs *fleet-shared* (explicit opt-in). Document the
  isolation implications of any shared component.

### B6 — Cross-instance network isolation
- **Finding:** `networkpolicy.yaml` / `networkpolicy-planes.yaml` define per-tenant
  baseline policy within an install.
- **Ask:** confirm/extend a **default-deny across instance namespaces** so instance
  A's pods can never reach instance B's services; ship it as part of multi-instance
  mode.

---

## 4. Proposed shape: a `multiInstance` Helm mode

A single values switch that flips the safe defaults, e.g.:

```yaml
multiInstance:
  enabled: true                 # turns on the isolation defaults below
  instanceNamespaces: [oc-acme] # the namespaces this instance owns
  rbac: namespaced              # Role/RoleBinding, not ClusterRole (B1)
  requireWatchNamespace: true   # operator fails closed if unscoped (B2)
  crds:
    manage: false               # CRDs installed once, cluster-wide (B3)
  certIssuer: namespaced        # Issuer, not ClusterIssuer (B4)
  secretStore: namespaced       # SecretStore, not ClusterSecretStore (B4)
sharedPlatform:                 # explicit per-component scope (B5)
  litellm: instance             # instance | shared
  skillRegistry: instance
  mcpGateway: instance
```

The legacy single-install path stays the default; multi-instance is opt-in.

---

## 5. Acceptance criteria (our Phase-1 spike, jointly)

We consider this delivered when, in one cluster:

1. Two instances (`oc-acme`, `oc-globex`) install from the same chart with distinct
   release names + `multiInstance` values, with **CRDs installed once** beforehand.
2. Each operator reconciles **only its own** namespace's Tenants (verified: create a
   Tenant in `oc-acme`; `oc-globex`'s operator never touches it).
3. `oc-acme`'s operator SA **cannot** read/write any object in `oc-globex` (RBAC
   denies it).
4. A pod in `oc-acme` **cannot** reach any service in `oc-globex` (NetworkPolicy).
5. Tearing down `oc-globex` (namespace + its GCP resources) leaves `oc-acme`
   untouched.

A reference example (Helm values + a short conformance test) shipped in the repo
would let us — and other operators — validate this on every release.

---

## 6. Division of responsibility

- **OpenCrane (this brief):** the `multiInstance` mode above — namespaced RBAC,
  fail-closed watch scoping, CRD decoupling + version contract, namespaced
  issuer/secret-store, per-component scope declaration, cross-instance default-deny,
  and the reference example.
- **WeOwnAI / Elewa:** provisioning each instance (terraform + Helm with these
  values), the fleet registry, onboarding, metering, and lifecycle. We do **not**
  need OpenCrane to manage the fleet — only to be safely installable N-times-per-cluster.

---

## 7. Open questions back to OpenCrane

- **Q1** Is anything in the opencrane-server or operator hardcoded to a fixed namespace
  or a cluster-wide list beyond what we found (e.g. cross-namespace lookups,
  cluster-scoped informers, global Postgres assumptions)?
- **Q2** Are any CRD names or API groups assumed singleton in a way that a future
  per-instance API group would break, or is "one CRD version, many instances"
  acceptable to you as the fleet contract (B3)?
- **Q3** Which components do *you* recommend sharing vs isolating (B5), from a
  cost/isolation standpoint?
- **Q4** Appetite/timeline: is `multiInstance` something you'd take upstream, or
  should we maintain it as a vendored overlay against pinned releases?
