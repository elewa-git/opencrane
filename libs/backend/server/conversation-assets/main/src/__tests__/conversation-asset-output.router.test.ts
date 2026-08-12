import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { __CreateConversationAssetOutputRouter } from "../conversation-asset-output.router.js";

const _IDENTITY = { namespace: "runtime-ns", serviceAccountName: "agent-runtime-default", podUid: "pod-1" } as const;

/** Build the private router with narrow test doubles. */
function _App(overrides: Record<string, unknown> = {})
{
	const dependencies = { tokenReviewer: { __Review: vi.fn().mockResolvedValue(_IDENTITY) }, authority: { reserve: vi.fn().mockResolvedValue({ outcome: "denied", reason: "runtime_unavailable" }), publish: vi.fn().mockResolvedValue({ outcome: "denied", reason: "output_unavailable" }) }, logger: { error: vi.fn() }, ...overrides };
	const app = express();
	app.use(express.json());
	app.use(__CreateConversationAssetOutputRouter(dependencies as never));
	return { app, dependencies };
}

describe("conversation asset output router", function _Suite()
{
	it("TokenReviews the runtime and reserves without exposing write authority", async function _Reserve()
	{
		const authority = { reserve: vi.fn().mockResolvedValue({ outcome: "issued", ticketId: "ticket-1" }), publish: vi.fn() };
		const { app, dependencies } = _App({ authority });
		const response = await request(app).post("/conversation-assets/outputs:reserve").set("authorization", "Bearer projected-token").send({ runId: "run-1", runAttempt: 2, messageId: "message-1", idempotencyKey: "output-1", displayName: "report.pdf", mediaType: "application/pdf", byteLength: 5, contentAddress: `sha256:${"a".repeat(64)}` });

		expect(response.status).toBe(201);
		expect(response.body).toEqual({ outcome: "issued", ticketId: "ticket-1" });
		expect(response.text).not.toContain("lease");
		expect(response.text).not.toContain("contentAddress");
		expect(dependencies.tokenReviewer.__Review).toHaveBeenCalledWith("projected-token");
		expect(authority.reserve).toHaveBeenCalledWith(_IDENTITY, expect.objectContaining({ runId: "run-1", runAttempt: 2, messageId: "message-1" }));
	});

	it("streams octet bytes only after authenticating the exact runtime", async function _Publish()
	{
		const publish = vi.fn().mockResolvedValue({ outcome: "accepted" });
		const { app } = _App({ authority: { reserve: vi.fn(), publish } });
		const response = await request(app).put("/conversation-assets/outputs/ticket-1/content").set("authorization", "Bearer projected-token").set("content-type", "application/octet-stream").send(Buffer.from("hello"));

		expect(response.status).toBe(202);
		expect(publish).toHaveBeenCalledWith(_IDENTITY, "ticket-1", expect.anything());
	});

	it("rejects absent runtime proof before calling output authority", async function _Unauthorized()
	{
		const authority = { reserve: vi.fn(), publish: vi.fn() };
		const { app } = _App({ authority });
		const response = await request(app).post("/conversation-assets/outputs:reserve").send({});

		expect(response.status).toBe(401);
		expect(authority.reserve).not.toHaveBeenCalled();
	});

	it("rejects unknown reservation fields before issuing output authority", async function _StrictReservation()
	{
		const authority = { reserve: vi.fn(), publish: vi.fn() };
		const { app } = _App({ authority });
		const response = await request(app).post("/conversation-assets/outputs:reserve").set("authorization", "Bearer projected-token").send({ runId: "run-1", runAttempt: 2, messageId: "message-1", idempotencyKey: "output-1", displayName: "report.pdf", mediaType: "application/pdf", byteLength: 5, contentAddress: `sha256:${"a".repeat(64)}`, lease: "caller-controlled" });

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ outcome: "denied", reason: "invalid_request" });
		expect(authority.reserve).not.toHaveBeenCalled();
	});

	it("returns service unavailable when scanning is disabled", async function _ScannerUnavailable()
	{
		const authority = { reserve: vi.fn().mockResolvedValue({ outcome: "denied", reason: "scanner_unavailable" }), publish: vi.fn() };
		const { app } = _App({ authority });
		const response = await request(app).post("/conversation-assets/outputs:reserve").set("authorization", "Bearer projected-token").send({ runId: "run-1", runAttempt: 2, messageId: "message-1", idempotencyKey: "output-1", displayName: "report.pdf", mediaType: "application/pdf", byteLength: 5, contentAddress: `sha256:${"a".repeat(64)}` });

		expect(response.status).toBe(503);
		expect(response.body).toEqual({ outcome: "denied", reason: "scanner_unavailable" });
	});
});
