# @opencrane/state/conversation/render — vendored render view-models

> [frontend](../../../README.md) › [state](../../README.md) › conversation › render

## What it owns

Part of the OpenCrane **frontend state layer** (the code between the browser UI and the backend). When
a chat message arrives it is raw data — text, tool calls, file references, markdown. Before the UI can
draw it, that data has to be turned into a **view-model**: a plain, already-shaped object the template
can render without further logic. This package owns those pure view-model builders and the
attributed third-party code they reuse.

It is pure and does no input/output: no HTTP, no storage, no Angular. It holds tool/file view-model
builders, the helpers that fold a message stream into them, and a **sanitised markdown
pipeline** — markdown converted to HTML and then run through a strict tag/attribute allowlist so a
message can never inject unsafe markup (only `data:` image URIs, dangerous link schemes stripped). The
Angular rendering surface that consumes these view-models is re-implemented separately in
the future product conversation feature; this package is just the data-shaping half.

Invariant: pure functions only, and the markdown sanitiser's security posture (allowlist,
scheme/host-local blocking, HTML escaping) stays intact. Reused third-party code retains its MIT
attribution inline in the source file that carries it.

## Public surface

- `tool-content`, `tool-output` — provider-shaped tool guards and display-safe output builders.
- `conversation-stream.types` / `conversation-stream.util` — fold a message stream into view-models.
- `file-artifact` / `file-artifact.types`, `media` — attachment and media helpers.
- `markdown` — the sanitised markdown → HTML pipeline.

## Boundary

Consumed by future product conversation UI. It builds view-models and sanitises markup only; it
never fetches, caches, or streams — the conversation adapter does that. Governed A2UI envelopes do
not pass through these OpenClaw helpers: the AG-UI state boundary projects them directly to
`@opencrane/elements/a2ui`.

## Dependency direction

Tagged `scope:web` (`type:state`): it may depend only on other `scope:web` and `scope:shared`
packages — here third-party render/sanitiser libraries — never on apps or server domains.

## See also

- Parent index: [state](../../README.md)
- Sibling: [conversation/adapter](../adapter/README.md)
