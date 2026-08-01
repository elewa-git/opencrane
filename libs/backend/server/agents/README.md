# Managed-agent server capabilities

These capabilities govern the managed-agent product plane.

- `agent-services` publishes immutable agent-service revisions, owns schedules, and enforces scope
  attach-authority + effective access.
- `scheduling` evaluates a managed-agent schedule into due runs and admits them idempotently.
- `skills` publishes `SkillRevision` records backed by ArtifactStore.
- `artifacts` is the finalisation authority for artifact metadata.
- `channel-targets` authorizes a channel target for a specific operation.
- `conversation-replay` reads an authorised thread snapshot and returns only display-safe AG-UI SSE
  events; it never exposes raw canonical event payloads.

The group may consult IAM for a proof or decision. It must not take a direct implementation
dependency on gateways or knowledge; their results enter through public contracts.
