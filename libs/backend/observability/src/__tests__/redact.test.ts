import { Writable } from "node:stream";

import pino from "pino";
import { describe, expect, it } from "vitest";

import { REDACT_PATHS } from "../redact.js";
import { _SanitizeLogFields } from "../sanitize.js";

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
  const logger = pino({ redact: [...REDACT_PATHS], formatters: { bindings: _SanitizeLogFields, log: _SanitizeLogFields } }, stream);
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

  it("redacts case-variant headers at arbitrary logged nesting depth", function _caseInsensitiveHeaders()
  {
    const { logger, records } = _redactingLogger();
    logger.info({ transport: { request: { Headers: { Authorization: "Bearer leak", COOKIE: "session=leak", "Last-Event-ID": "opaque-cursor", Accept: "application/json" } } } }, "headers");
    const transport = records[0]?.["transport"] as { request: { Headers: Record<string, unknown> } };
    expect(transport.request.Headers).toEqual({ Authorization: "[Redacted]", COOKIE: "[Redacted]", "Last-Event-ID": "[Redacted]", Accept: "application/json" });
  });

  it("redacts real command and candidate arguments while retaining diagnostics", function _domainArguments()
  {
    const { logger, records } = _redactingLogger();
    logger.info({
      command: { kind: "resume_attempt", payload: { toolResults: [{ toolInvocationId: "tool-1", outcome: "succeeded", result: { accessToken: "private" } }] } },
      candidate: { kind: "external_action", candidateId: "candidate-1", toolRevisionId: "integration:calendar:read", arguments: { calendarId: "private" }, argumentsDigest: "sha256:candidate" },
      diagnostics: { argumentCount: 2, argumentsDigest: "sha256:diagnostic" },
    }, "runtime protocol");
    const command = records[0]?.["command"] as { payload: { toolResults: Array<Record<string, unknown>> } };
    const candidate = records[0]?.["candidate"] as Record<string, unknown>;
    expect(command.payload.toolResults[0]).toEqual({ toolInvocationId: "tool-1", outcome: "succeeded", result: "[Redacted]" });
    expect(candidate).toEqual({ kind: "external_action", candidateId: "candidate-1", toolRevisionId: "integration:calendar:read", arguments: "[Redacted]", argumentsDigest: "sha256:candidate" });
    expect(records[0]?.["diagnostics"]).toEqual({ argumentCount: 2, argumentsDigest: "sha256:diagnostic" });
  });

  it("leaves non-sensitive fields intact", function _passthrough()
  {
    const { logger, records } = _redactingLogger();
    logger.info({ tenant: "acme", requestId: "req-1" }, "ok");
    expect(records[0]?.["tenant"]).toBe("acme");
    expect(records[0]?.["requestId"]).toBe("req-1");
  });
});
