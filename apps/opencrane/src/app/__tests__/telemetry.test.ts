import { describe, expect, it } from "vitest";

import { _SerializeHttpRequest } from "../telemetry.js";

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
});
