# @opencrane/backend/agents/personal/conversations — run-event append authority

Personal-agent product domain that owns appending `RunEvent`s to a run's immutable event
stream. `__AppendRunEvent` validates the command, then delegates to a single atomic
persistence operation behind `ConversationAuthorityRepository`, which appends only when the
run exists, is non-terminal, and the caller's one-based sequence is exactly the next one.
Replays and races surface as stable denials (`sequence_conflict` with the expected
`nextSequence`, `terminal`, `run_not_found`) rather than retryable errors, so callers cannot
mistake fencing for transient failure. The database-side contiguous-sequence and
terminal-fencing guarantees are exercised by `tests/conversation-authority.sql` via the
`test:sql` target.

It deliberately does not define the event vocabulary (`RunEvent`/`RunEventType` come from
`@opencrane/models/agents`), does not implement persistence, and does not stream or read
transcripts — it is the write authority only, composed by the personal-agent product backend.

Tagged `type:lib`, `layer:backend`, `scope:personal-conversations`: it may depend only on
`scope:agents` models and `scope:shared` packages — never on apps, entrypoints, the frontend,
or sibling personal-agent domains.

See [`../../README.md`](../../README.md) for the personal-agent capability map.
