# @opencrane/backend/server/agent-services — managed agent lifecycle authority

Owns the publication step of the managed AgentService/AgentRevision lifecycle: promoting one
immutable draft revision to published and moving the service's stable active pointer in a single
atomic authority transaction. `__PublishAgentRevision` validates ownership (the revision must
belong to the service), rejects retired services and non-draft or already-published revisions,
and requires the executable minimum (digest, prompt-policy version, model policy, positive
turn/token/duration budgets) before any write. The repository owns the compare-and-swap against
the caller's `expectedActiveRevisionId`, so two concurrent publishers cannot both win — the loser
receives `publication_conflict` with the current active revision.

Persistence goes through the `AgentServicePublicationRepository` port;
`PrismaAgentServicePublicationRepository` is the durable implementation and records audit evidence
via the `AgentPublicationAuditEvidencePort`. The library carries no transport and no revision
authoring — it only decides and persists publication. Callers compose it inside the OpenCrane
server process.

Tagged `scope:agent-services`: it may depend only on `scope:agents` (the AgentRevision model),
`scope:audit`, `scope:authorization`, and `scope:shared` — never on apps or sibling domains.
