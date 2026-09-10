# Conversation activity feature

> [frontend](../../README.md) › [features](../README.md) › conversation activity

## What it owns

This package renders the derived Activity index and emits canonical transcript deep links. Failed
tool attempts stay visible even while retrying; bounded technical fields are available only after
the participant opens the disclosure.
Personal-work rows show the public run state as Accepted, Queued, Preparing, Working, Waiting for
input, Needs attention, Completed or Failed. **Open answer** requires an explicit target supplied
by the workspace. Loading, refreshing, empty and failed reads are separate from those run states;
the feature forwards a refresh intent and never retries execution.
When the latest tool phase is available, a separate chip says **Tool queued**, **Tool running**,
**Tool result received** or **Tool needs attention**. Receiving a tool result does not mark the
assistant work complete or create an answer link. These rows expose no tool name, input, result
content or execution controls; a null phase adds no chip.

```
 canonical references + safe failure fields
                    │
                    ▼
               Activity list
        visible failure + retry state
        optional Technical details
                    │ deep-link intent
                    ▼
              workspace page
```

In this flow: [`state/conversation/elicitation`](../../state/conversation/elicitation/README.md)
derives request and tool rows without copying conversation messages. The workspace feature maps
personal work and checks answer targets against its current rendered history.

## Public surface

`ConversationActivityComponent` renders browser-safe rows and accepts one named header-action slot so
the owning workspace can supply a close control without moving panel visibility into this component.

- `ConversationActivityComponent` renders ordered safe rows and emits exact canonical coordinates.

## Boundary

The feature receives already-safe fields. It never renders provider bodies, credentials, request
headers, datasets, or secret material, and it owns no routing or API access.

## Dependency direction

The feature depends inward on the elicitation state row contract. The workspace may compose it;
this package imports no sibling feature, app, backend, or transport.

## See also

- Parent index: [`libs/frontend/features`](../README.md)
- Elicitation card: [`features/conversation-elicitation`](../conversation-elicitation/README.md)
