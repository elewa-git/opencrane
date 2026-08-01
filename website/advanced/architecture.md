# Architecture

OpenCrane is a **durable authority with replaceable execution**. The system is organised
around organisation silos, immutable agent revisions and governed run attempts.

## Control and execution

```text
                    ┌──────────────────────────────────┐
                    │ OpenCrane control plane          │
                    │ identity · policy · runs · audit │
                    └───────────────┬──────────────────┘
                                    │ authorised desired state
                    ┌───────────────▼──────────────────┐
                    │ agent controller                 │
                    │ exact Kubernetes projection      │
                    └───────────────┬──────────────────┘
                                    │ fresh Job per attempt
                    ┌───────────────▼──────────────────┐
                    │ agent runtime                    │
                    │ bounded loop, no durable state   │
                    └───────────────┬──────────────────┘
                                    │ candidates
                    ┌───────────────▼──────────────────┐
                    │ governed external-action custody │
                    └──────────────────────────────────┘
```

The server admits a run and freezes its accepted inputs before Kubernetes work exists.
The controller can project only the assigned workload shape. The runtime can emit candidates,
but it cannot approve or execute external actions by itself.

## Durable run model

```text
Thread
└── AgentRun
    ├── immutable AgentRevision
    ├── one RunInputSnapshot
    ├── attempt 1..n
    ├── ordered conversation events
    ├── workload and proof evidence
    ├── approvals and action receipts
    └── terminal outcome and cost
```

Retries advance the attempt counter on the same logical run. Child runs are separate
`AgentRun` records with a durable parent reservation and bounded inherited budget.

## Isolation

One `ClusterTenant` represents one customer organisation. Its trusted server and runtime
namespaces are distinct. There is no Kubernetes user resource and no standing per-user runtime.
Personal work is bound through the admitted run's subject and immutable evidence.

## Shared services

Model routing, MCP custody, skill publication, artifacts and memory are control-plane services.
They expose narrow, authenticated boundaries and do not become alternate run or policy authorities.

→ [Governed agent runtime](/integrators/agent-runtime) ·
[Organisation boundary](/operators/organisation-boundary) ·
[Running multiple instances](/advanced/multi-instance)
