# @opencrane/backend/server/infra/conversation-computer-host — workstation process ownership

> [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › conversation-computer-host

## What it owns

This server-infrastructure library runs a conversation computer as a child process on a developer's
workstation. Tier 2 composes it behind the same realization-neutral conversation lease used in
production, while keeping workstation mechanics outside the conversations domain and app entrypoint.

The app first supplies the exact executable, arguments, working directory, and loopback server
endpoint. This package then creates a private bearer, starts the child with a constrained environment,
waits for its startup marker, and hands non-secret process coordinates back to the app's domain bridge.
It later authenticates, renews, or stops that exact process when the conversations authority requests it.

```text
 conversations lease ──► OpenCrane realization bridge
                              │ launch specification + lease fence
                              ▼
                    ┌──────────────────────────────┐
                    │ conversation-computer-host  │ ◄── HERE
                    └──────────────────────────────┘
                              │ private bearer + child environment
                              ▼
                    conversation-computer entrypoint
```

**In this flow:** [conversations](../../conversations/main/README.md),
[OpenCrane server](../../../../../apps/opencrane/README.md), and the
[conversation-computer entrypoint](../../../../../apps/conversation-computer/README.md).

The invariant is that every operation matches the computer, lease, generation, endpoint, and process
identifier recorded by its caller. Missing or mismatched evidence returns absent; startup failure,
lease expiry, explicit release, and owner shutdown revoke the bearer and remove the temporary directory.

## Public surface

- `HostConversationComputerProcessOwner` owns process startup, authentication, renewal, release, and cleanup.
- `HostConversationComputerLaunchSpecification` carries the app-owned executable contract.
- The exported reservation, coordinate, command, status, and identity types keep caller integration explicit.

## Boundary

The OpenCrane app is the sole consumer and maps this process seam to conversations-domain realization
contracts. The library persists no product state and does not choose an app entrypoint. It provides no
Kubernetes TokenReview, RuntimeClass, NetworkPolicy, resource ceiling, review gateway, or durable
workspace checkpoint; production owns those guarantees through Agent Sandbox.

## Dependency direction

This `scope:conversation-computer-host`, `layer:infra` library may depend only on its own scope and
shared contracts. It never imports an app or a backend business-domain implementation.

## Runtime & config

The composing app supplies a fixed child command and an IPv4 loopback endpoint. The owner passes only
the small operating-system environment needed to locate executables and load Python, adds its private
lease variables, uses owner-only permissions for bearer files, and falls back from graceful termination
to a bounded forced stop when a child does not exit.

## See also

- Parent index: [server infrastructure](../README.md)
- Production realization: [Agent Sandbox adapter](../agent-sandbox/README.md)
- Developer workflow: [local development](../../../../../website/contributing/local-development.md)
