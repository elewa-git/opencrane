# Telemetry and logging

::: tip In plain terms
When something goes wrong — or you just want to know what the platform is doing — you need
to be able to *see* it. Every OpenCrane service writes clear, structured logs out of the box,
and you can follow a single request as it moves across services when you connect the services
to an OpenTelemetry endpoint.
:::

## What you get

- **Readable logs from every service, automatically.** No setup — logs are structured the
  moment a service starts.
- **Follow one request end-to-end.** Each log line is tagged so you can trace a single request
  across every service it touches.
- **Secrets stay out of the logs.** API keys, tokens, and connection strings are stripped
  before anything is written.
- **One trace endpoint for the fleet.** Point every service at an operator-supplied
  OpenTelemetry Collector or compatible OTLP backend.

## Logs always work; tracing is the switch

You get structured logs with **nothing to configure** — every service emits them by default.
The thing you turn on is **tracing**: the cross-service request timeline that shows up in your
cloud dashboards.

Off by default, because on a laptop or in CI there's nothing to send traces to — so it stays a
safe no-op there. In a real cluster, you flip it on:

```yaml
# values.yaml
observability:
  otel:
    enabled: true
```

That configures the OpenCrane services to export traces to the release-local collector endpoint.
The chart does **not** deploy that collector. Provide a compatible Service using the chart
fullname plus `-otel-collector` in the release namespace on OTLP/HTTP port `4318`: for a release
named `acme` the Service is `acme-opencrane-otel-collector`; the standard `opencrane-silo` release
uses `opencrane-silo-otel-collector`. Its collector pods must carry
`app.kubernetes.io/component: otel-collector` so the app-owned NetworkPolicies admit them.
Configure the collector's exporters yourself.

On GKE, the platform can ingest the structured stdout stream directly; no OpenCrane Helm switch is
required.

---

## How it works (the details)

You don't need this to operate the platform — it's here when you want to know what's happening
under the hood.

### One shared library

Every service builds its logger and tracing from a single library
(`@opencrane/observability`), so the whole fleet behaves the same way:

- **Structured logs** — pino writes JSON straight to stdout (never through `console`), ready for
  ingestion without parsing.
- **Request correlation** — an `AsyncLocalStorage` context attaches a `requestId` to every log
  line for the life of a request, with no manual plumbing.
- **Trace correlation** — once tracing is on, each record also carries `trace_id` and `span_id`,
  so logs and traces line up in the configured trace backend.
- **Redaction** — known secret fields are stripped from output by default.

### Operator-supplied collector

OpenCrane exports traces over OTLP/HTTP and writes logs to stdout. The operator owns the
release-local collector's receivers, processors, exporters, retention, and access controls.
The OpenCrane chart only wires its applications to that expected Service and pod label; it does
not install or configure a telemetry backend.

### Tuning verbosity

`observability.otel.logLevel` (or the `LOG_LEVEL` env var) sets the per-service pino level —
`debug` | `info` | `warn` | `error`. Pretty-printed logs are a dev-only convenience
(`NODE_ENV` ≠ `production`) and never the default in a container.

## See also

- [Runbook](/operators/runbook) — how operators use these signals during incidents
- [Model routing](/guide/model-routing) — how model defaults are resolved and frozen for execution
