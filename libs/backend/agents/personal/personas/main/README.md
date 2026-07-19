# @opencrane/backend/agents/personal/personas — persona approval activation authority

Personal-agent product domain that owns approving and activating a persona revision.
`__ApprovePersona` loads one consistent `PersonaApprovalSnapshot` through
`PersonaAuthorityRepository.getApprovalSnapshot` and checks the complete onboarding evidence:
the caller owns the profile, the revision is still a draft, the interview is completed, three
to five provenance-linked insights exist, the revision pins the exact reviewed template
digest and deterministic template selection, and the durable-SOUL mutation policy is
`forbidden`. Any missing piece is a distinct stable denial reason.

Approval and the active-pointer update commit together through
`approveAndActivateAtomically`, which rebinds every mutable precondition (draft state,
completed interview, exact insight count) at commit time so concurrent edits fail closed as
`conflict` instead of approving stale evidence. Database-side guarantees are exercised by
`tests/persona-authority.sql` via the `test:sql` target.

It does not conduct the interview, draft revisions, or select templates — that pure onboarding
logic lives in `@opencrane/models/agents` — and it never creates a mutable runtime SOUL file.
It is the approval write authority composed by the personal-agent product backend.

Tagged `type:lib`, `layer:backend`, `scope:personal-personas`: it may depend only on
`scope:shared` packages — never on apps or sibling personal-agent domains.

See [`../../README.md`](../../README.md) for the personal-agent capability map.
