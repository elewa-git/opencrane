# Architecture decision records

Long-lived design decisions for the OpenCrane platform. An ADR records why a decision exists, the
alternatives considered, and the consequences accepted.

Reader-facing operator and integrator documentation lives in [`website/`](../../website). An ADR may
ground a published page, but it is not itself published.

| ADR | Title | Status |
|-----|-------|--------|
| [0002](0002-per-clustertenant-silo-architecture.md) | Per-ClusterTenant silo architecture | Accepted |
| [0003](0003-cilium-spiffe-identity-substrate.md) | Cilium identity and network-policy substrate | Accepted |
| [0005](0005-opencrane-owned-agent-runtime.md) | OpenCrane-owned agent runtime | Accepted; runtime-language clause superseded by 0010 |
| [0008](0008-target-agent-contracts-and-workload-identity.md) | Agent contracts and workload identity | Accepted; clarified by 0011; universal `Thread` clause superseded by 0012 |
| [0010](0010-language-neutral-agent-runtime.md) | Language-neutral agent runtime | Accepted |
| [0011](0011-single-run-input-and-artifact-read-authorities.md) | Single run-input and artifact-read authorities | Accepted |
| [0012](0012-conversation-modes-and-agent-thread-authority.md) | Conversation modes and Agent-thread authority | Accepted |
| [0013](0013-workflow-control-plane.md) | Workflow control-plane operations | Accepted |
| [0014](0014-claimed-warm-runtime-pool.md) | Claimed warm runtime pool | Accepted |

## Writing a new ADR

- Number sequentially (`NNNN-short-slug.md`); do not reuse or renumber an accepted identifier.
- Use the shape **Status · Context · Decision · Alternatives considered · Consequences**.
- Record a durable outcome. Work sequencing, qualification logs, and temporary investigation notes
  belong in plans, tests, release notes, or issue evidence.
- When a durable decision changes, add an ADR that names the exact clause it supersedes. Remove
  transformation-only records once they no longer describe a supported contract; version control
  retains their history.
