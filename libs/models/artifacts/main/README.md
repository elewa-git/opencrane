# @opencrane/models/artifacts — content-addressed artifact invariants

Pure domain model for immutable, content-addressed artifacts: the `Artifact`,
`ArtifactRevision`, `ArtifactContentReference`, and `SkillRevision` types plus the predicate
functions that define what counts as valid (`___IsArtifact`, `___IsArtifactRevision`,
`___IsSha256ContentAddress` and the canonical `sha256:<64 hex>` pattern,
`___SkillRevisionMatchesArtifactRevision`).

The invariants it encodes: every revision pins content by lowercase SHA-256 address with a
byte length and media type; revision parents are unique and never self-referential; an
artifact's current-revision reference must point back at that artifact; timestamps must be
canonical ISO-8601; and a skill revision matches an artifact revision only when artifact id,
revision id, and content address all agree exactly.

Consumed by the artifacts and skills backend domains, the personal-agent memory domain
(digest validation), and the API contracts. It stores nothing and fetches nothing — blob
storage and revision persistence live in the backend domains that enforce these predicates.

Tagged `type:lib`, `layer:model`, `scope:artifacts`: it may depend only on other
`scope:artifacts` or `scope:shared` packages, and as a `layer:model` package it may never
import backend, contract, frontend, infra, or entrypoint code.
