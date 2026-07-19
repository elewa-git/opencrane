# @opencrane/observability — structured logging and tracing

The one place every OpenCrane process gets fleet-consistent telemetry: `___CreateLogger`
builds a pino JSON-to-stdout logger, `___RunWithContext`/`___GetContext` propagate a
correlation id through async work without hand-threading (with `___RequestContext` as the
Express middleware and `___ContextMixin` stamping it onto every log line), `___BindConsole`
routes stray `console.*` calls into structured logs, and `___DoWithTrace` wraps operations in
OpenTelemetry spans.

`___StartTelemetry` is the side-effecting OTEL SDK bootstrap; import it from the dedicated
`@opencrane/observability/telemetry` entry point before the rest of the application graph, as
every app (`opencrane`, `channel-proxy`, `feat-central-agents`) does in its `instrument.ts`.
Traces flow to the in-cluster collector, which forwards to GCP Cloud Logging and Cloud Trace
or any OTLP backend behind the Helm `observability.otel` toggle.

Wide exports use the `___` prefix by convention. The package decides nothing about what to
log or trace — domains own their events; this library owns the transport, shape, and context
plumbing.

Tagged `scope:shared`: consumed by every app and backend domain, so it may depend only on
other `scope:shared` packages and approved model contracts — never on backend domains or
apps.
