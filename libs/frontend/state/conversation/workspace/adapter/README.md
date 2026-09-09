# @opencrane/state/conversation/workspace/adapter — signed-in conversation API

> [frontend](../../../../README.md) › [state](../../../README.md) › [conversation](../../README.md) › [workspace](../README.md) › adapter

## What it owns

This package translates the generated signed-in conversation, onboarding, and company-assistant APIs into the
transport-neutral workspace gateway. It maps only fields the browser state needs, reduces HTTP
failures to fixed display-safe categories, and submits ordinary participant messages through the generated HTTP client.

```
 Control Plane generated client ──► workspace gateway  ◄── HERE
                                        │ workspace models
                                           ▼
                                ConversationWorkspaceStore
```

**In this flow:** the generated Control Plane client · the workspace gateway port

## Public surface

- `OpenCraneConversationWorkspaceGateway` uses the generated client for workspace reads and lifecycle
  commands and ordinary participant messages. Its onboarding read
  projects the existing guided exchange into a separate read-only result instead of pretending that it
  is a direct, group, or Agent-session conversation.

DTO mappers and their narrowed conversation DTO shapes are package-private. The onboarding read reuses the
user-onboarding model package's validator before reducing the valid snapshot to history. Consumers
import the gateway only from the package barrel.

## Boundary

Browser-session cookies supply identity. The adapter never accepts a subject id, email, organisation role,
or memory identity from UI code. It sends opaque conversation, participant, Agent, message, and run
coordinates only to the exact generated endpoint that accepts them. It does not read response bodies when
building errors and does not own the live history connection; the separate conversation event adapter owns streaming.
The same generated-client adapter implements the narrow computer-review port without releasing sandbox
network coordinates or lease credentials to the browser.
It also implements `ConversationPersonalRunsGateway` through `GET /me/runs`. The model-adjacent
validator rejects unknown run or tool phases, private tool fields, malformed timestamps,
duplicate rows and oversized lists before
the selected-chat store adopts them. The existing cookie supplies identity and an AbortSignal
cancels obsolete reads; response bodies never become error copy.
The same adapter implements the group-child port. Child reads and creation responses must match the
requested parent and source; shares forward the reviewed text and UUID unchanged and accept only a
validated accepted/idempotent acknowledgement. Every request carries the existing session cookie
and selection AbortSignal. Directory company assistants contain only service IDs and display names.
Personal-session creation forwards the store's UUID unchanged, allowing the server to distinguish a
retry from a request for another session.
Completed migrated accounts with no bootstrap conversation produce `NotRecorded`, never an empty success
transcript. The adapter requests archived conversation rows so the feature can keep them in a separate list.

## Dependency direction

The package carries `scope:conversation-workspace` and `frontend-role:adapter`. It depends inward on
frontend core, conversation and user-onboarding models, and the workspace state port. It
must not import a feature, element, backend package, app, or concrete conversation stream.

## See also

- Port and stores: [`workspace`](../README.md)
- Shared event adapter: [`conversation/adapter`](../../adapter/README.md)
- Generated contracts: [`libs/contracts`](../../../../../contracts/README.md)
