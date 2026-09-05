import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { _CreateConversationComputerCheckpointRouter } from "../conversation-computer-checkpoint.router";

function _App(tokenReviewer = { __Review: vi.fn().mockResolvedValue({ podUid: "pod-1", namespace: "computers", serviceAccountName: "computer", subject: "subject" }) }, authority = { restore: vi.fn().mockResolvedValue({ outcome: "restored", artifactRevisionId: "revision-1" }) })
{
	const app = express();
	app.use(express.json());
	app.use(_CreateConversationComputerCheckpointRouter({ tokenReviewer, authority, siloId: "silo-1" }));
	return { app, tokenReviewer, authority };
}

const _BODY = { computerId: "computer-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", generation: 2, leaseId: "lease-2" };

describe("_CreateConversationComputerCheckpointRouter", function _Suite()
{
	it("TokenReviews the Pod and excludes silo and Pod UID from caller authority", async function _Restores()
	{
		const { app, authority } = _App();
		const response = await request(app).post("/restore").set("authorization", "Bearer projected").send(_BODY);
		expect(response.status).toBe(200);
		expect(authority.restore).toHaveBeenCalledWith({ ..._BODY, siloId: "silo-1", podUid: "pod-1" });
	});

	it("refuses a missing or rejected projected token before restoration", async function _RejectsToken()
	{
		const tokenReviewer = { __Review: vi.fn().mockResolvedValue(null) };
		const { app, authority } = _App(tokenReviewer);
		expect((await request(app).post("/restore").send(_BODY)).status).toBe(401);
		expect((await request(app).post("/restore").set("authorization", "Bearer rejected").send(_BODY)).status).toBe(401);
		expect(authority.restore).not.toHaveBeenCalled();
	});

	it("rejects extra lease coordinates in the private command", async function _RejectsExtraFields()
	{
		const { app, authority } = _App();
		expect((await request(app).post("/restore").set("authorization", "Bearer projected").send({ ..._BODY, siloId: "foreign" })).status).toBe(400);
		expect(authority.restore).not.toHaveBeenCalled();
	});
});
