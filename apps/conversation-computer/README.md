# conversation-computer — leased computer process boundary

> [apps](../README.md) › conversation-computer

## What it owns

This app is the image boundary for one 0.11 conversation computer. Kubernetes Agent Sandbox starts
the image from a release-owned profile after OpenCrane admits a generation-bound computer lease.

```text
 KurrentDB lease event ──► SandboxClaim ──► conversation-computer ◄── HERE
                                                  │
                                                  ├── health and readiness
                                                  └── future exec, browser and preview children
```

**In this flow:** [opencrane](../opencrane/README.md) admits the lease, while
[agent-sandbox](../_infra/agent-sandbox/README.md) fixes the image and confinement profile.

The process refuses readiness unless it receives the computer id, lease id, computer generation and
KurrentDB endpoint. Those coordinates are configuration seams only; this first image does not claim
that it can execute an agent or mutate history.

## Public surface

Entrypoint: `python3 -m src.main` serves `/healthz` and `/readyz` on port 8080.

## Boundary

This app does not implement the retired AgentRun HTTP/server-sent event protocol, warm reservations,
or continuation checkpoints. It also does not yet provide the identity-aware gateway, agent model
loop, `execd`, browser/Chrome DevTools Protocol, noVNC, file review or localhost preview proxy. Those
processes must be added behind the same lease-generation fence; none may become an unauthenticated
port exposed directly outside the sandbox.

## Dependency direction

This is a thin app entrypoint (`type:app`, `scope:conversation-computer`). It imports no other app and
holds no product authorization or lifecycle authority.

## Runtime & config

The image runs as uid/gid 65532 with no writable application files. Readiness requires
`OPENCRANE_COMPUTER_ID`, `OPENCRANE_COMPUTER_GENERATION`, `OPENCRANE_COMPUTER_LEASE_ID`, and
`OPENCRANE_HISTORY_STORE_ENDPOINT`. `OPENCRANE_COMPUTER_HEALTH_PORT` defaults to `8080`.

## See also

- Parent index: [apps](../README.md)
- Sandbox profile: [agent-sandbox](../_infra/agent-sandbox/README.md)
- Server composition: [opencrane](../opencrane/README.md)
