# @opencrane/features/context — selected document canvas

> [frontend](../../README.md) › [features](../README.md) › context

## What it owns

This frontend feature presents a selected document's summary, metrics, initiatives, risks and cited
boundaries. The caller supplies the document and save state; the canvas emits save and export intents.
Its isolated stories cover empty, draft, saving, saved, failure, and long document presentation.

The previous context-panel prototype had no application consumers and contained fixed sample
identity and retired runtime text. Its removal preserves the independently tested canvas renderer;
the active chat Activity and Files panel belongs to `features/conversation-workspace`.

## Public surface

- `CanvasDocComponent` — renders an owner-supplied `CanvasDocument`, takes its save lifecycle, and
  emits `saveRequested` and `exportRequested` without claiming persistence succeeded.

## Boundary

The canvas owns presentation only. It never loads documents, starts saves, or enforces access rules.
Its caller must supply browser-safe content and adopt authoritative save results.

## Dependency direction

Tagged `type:lib`, `layer:frontend`, and `scope:web`: this package may import other frontend packages
and shared contracts. It uses core document models and shared UI elements without importing apps or backend code.

## See also

- Parent index: [features](../README.md)
- Active chat context owner: [conversation workspace](../conversation-workspace/README.md)
- Shared visuals: [elements/ui](../../elements/ui/README.md)
