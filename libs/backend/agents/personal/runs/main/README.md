# @opencrane/backend/agents/personal/runs — Runs

Owns a personal agent's logical run attempts. It starts a retry only while the intended agent
service and revision are still active, and validates that a workload assignment belongs to that
exact attempt.

The public surface is `src/index.ts`; `PrismaAgentRunAuthorityRepository` supplies the durable
authority implementation. See [`../../README.md`](../../README.md) for the other personal-agent
capabilities.
