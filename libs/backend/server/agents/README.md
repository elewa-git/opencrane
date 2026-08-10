# Managed-agent server capabilities

These capabilities govern the managed-agent product plane.

- `agent-services` publishes immutable agent-service revisions, owns schedules, and enforces scope
  attach-authority + effective access.
- `scheduling` evaluates a managed-agent schedule into due runs and admits them idempotently.
- `skills` exposes a browser-safe, silo-scoped catalogue of governed skill metadata.
- `artifacts` is the finalisation authority for artifact metadata.
- `channel-targets` authorizes a channel target for a specific operation.
- `onboarding` owns the durable first-route workflow and pins exact persona and bootstrap references
  to the session-derived silo and OIDC subject.

The group may consult IAM for a proof or decision. It must not take a direct implementation
dependency on gateways or knowledge; their results enter through public contracts.

Conversation membership, message admission, canonical timeline, and display-safe replay are owned by
[`server/conversations`](../conversations/main/README.md), not by the managed-agent group.
