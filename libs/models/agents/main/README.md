# @opencrane/models/agents — pure agent domain contract

Dependency-free domain model for the personal-agent product: `AgentService`, `AgentRevision`,
and `AgentRun` types (including `AgentRunState`, `AgentRunTrigger`, `AgentRunTerminalReason`
and run lineage), transcript types (`Thread`, `Message`, `RunEvent` and the canonical
`RunEventType` vocabulary), persona onboarding types, and the branded identifier types shared
by every agent domain.

Beyond types it carries the pure invariants: the legal lifecycle transition tables
(`__IsAgentRunTransitionAllowed` and peers for services, revisions, threads, and messages),
`__CanAppendRunEvent`, and the complete persona onboarding state machine
(`__SelectSoulTemplate`, `__CreatePersonaDraft`, `__ApprovePersonaOnboarding`,
`__BuildPersonaRuntimeInput`, ...) as deterministic functions with no I/O.

Consumed by the personal-agent backend domains (conversations, runs), the agent-services
domain, and the API contracts. It performs no persistence, no authorization, and no side
effects — backend authorities enforce these rules against a database; this package only
defines them.

Tagged `type:lib`, `layer:model`, `scope:agents`: it may depend only on other `scope:agents`
or `scope:shared` model/util packages, and as a `layer:model` package it may never import
backend, contract, frontend, infra, or entrypoint code.
