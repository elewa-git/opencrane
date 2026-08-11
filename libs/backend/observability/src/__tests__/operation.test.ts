import { context, ROOT_CONTEXT, SpanStatusCode, trace } from "@opentelemetry/api";
import type { Context } from "@opentelemetry/api";
import { isTracingSuppressed } from "@opentelemetry/core";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ___GetContext } from "../context.js";
import { ___DoWithoutTrace, ___DoWithTrace, ___MarkActiveSpanFailed } from "../operation.js";

/** Captures spans emitted by ___DoWithTrace for assertion. */
const _exporter = new InMemorySpanExporter();

/** Synchronous context manager sufficient to prove the sensitive-fetch suppression context. */
let _activeContext = ROOT_CONTEXT;

/** Register a deterministic context manager because the unit tracer provider does not install one. */
function _RegisterContextManager(): void
{
	context.setGlobalContextManager({
		active(): typeof ROOT_CONTEXT
		{
			return _activeContext;
		},
		with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(next: Context, callback: F, thisArg?: ThisParameterType<F>, ...args: A): ReturnType<F>
		{
			const previous = _activeContext;
			_activeContext = next;
			try
			{
				return callback.apply(thisArg, args);
			}
			finally
			{
				_activeContext = previous;
			}
		},
		bind<T>(_context: Context, target: T): T
		{
			return target;
		},
		enable()
		{
			return this;
		},
		disable()
		{
			return this;
		},
	});
}

beforeAll(function _registerProvider()
{
	_RegisterContextManager();
  // Register an in-memory tracer so trace.getTracer in operation.ts produces
  // real spans we can inspect, without a live collector.
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(_exporter)] });
  trace.setGlobalTracerProvider(provider);
});

afterAll(async function _shutdown()
{
  await _exporter.shutdown();
});

describe("___DoWithTrace", function _withOperationSuite()
{
  it("seeds context, sets duration, and ends an OK span on success", async function _success()
  {
    _exporter.reset();
    const seen = await ___DoWithTrace("tenant.reconcile", { tenant: "acme" }, async function _work()
    {
      return ___GetContext();
    });

    expect(seen?.extra["operation"]).toBe("tenant.reconcile");
    expect(seen?.extra["tenant"]).toBe("acme");
    expect(typeof seen?.requestId).toBe("string");

    const spans = _exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe("tenant.reconcile");
    expect(spans[0]?.status.code).toBe(SpanStatusCode.OK);
    expect(spans[0]?.attributes["tenant"]).toBe("acme");
    expect(typeof spans[0]?.attributes["duration_ms"]).toBe("number");
  });

  it("records the exception and re-throws on failure", async function _failure()
  {
    _exporter.reset();
    await expect(
      ___DoWithTrace("oci.bundle.push", { digest: "sha256:bad" }, async function _work()
      {
        throw new Error("registry unreachable");
      }),
    ).rejects.toThrow("registry unreachable");

    const spans = _exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.status.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0]?.events.some(function _isException(e) { return e.name === "exception"; })).toBe(true);
  });

  it("reuses a caller-supplied requestId", async function _inheritsId()
  {
    const seen = await ___DoWithTrace("harvest.cycle", { requestId: "req-42" }, async function _work()
    {
      return ___GetContext()?.requestId;
    });
    expect(seen).toBe("req-42");
  });

  it("retains a safe explicit failure when a typed operation outcome resolves", async function _typedFailure()
  {
    _exporter.reset();
    await expect(___DoWithTrace("provider.dispatch", {}, async function _work()
    {
      ___MarkActiveSpanFailed();
      return { kind: "failed" };
    })).resolves.toEqual({ kind: "failed" });

    const spans = _exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.status).toEqual({ code: SpanStatusCode.ERROR, message: "operation_failed" });
    expect(spans[0]?.events.some(function _isException(event) { return event.name === "exception"; })).toBe(false);
  });
});

describe("___DoWithoutTrace", function _withoutTraceSuite()
{
  it("suppresses automatic child spans without ending the surrounding operation", async function _suppressesChildSpans()
  {
    const suppressed = await ___DoWithTrace("obot_mcp.tool.invoke", {}, async function _operation()
    {
      return ___DoWithoutTrace(function _sensitiveFetch()
      {
        return isTracingSuppressed(context.active());
      });
    });
    expect(suppressed).toBe(true);
  });
});
