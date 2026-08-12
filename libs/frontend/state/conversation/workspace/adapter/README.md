# @opencrane/state/conversation/workspace/adapter — signed-in conversation API

> [frontend](../../../../README.md) › [state](../../../README.md) › [conversation](../../README.md) › [workspace](../README.md) › adapter

## What it owns

This package translates the generated signed-in conversation, onboarding, and run APIs into the
transport-neutral workspace gateway. It maps only fields the browser state needs and reduces HTTP
failures to fixed, display-safe categories.

```
 Control Plane generated client ──► OpenCraneConversationWorkspaceGateway  ◄── HERE
                                                   │ workspace models
                                                   ▼
                                        ConversationWorkspaceStore
```

**In this flow:** the generated Control Plane client · the workspace gateway port

## Public surface

- `OpenCraneConversationWorkspaceGateway` implements every workspace read and command against the
  generated client. Its onboarding read projects the existing guided exchange into a separate
  read-only result instead of pretending that it is a direct, group, or Agent-session conversation.

DTO mappers and their narrowed conversation DTO shapes are package-private. The onboarding read reuses the
onboarding state package's model-adjacent validator before reducing the valid snapshot to history. Consumers
import the gateway only from the package barrel.

## Boundary

Browser-session cookies supply identity. The adapter never accepts a subject id, email, organisation role,
or memory identity from UI code. It sends opaque conversation, participant, Agent, message, and run
coordinates only to the exact generated endpoint that accepts them. It does not read response bodies when
building errors and does not implement live streaming; the existing conversation event adapter owns that.
Completed migrated accounts with no bootstrap conversation produce `NotRecorded`, never an empty success
transcript. The adapter requests archived conversation rows so the feature can keep them in a separate list.

## Dependency direction

The package carries `scope:conversation-workspace` and `frontend-role:adapter`. It depends inward on
frontend core, conversation models, the onboarding projection validator, and the workspace state port. It
must not import a feature, element, backend package, app, or concrete conversation stream.

## See also

- Port and stores: [`workspace`](../README.md)
- Shared event adapter: [`conversation/adapter`](../../adapter/README.md)
- Generated contracts: [`libs/contracts`](../../../../../contracts/README.md)
