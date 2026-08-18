import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { ___CreateLogger } from "@opencrane/backend/observability";

import { _CreateHttpRequestLogger, _SerializeHttpRequest, _SerializeHttpResponse } from "../telemetry";

/** Captures the real Express-to-pino output so the tests prove both serializers are wired. */
async function _CapturedHttpRecords(): Promise<Array<Record<string, unknown>>>
{
	// 1. Use an isolated synchronous destination so the real logger can be inspected deterministically.
	const directory = mkdtempSync(join(tmpdir(), "opencrane-http-log-"));
	const logPath = join(directory, "request.ndjson");
	const fd = openSync(logPath, "w+");
	try
	{
		// 2. Serve one request through the exact middleware used by both production listeners.
		const logger = ___CreateLogger("opencrane-http-test", { destination: fd as 1, pretty: false });
		const app = express();
		app.use(_CreateHttpRequestLogger(logger));
		app.get("/events", function _Events(_req, res) { res.redirect(302, "https://identity.example.test/authorize?state=opaque-state&code_challenge=opaque-challenge"); });
		await request(app).get("/events?cursor=opaque-query&token=opaque-token").set("Authorization", "Bearer opaque-auth").set("Cookie", "session=opaque-cookie").set("Last-Event-ID", "opaque-header").set("Referer", "https://opencrane.test/invite?token=opaque-invitation-token").expect(302);

		// 3. Read the synchronous JSON records before removing the isolated destination.
		return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
	}
	finally
	{
		closeSync(fd);
		rmSync(directory, { recursive: true });
	}
}

describe("_SerializeHttpRequest", function _Suite()
{
	it("removes URL queries, replay headers, and cursor fields", function _RemovesReplayCursors()
	{
		const serialized = _SerializeHttpRequest({
			method: "GET",
			url: "/api/v1/conversations/conversation-1/events?cursor=opaque-query",
			originalUrl: "/api/v1/conversations/conversation-1/events?other=value#fragment",
			headers: { host: "opencrane.test", "last-event-id": "opaque-header", "x-request-id": "request-1" },
			cursor: "opaque-field",
			query: { cursor: "opaque-query-field" },
		});

		expect(serialized).toEqual({
			method: "GET",
			url: "/api/v1/conversations/conversation-1/events",
			originalUrl: "/api/v1/conversations/conversation-1/events",
			headers: { host: "opencrane.test", "x-request-id": "request-1" },
		});
	});

	it("drops a mixed-case Last-Event-ID header", function _DropsMixedCaseReplayHeader()
	{
		const serialized = _SerializeHttpRequest({ headers: { "Last-Event-ID": "opaque-header", accept: "text/event-stream" }, url: "/events" });

		expect(serialized).toEqual({ headers: { accept: "text/event-stream" }, url: "/events" });
	});

	it("strips invitation queries from Referer headers", function _StripsInvitationReferer()
	{
		const serialized = _SerializeHttpRequest({ headers: { Referer: "https://opencrane.test/invite?token=opaque-token", Referrer: "https://opencrane.test/login?returnTo=opaque" }, url: "/auth/login" });

		expect(serialized).toEqual({ headers: { Referer: "https://opencrane.test/invite", Referrer: "https://opencrane.test/login" }, url: "/auth/login" });
	});

	it("keeps cursors and credentials out of real pino-http request records", async function _PinoHttpIntegration()
	{
		const records = await _CapturedHttpRecords();
		const requestRecord = records.find(record => record["req"] !== undefined);
		const responseRecord = records.find(record => record["res"] !== undefined);
		const serialized = JSON.stringify(records);
		const loggedRequest = requestRecord?.["req"] as { url: string; headers: Record<string, unknown> };
		const loggedResponse = responseRecord?.["res"] as { headers: Record<string, unknown> };
		expect(loggedRequest.url).toBe("/events");
		expect(loggedRequest.headers["authorization"]).toBe("[Redacted]");
		expect(loggedRequest.headers["cookie"]).toBe("[Redacted]");
		expect(loggedRequest.headers["last-event-id"]).toBeUndefined();
		expect(loggedRequest.headers["referer"]).toBe("https://opencrane.test/invite");
		expect(loggedResponse.headers["location"]).toBe("https://identity.example.test/authorize");
		expect(serialized).not.toContain("opaque-query");
		expect(serialized).not.toContain("opaque-token");
		expect(serialized).not.toContain("opaque-invitation-token");
		expect(serialized).not.toContain("opaque-state");
		expect(serialized).not.toContain("opaque-challenge");
		expect(serialized).not.toContain("opaque-auth");
		expect(serialized).not.toContain("opaque-cookie");
		expect(serialized).not.toContain("opaque-header");
	});
});

describe("_SerializeHttpResponse", function _ResponseSuite()
{
	it("removes OIDC query values from redirect locations", function _RemovesOidcState()
	{
		const serialized = _SerializeHttpResponse({ statusCode: 302, headers: { location: "https://identity.example.test/authorize?state=opaque-state#fragment", "content-length": "0" } });

		expect(serialized).toEqual({ statusCode: 302, headers: { location: "https://identity.example.test/authorize", "content-length": "0" } });
	});
});
