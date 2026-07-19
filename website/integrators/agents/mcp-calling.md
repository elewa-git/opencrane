# MCP calling

An MCP tool call crosses two separate gates: OpenCrane decides whether this exact action is allowed,
then Obot brokers the integration and its credentials. The model and agent runtime do neither.

> See also: [Agents overview](/integrators/agents/),
> [Obot MCP gateway](/integrators/mcp-gateway), and [Manage tools](/guide/tools).

::: info Implementation status
Obot deployment and current MCP governance are available today. The proof-bound per-run invocation
path and canonical tool-event flow below are 🔶 planned target behaviour.
:::

## One governed call

```
1. Run snapshot exposes only entitled tool descriptions to the model
2. Model emits a tool name and arguments
3. OpenCrane records ToolInvocation and validates policy, budget and argument digest
4. If required, the run pauses for an exact ApprovalRequest
5. OpenCrane issues a narrow, short-lived action capability
6. Obot validates the call, uses its custodied credential and invokes the MCP server
7. OpenCrane records progress/result events and gives the bounded result back to the model
```

The capability binds the silo, agent, run, revision, tool, normalised arguments, expiry, proof and
replay state. A mutating call is one-shot or explicitly idempotent; a retry cannot silently repeat a
side effect.

## Visibility is not authorisation

Filtering the model's tool list reduces mistakes and wasted tokens, but prompt injection can still
make a model request anything. Every call therefore passes the server-side grant, policy, approval,
budget and replay checks even if the tool appeared in the prompt.

Likewise, network reachability to Obot is not permission. The action capability and Obot's own PEP
enforce the call; Cilium limits which workload may reach that enforcement point.

## Credential custody stays with Obot

Provider and user integration credentials do not enter the prompt, browser, agent runtime, or
sandbox. Obot holds them and uses them only for an authorised invocation. OpenSandbox is not used
for MCP calls and does not replace Obot's credential role.

## Tool events stay canonical

The runtime adapter translates tool activity into stable events such as `tool.requested`,
`tool.approval_required`, `tool.started`, `tool.progress` and `tool.completed`. OpenCrane persists
each event before the UI sees it. Obot logs and upstream responses are evidence inputs, not a second
tool history.

For catalogue installation, Obot deployment and credential encryption, use the
[MCP gateway deep dive](/integrators/mcp-gateway). For access grants, use
[Control who can access what](/guide/permissions).
