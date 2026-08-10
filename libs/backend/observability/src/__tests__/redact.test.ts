import { Writable } from "node:stream";

import pino from "pino";
import { describe, expect, it } from "vitest";

import { REDACT_PATHS } from "../redact.js";

/** Build a pino logger applying REDACT_PATHS, capturing records into an array. */
function _redactingLogger(): { logger: pino.Logger; records: Array<Record<string, unknown>> }
{
  const records: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb): void
    {
      records.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      cb();
    },
  });
  const logger = pino({ redact: [...REDACT_PATHS] }, stream);
  return { logger, records };
}

describe("REDACT_PATHS", function _redactSuite()
{
  it("redacts top-level credential fields from logged objects", function _topLevel()
  {
    const { logger, records } = _redactingLogger();
    logger.info({ masterKey: "sk-secret", token: "t-123", password: "hunter2" }, "config");
    expect(records[0]?.["masterKey"]).toBe("[Redacted]");
    expect(records[0]?.["token"]).toBe("[Redacted]");
    expect(records[0]?.["password"]).toBe("[Redacted]");
  });

  it("redacts nested credential fields via wildcard paths", function _nested()
  {
    const { logger, records } = _redactingLogger();
    logger.info({ litellm: { apiKey: "sk-nested", masterKey: "mk-nested" } }, "nested");
    const litellm = records[0]?.["litellm"] as Record<string, unknown>;
    expect(litellm["apiKey"]).toBe("[Redacted]");
    expect(litellm["masterKey"]).toBe("[Redacted]");
  });

  it("redacts the Authorization request header", function _authHeader()
  {
    const { logger, records } = _redactingLogger();
    logger.info({ req: { headers: { authorization: "Bearer leak-me" } } }, "request");
    const req = records[0]?.["req"] as { headers: Record<string, unknown> };
    expect(req.headers["authorization"]).toBe("[Redacted]");
  });

  it("redacts replay cursors in headers and structured fields", function _replayCursor()
  {
    const { logger, records } = _redactingLogger();
    logger.info({ req: { headers: { "last-event-id": "opaque-header" } }, cursor: "opaque-cursor", replay: { cursor: "opaque-nested" } }, "replay");
    const req = records[0]?.["req"] as { headers: Record<string, unknown> };
    const replay = records[0]?.["replay"] as Record<string, unknown>;
    expect(req.headers["last-event-id"]).toBe("[Redacted]");
    expect(records[0]?.["cursor"]).toBe("[Redacted]");
    expect(replay["cursor"]).toBe("[Redacted]");
  });

  it("redacts reviewed and final tool arguments at top-level and nested paths", function _toolArguments()
  {
    const { logger, records } = _redactingLogger();
    logger.info({
      reviewedToolArguments: { nested: { secret: "top-level-reviewed" } },
      finalArguments: { nested: { secret: "top-level-final" } },
      approval: {
        reviewedToolArguments: { nested: { secret: "nested-reviewed" } },
        finalArguments: { nested: { secret: "nested-final" } },
      },
    }, "approval");
    const approval = records[0]?.["approval"] as Record<string, unknown>;
    expect(records[0]?.["reviewedToolArguments"]).toBe("[Redacted]");
    expect(records[0]?.["finalArguments"]).toBe("[Redacted]");
    expect(approval["reviewedToolArguments"]).toBe("[Redacted]");
    expect(approval["finalArguments"]).toBe("[Redacted]");
  });

  it("leaves non-sensitive fields intact", function _passthrough()
  {
    const { logger, records } = _redactingLogger();
    logger.info({ tenant: "acme", requestId: "req-1" }, "ok");
    expect(records[0]?.["tenant"]).toBe("acme");
    expect(records[0]?.["requestId"]).toBe("req-1");
  });
});
