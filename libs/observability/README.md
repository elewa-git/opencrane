# @opencrane/observability — structured logging and execution tracing

> [OpenCrane](../../README.md) › observability

## What it owns

This is the one place every OpenCrane service goes to **see what it is doing**: structured logs and
execution traces. "Observability" just means being able to answer, after the fact, what happened
inside a running service and why.

It owns two joined-up concerns:

- **Logging** — `___CreateLogger` builds a platform-consistent logger (built on `pino`, the Node logging library) that writes
  JSON, one object per line, to standard output; the container platform collects stdout, so the lib
  never opens a file or a socket. `___BindConsole` redirects stray `console.*` calls into the same
  structured stream so nothing escapes as unstructured text.
- **Correlation and tracing** — `___RunWithContext`/`___GetContext` carry a request id through async
  work without threading it by hand (so every log line from one request shares an id), and
  `___DoWithTrace` wraps an operation as an OpenTelemetry (OTEL) **span** — a timed, named unit of
  work — exported to the in-cluster collector, which forwards to GCP Cloud Logging and Cloud Trace
  (or any OTLP (OpenTelemetry Protocol) backend) behind a Helm toggle. `___RequestContext` is the Express middleware that
  opens a per-request context and span.

Naming convention: wide, cross-cutting exports use the `___` (triple-underscore) prefix, marking
them as intentional platform-wide API rather than local helpers. The side-effecting SDK bootstrap
`___StartTelemetry` is also reachable on its own via `@opencrane/observability/telemetry`, so it can
run before the rest of the application graph loads.

Consumed by every app and server domain. Invariant: logs are always structured JSON on stdout and a
correlation id follows the work — so a request can be traced end to end even across async hops.

## Public surface

- `___CreateLogger`, `Logger` — the JSON-to-stdout logger factory and its type.
- `___RunWithContext`, `___GetContext`, `___SetContextField`, `___ContextMixin` — correlation-id context.
- `___BindConsole` — route `console.*` into structured logs.
- `___RequestContext` — Express per-request context + span middleware.
- `___DoWithTrace`, `___GetActiveSpan` — wrap work in an OTEL span.
- `___StartTelemetry`, `___ShutdownTelemetry` — OTEL SDK lifecycle (also at `/telemetry`).
- `RequestContext`, `LoggerOptions`, `TelemetryOptions` — option/read types.

## Boundary

The only logging + tracing lib in the platform; services import it rather than calling `pino` or the
OTEL SDK directly. It writes JSON to stdout and emits OTLP spans — it does not manage log files, log
retention, or the collector deployment (that is Helm/infra).

## Dependency direction

Tagged `scope:shared`: a dependency-light package other packages may import — it never depends on
apps, backend domains, or model domains.

## See also

- Parent index: [OpenCrane](../../README.md)
- Siblings: [util](../util/README.md) · [contracts](../contracts/README.md)
