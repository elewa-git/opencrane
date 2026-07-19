# @opencrane/backend/agents/personal/runs — agent-run attempt authority

Personal-agent product domain that keeps one `AgentRun` the single authority while attempts
retry. `__StartNextRunAttempt` reads run and referenced `AgentService` authority as one
snapshot, admits retries only from retryable terminal states (`failed`, `cancelled`) on an
active service whose silo and active revision still match the run, then increments the
attempt through a compare-and-swap bound to all of those facts — a superseded revision,
paused service, or concurrent retry fails closed with a distinct reason instead of minting a
second logical run.

`PrismaAgentRunAuthorityRepository` implements the persistence boundary: it locks service
before run, resets only attempt-local coordinates, and appends a `RunAttemptRequested`
outbox event in the same transaction so dispatch can never be lost or duplicated.
`__ValidateRunWorkloadAssignment` is the pure gate pairing a run attempt with its exact
Kubernetes workload identity: every field (service account, namespace, workload kind and
UID, Pod UID, the fixed `opencrane` projected-token audience) must match, and a structurally
valid assignment still fails closed at its hard expiry.

It does not schedule workloads, execute agents, or emit run events (that is the
conversations domain). Composed by the personal-agent product backend.

Tagged `type:lib`, `layer:backend`, `scope:personal-runs`: it may depend only on
`scope:agents` models, `scope:authorization` models, and `scope:shared` packages — never on
apps or sibling personal-agent domains.
