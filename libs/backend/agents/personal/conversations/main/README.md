# @opencrane/backend/agents/personal/conversations — Conversations

Owns the ordered event history for a personal-agent run. It appends a valid next event exactly once
and refuses missing, terminal, or out-of-sequence runs, so callers can present an accurate
conversation timeline.

The public surface is `src/index.ts`; persistence is supplied through `ConversationAuthorityRepository`.
See [`../../README.md`](../../README.md) for the other personal-agent capabilities.
