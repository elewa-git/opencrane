# @opencrane/backend/agents/personal/memory — Memory catalogue

Owns the durable-memory catalogue for a personal agent. It records consent, provenance, and a
content digest after the memory store accepts a fact; the fact content itself stays in the durable
memory store rather than being copied into this authority.

The public surface is `src/index.ts`; persistence and outbox commitment are supplied through
`MemoryCatalogRepository`. See [`../../README.md`](../../README.md) for the other personal-agent
capabilities.
