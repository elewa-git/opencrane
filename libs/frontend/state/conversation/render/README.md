# @opencrane/state/conversation/render — vendored headless render slice

The vendored OpenClaw headless rendering slice (MIT; see `THIRD_PARTY_NOTICES.md`): pure
view-model types and builders for turning conversation data into renderable structures —
chat/message types, tool content and output, canvas render models, file artifacts,
conversation-stream types/utils, media, code fences, and DOMPurify-sanitised markdown
(`toSanitizedMarkdownHtml`).

Deliberately framework-free at the surface: no Angular components live here — the Angular
rendering surface is re-implemented in `@opencrane/features/conversation`. Keeping the
vendored logic in one lib makes the upstream provenance auditable and gives the app a single
sanitisation posture (the a2ui canvas routes its markdown through the same pipeline).

Consumed by `features/conversation`, `elements/a2ui`, and `state/conversation/adapter`.
Tagged `scope:web`/`type:state`: may depend only on `scope:web` and `scope:shared` libs —
never on backend packages or apps.
