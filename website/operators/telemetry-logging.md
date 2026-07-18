# Telemetry & logging

::: tip In plain terms
When something goes wrong — or you just want to know what the platform is doing — you need
to be able to *see* it. Every OpenCrane service writes clear, structured logs out of the box,
and you can follow a single request as it moves across services. Turn on one switch and it
all flows into your cloud dashboards.
:::

## What you get

- **Readable logs from every service, automatically.** No setup — logs are structured the
  moment a service starts.
- **Follow one request end-to-end.** Each log line is tagged so you can trace a single request
  across every service it touches.
- **Secrets stay out of the logs.** API keys, tokens, and connection strings are stripped
  before anything is written.
- **One switch to your cloud.** Send logs and traces to GCP Cloud Logging + Cloud Trace (or any
  OTLP backend) without wiring up each service.

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

That deploys a collector that gathers logs and traces from every service and ships them to
your backend — logs and traces already lined up, so you can jump from a log line to the trace
it belongs to.

On GKE you can skip the collector entirely and let the platform ingest logs directly:

```yaml
observability:
  cloudLogging: true
  cloudErrorReporting: true
```

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
  so logs and traces line up in Cloud Trace.
- **Redaction** — known secret fields are stripped from output by default.

### Collector topology

Enabling `observability.otel` deploys an in-cluster OpenTelemetry Collector. It receives traces
over OTLP and scrapes pod stdout, then exports both to GCP Cloud Logging + Cloud Trace or any
OTLP backend. Two modes:

- **`daemonset`** (default) — runs on each node and scrapes pod stdout; needed for the log
  pipeline.
- **`deployment`** — a single collector for traces only; use on GKE Autopilot, where node-level
  DaemonSets are restricted.

### Tuning verbosity

`observability.otel.logLevel` (or the `LOG_LEVEL` env var) sets the per-service pino level —
`debug` | `info` | `warn` | `error`. Pretty-printed logs are a dev-only convenience
(`NODE_ENV` ≠ `production`) and never the default in a container.

## See also

- [Runbook](/operators/runbook) — operational procedures
- [Awareness SLOs](/operators/awareness-slos) — what the platform watches
- [Model routing](/guide/model-routing) — cost & quality metrics built on this pipeline
