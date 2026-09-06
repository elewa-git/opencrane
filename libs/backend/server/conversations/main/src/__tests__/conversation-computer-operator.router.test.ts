import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { _CreateConversationComputerOperatorRouter } from "../conversation-computer-operator.router";

/** Proves the replay route derives its silo from the trusted principal and admits only operators. */
describe("conversation computer operator router", function _Suite()
{
	const admit = vi.fn();
	const replayParked = vi.fn();
	const warn = vi.fn();
	const principal = { principalId: "principal-1", siloId: "silo-1" };

	beforeEach(function _Reset()
	{
		vi.clearAllMocks();
		admit.mockResolvedValue(true);
		replayParked.mockResolvedValue(undefined);
	});

	function _App(resolve: () => typeof principal | null = function _Principal() { return principal; })
	{
		const app = express();
		app.use(express.json());
		app.use("/api/v1/conversation-computers", _CreateConversationComputerOperatorRouter({ authorization: { admitReplayParkedActivations: admit }, activations: { replayParked }, logger: { warn } }, resolve));
		return app;
	}

	it("replays the caller's silo queue after operator admission", async function _Replays()
	{
		const response = await request(_App()).post("/api/v1/conversation-computers/activations/parked:replay").send({ siloId: "silo-9" });
		expect(response.status).toBe(202);
		expect(response.body).toEqual({ outcome: "replay_requested" });
		expect(admit).toHaveBeenCalledWith(principal);
		expect(replayParked).toHaveBeenCalledWith("silo-1");
	});

	it("rejects an unauthenticated or non-operator caller without touching the queue", async function _Rejects()
	{
		expect((await request(_App(function _Nobody() { return null; })).post("/api/v1/conversation-computers/activations/parked:replay")).status).toBe(401);
		admit.mockResolvedValue(false);
		expect((await request(_App()).post("/api/v1/conversation-computers/activations/parked:replay")).status).toBe(403);
		expect(replayParked).not.toHaveBeenCalled();
	});

	it("reports an unavailable queue without leaking the failure", async function _Unavailable()
	{
		replayParked.mockRejectedValue(new Error("kurrent unreachable"));
		const response = await request(_App()).post("/api/v1/conversation-computers/activations/parked:replay");
		expect(response.status).toBe(503);
		expect(response.body).toEqual({ error: "conversation_computer_activation_queue_unavailable" });
		expect(warn).toHaveBeenCalledOnce();
	});
});
