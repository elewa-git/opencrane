# @opencrane/elements/a2ui — in-process agent canvas rendering

Renders agent-authored A2UI canvas surfaces (Google's A2UI protocol, Apache-2.0) in-process,
on the v0.8 dialect OpenClaw ships at the pin. Exports `provideWoA2ui()` (catalog + theme +
markdown renderer, included once per app), the `<wo-a2ui-canvas>` component (one
`MessageProcessor` per instance, emits user actions back for the agent return path), and the
payload-parsing util (JSONL, JSON array, or pre-parsed). Canvas markdown is routed through the
same DOMPurify-sanitised pipeline as the transcript (`toSanitizedMarkdownHtml` from
`@opencrane/state/conversation/render`) — one renderer, one sanitisation posture.

This is the SINK half of the canvas feature only. The PRODUCER — extracting an agent canvas
message part into a `Canvas` MessageCard — lands with the live-pod transport verification
(opencrane #28), so the component is wired but intentionally unproduced until then.

Consumed by `@opencrane/features/conversation` and `features/workspace` inside
`apps/opencrane-ui`. Tagged `scope:web`/`type:ui`: may depend only on `scope:web` and
`scope:shared` libs — never on backend packages or apps.
