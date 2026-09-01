# ConversationComputer bootstrap client

> [agent-runtime](../../README.md) › conversation-computer

## What it owns

This package reads the immutable Agent Sandbox bootstrap files and exchanges the Pod's projected
Kubernetes token for server-derived ConversationComputer execution coordinates. It gives the later
agent loop no way to select its own conversation, execution, or lease generation.

```
immutable ConfigMap + Downward label + projected token
                         │
                         ▼
        conversation-computer bootstrap client ◄── HERE
                         │ checked Pod identity
                         ▼
          server-derived computer execution
```

**In this flow:** [agent runtime](../../README.md) · [Agent Sandbox chart](../../../_infra/agent-sandbox/README.md)

The client denies malformed mounted contracts, denied tokens, and malformed responses. It preserves
no credential or lease state, and it neither starts a model loop nor authorises a product action.

## Public surface

- `read_bootstrap_settings` validates the three mounted bootstrap inputs.
- `bootstrap_execution` requests and validates the single fenced execution response.
- `run` retries only unavailable bootstrap transport, then hands the checked execution once to a
  separately composed product-loop adapter.

## Boundary

The server remains the execution authority. This client does not open a command stream, read
conversation history, or execute an external tool.

## See also

- Parent: [agent runtime](../../README.md)
- Release contract: [Agent Sandbox chart](../../../_infra/agent-sandbox/README.md)
