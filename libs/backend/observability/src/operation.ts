import { randomUUID } from "node:crypto";

import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { suppressTracing } from "@opentelemetry/core";

import { ___RunWithContext } from "./context";

/** Tracer shared by all operations started through this package. */
const _tracer = trace.getTracer("@opencrane/backend/observability");

/** Spans that {@link ___MarkActiveSpanFailed} flagged, so {@link ___DoWithTrace} does not later overwrite their status with OK. */
const _failedActiveSpans = new WeakSet<object>();

/**
 * Return the currently active OpenTelemetry span, or `undefined` when none is active.
 *
 * Use this rather than importing `@opentelemetry/api` yourself: keeping the dependency inside this
 * one package is what lets the version be pinned in a single place. A second copy of the API
 * package silently stops spans recording — see the alias note in this package's `vitest.config.ts`.
 *
 * No caller outside this package yet.
 * @returns The active span, or `undefined`.
 * @see https://opentelemetry.io/docs/languages/js/
 */
export function ___GetActiveSpan()
{
  return trace.getActiveSpan();
}

/**
 * Mark the active span as failed, recording no exception and no caller-supplied text.
 *
 * Use it when an adapter turns a provider error into a typed outcome instead of throwing: the span
 * still shows a failure, but the fixed status message keeps a remote response body, a credential,
 * or a provider stack trace out of telemetry. A no-op when no span is active.
 *
 * Called by: `libs/backend/agents/execution/protocol/src/production-external-action-adapter.ts`.
 * @see {@link ___DoWithTrace}
 */
export function ___MarkActiveSpanFailed(): void
{
  const span = trace.getActiveSpan();
  if (span === undefined) return;
  _failedActiveSpans.add(span);
  span.setStatus({ code: SpanStatusCode.ERROR, message: "operation_failed" });
}

/**
 * Run one outbound call with automatic child spans suppressed, keeping the operation span around it.
 *
 * Use it when the address itself is sensitive: automatic HTTP instrumentation would record the
 * URL, and for an internal service that can reveal a tenant or a credential-bearing path. The
 * surrounding {@link ___DoWithTrace} span still records that the call happened and how long it
 * took — only the child span is dropped.
 *
 * `fn` must START the I/O synchronously. Suppression applies for the duration of the call, so
 * work deferred to a later tick is no longer covered.
 *
 * Called by: the Cognee HTTP client, the MCP era probe, the MCP executor companion, and the
 * memory-gateway proxy when their outbound URL must stay out of automatic HTTP spans.
 * @param fn - Callback that synchronously starts the sensitive I/O.
 * @returns Whatever `fn` returns, normally the I/O client's promise.
 */
export function ___DoWithoutTrace<T>(fn: () => T): T
{
  return context.with(suppressTracing(context.active()), fn);
}

/**
 * Run `fn` as one named, traced operation.
 *
 * This is the standard way to wrap work in this repo — around forty call sites use it. It opens a
 * span, seeds the async context so every log line inside inherits `requestId` and the fields, and
 * records the duration. Automatically instrumented calls made inside `fn` (HTTP, pg, fetch) nest
 * under this span.
 *
 * A `requestId` in `fields` is reused so an operation can inherit a caller's correlation id;
 * otherwise a fresh one is minted. The span is always ended and any error is always re-thrown, so
 * adding this wrapper never changes control flow — but `fields` are attached to the span and to
 * every log line, so do not put a secret in them.
 *
 * Called by: about forty modules across `libs/backend/**` and `apps/**`, including
 * `libs/backend/server/conversations/main/src/conversation-live-replay.ts`,
 * `libs/backend/agents/skills/controller/src/skill-workload-controller.ts`, and
 * `apps/artifact-service/src/server.ts`.
 * @param name - Operation name, for example `tenant.reconcile`.
 * @param fields - Attributes attached to the span AND to every log line in scope; never secrets.
 * @returns Whatever `fn` resolves to.
 * @throws Re-throws whatever `fn` throws, after recording it on the span and ending it.
 * @see {@link ___MarkActiveSpanFailed}
 * @see {@link ___DoWithoutTrace}
 */
export async function ___DoWithTrace<T>(
  name: string,
  fields: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T>
{
  // 1. Derive the correlation id once so the span, context, and logs all agree.
  const requestId = typeof fields["requestId"] === "string" ? (fields["requestId"] as string) : randomUUID();
  const startedAt = performance.now();

  // 2. Open an active span so auto-instrumented child calls (HTTP, pg, fetch)
  //    nest under this operation in the trace.
  return _tracer.startActiveSpan(name, async function _runSpan(span)
  {
    span.setAttributes({ ...fields, requestId });

    // 3. Seed the async context so every log line within fn carries the ids.
    return ___RunWithContext({ requestId, extra: { operation: name, ...fields } }, async function _runWork()
    {
      try
      {
        const result = await fn();
        if (!_failedActiveSpans.has(span)) span.setStatus({ code: SpanStatusCode.OK });
        return result;
      }
      catch (err)
      {
        // Record on the span before re-throwing so failed operations are still
        // visible in the configured trace backend with their exception attached.
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
        throw err;
      }
      finally
      {
        span.setAttribute("duration_ms", Math.round(performance.now() - startedAt));
        span.end();
      }
    });
  });
}
