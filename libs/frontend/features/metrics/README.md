# @opencrane/features/metrics — AI usage metrics dashboard

Owns the full-page AI-usage dashboard: daily traces, observations, tokens, and USD cost over a
selectable 7/30/90-day range, fetched from the Langfuse proxy (`/model-routing/metrics`)
through the shared `ControlPlaneApiService`. Exports the lazy `METRICS_ROUTES` table,
`MetricsPageComponent`, and the pure query-builder/row-parser/summarise utils and types.

Deliberately read-only and presentation-thin: query building and aggregation are pure
functions, and backend failures map to operator-readable states (503 → Langfuse not
configured, 502 → unreachable, 403 → no access) rather than raw errors. `METRICS_ROUTES` is
built to be mounted by the operator app but is not yet wired into `apps/opencrane-ui`'s route
table.

Tagged `scope:web`/`type:feature`: may depend only on `scope:web` and `scope:shared` libs —
never on backend packages or apps.
