# @opencrane/backend/agents/runtime/prompt-compiler — deterministic input compiler

> [backend](../../../../../README.md) › [agents](../../../../README.md) › [runtime](../../README.md) › prompt-compiler › main

## What it owns

This package is the single TypeScript authority that turns an immutable `RunInputSnapshot` — which
holds only ID references plus a `promptCompilerVersion` — into the literal `CompiledRunInput` the
runtime executes. It dereferences persona, preference, message, tool, memory, artifact, and skill
records through injected control-plane read ports, resolves the model route and literal turn, token,
cost, tool, and time budget numbers,
orders every collection canonically, stamps its own version, and seals the result with a SHA-256
digest over the canonical payload.

Because every referenced record is immutable, the same snapshot compiles to byte-identical output
across process restarts. The compiler holds no database of its own: the app injects the read ports
over the control-plane Prisma transaction so the runtime never re-derives prompt, persona, or tool
assembly and never touches Postgres.

Integration tool descriptors are the exception to the read-port pattern: the snapshot already pins
the integration identifier and allowed tool names. The dispatch adapter turns those into
`integration:<integrationId>:<toolName>` descriptors and marks every third-party action for
approval. It does not load MCP grants or expose custody references; the action boundary performs the
live custody recheck immediately before execution.

```
 RunInputSnapshot (ID references + promptCompilerVersion)
          │  injected control-plane read ports
          ▼
 ┌──────────────────────────────┐
 │ prompt-compiler  ◄── HERE     │  dereference → order → stamp → digest
 └──────────────────────────────┘
          │  CompiledRunInput (literal, digest-sealed)
          ▼
 dispatch authority carries it on start_attempt; the runtime consumes it as opaque data
```

Invariant: a snapshot whose `promptCompilerVersion` differs from this compiler's fails closed rather
than being silently compiled by a mismatched version.

## Public surface

- `__CompileRunInput` — hydrate a snapshot into the literal, digest-sealed `CompiledRunInput`.
- `__AppendCompiledTool` — append one composition-owned first-party tool, canonically re-order it,
  and re-seal the literal input without mutating the snapshot.
- `PROMPT_COMPILER_VERSION` — the exact version this compiler stamps and requires on every snapshot.
- `PromptCompilerRepositories` — the injected read ports the runtime authority implements over control-plane
  persona, preference, conversation, tool, memory, artifact, skill, and model-routing records.

## Boundary

The compiler is pure and side-effect-free apart from its injected reads. It performs no model call,
no tool execution, no durable write, and never mints or reads a provider credential. Delivery of the
compiled input to the runtime is owned by the dispatch authority; execution is owned by the runtime.

## Dependency direction

Tagged `scope:agent-runtime` (`layer:backend`): it depends only on shared contracts and on the
model-routing, persona, preference, memory, artifact, and skill read surfaces it dereferences. It never imports
an app, a transport adapter, a model driver, or a legacy runtime package.

## See also

- Parent group: [runtime](../../README.md)
- Wire contract: [`@opencrane/contracts`](../../../../../contracts/README.md)
- Delivery + execution boundary: [runtime protocol authority](../../main/README.md)
