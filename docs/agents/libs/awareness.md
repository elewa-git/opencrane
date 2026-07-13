# Lib: awareness (`@opencrane/awareness`)

> Deep-dive for `libs/awareness`. Index: [`../app-specific.md`](../app-specific.md).

The awareness **contract-version module** used by the opencrane-server. Org-context RETRIEVAL is no
longer in this package — it moved to the official `@cognee/cognee-openclaw` OpenClaw plugin
(installed into each tenant pod; see `apps/opencrane/src/tenants/deploy/2-config-map.ts`
`plugins` render). The bespoke in-pod retrieval client, citation builder, and golden-suite eval were
removed when that plugin was adopted.

## Contract version (`src/contract-version.ts`)

`AWARENESS_CONTRACT_VERSION` (e.g. `awareness/v1alpha1`) is stamped onto the tenant runtime contract
(`2-config-map.ts` `memory.contractVersion`) and drives the opencrane-server's awareness rollout/canary
machinery (`libs/backend/awareness/main/src/routes/awareness-rollout.ts`).
`___AssertContractCompatible(peer)` / `___IsContractCompatible(peer)` throw / report on a **major**
version mismatch — retained for the rollout machinery to gate on (there is no longer a pod-side SDK
that self-enforces it).

## Data flow

[`feat-central-agents`](../apps/feat-central-agents.md) ingests org sources → Cognee. The opencrane-server
governs grants, dataset membership, and rollout/contract versioning. Per-turn retrieval is the Cognee
plugin's job (auto-recall + the `cognee_memories` tool), scoped by the Cognee-side permission ACL the
opencrane-server syncs.
